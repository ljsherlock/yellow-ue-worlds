#!/usr/bin/env node
/**
 * Brain prompt server — the deployed face of `scripts/scene.sh`.
 *
 * One endpoint:  POST /api/brain/prompt   { "prompt": "it is now sunset" }
 *
 * Flow (identical to scene.sh, just behind HTTP and serialized):
 *   1. spawn  `uv run python -m brain.plan "<prompt>"`  (the LLM planner;
 *      Gemini when GOOGLE_API_KEY is set, else the offline FakeProvider).
 *      stdout = a WorldAPICall[] plan, stderr = "[brain:<model>] <reasoning>".
 *   2. runPlan() the plan in-process over Remote Control (HttpRCBridge).
 *
 * Binds 127.0.0.1 only — public access is via Caddy (/api/brain/* -> :8000).
 * Remote Control (:30010) is never exposed; only this process talks to it.
 *
 * Env:
 *   BRAIN_PORT        listen port            (default 8000)
 *   RC_BASE_URL       Remote Control URL     (default http://127.0.0.1:30010)
 *   RC_WORLD_PATH     WorldDirector path     (default = mapping.ts const)
 *   RC_CREATURE_PATH  CreatureDirector path  (default = creatures.ts const)
 *   BRAIN_DIR         packages/brain dir     (default = ../brain next to this)
 *   UV_BIN            uv executable          (default "uv")
 *   PLAN_TIMEOUT_MS   planner subprocess cap (default 120000)
 */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { WorldAPICall } from "@yellow-ue/world-api";

import { CREATURE_DIRECTOR_PATH } from "./creatures.js";
import { HttpRCBridge } from "./http.js";
import { WORLD_DIRECTOR_PATH } from "./mapping.js";
import { runPlan, type RunStep } from "./runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.BRAIN_PORT ?? 8000);
const RC_URL = process.env.RC_BASE_URL ?? "http://127.0.0.1:30010";
const WORLD_PATH = process.env.RC_WORLD_PATH ?? WORLD_DIRECTOR_PATH;
const CREATURE_PATH = process.env.RC_CREATURE_PATH ?? CREATURE_DIRECTOR_PATH;
const BRAIN_DIR = process.env.BRAIN_DIR ?? resolve(HERE, "..", "..", "brain");
const UV_BIN = process.env.UV_BIN ?? "uv";
const PLAN_TIMEOUT_MS = Number(process.env.PLAN_TIMEOUT_MS ?? 120000);

/** Pull a WorldAPICall[] out of a raw array or the brain's {result:{toolCalls}}. */
function extractToolCalls(parsed: unknown): WorldAPICall[] | null {
  if (Array.isArray(parsed)) return parsed as WorldAPICall[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    const calls = (result?.toolCalls ?? obj.toolCalls) as unknown;
    if (Array.isArray(calls)) return calls as WorldAPICall[];
  }
  return null;
}

interface PlanResult {
  calls: WorldAPICall[];
  reasoning: string;
}

/** Run the Python planner as a subprocess; resolve its WorldAPICall[] plan. */
function plan(prompt: string): Promise<PlanResult> {
  return new Promise((resolvePlan, reject) => {
    const child = spawn(UV_BIN, ["run", "python", "-m", "brain.plan", prompt], {
      cwd: BRAIN_DIR,
      env: process.env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`planner timed out after ${PLAN_TIMEOUT_MS}ms`));
    }, PLAN_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`could not spawn '${UV_BIN}': ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`planner exited ${code}: ${err.trim() || "(no stderr)"}`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(out.trim());
      } catch {
        reject(new Error(`planner stdout was not JSON: ${out.slice(0, 300)}`));
        return;
      }
      const calls = extractToolCalls(parsed);
      if (!calls) {
        reject(new Error("planner produced no tool calls"));
        return;
      }
      // stderr carries "[brain:<model>] <reasoning>"; surface it for debugging.
      resolvePlan({ calls, reasoning: err.trim() });
    });
  });
}

// One world, one driver: serialize prompts so multi-step plans (with Waits)
// never interleave their RC calls. New prompts queue behind the in-flight one.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const bridge = new HttpRCBridge({ baseUrl: RC_URL });

type PromptMode = "build" | "modify";

async function handlePrompt(prompt: string, mode: PromptMode) {
  const { calls: planned, reasoning } = await plan(prompt);
  // "build" = start a fresh scene. Deterministically clear the existing herd
  // BEFORE the planned spawns, rather than hoping the LLM emits ClearCreatures.
  // "modify" mutates the live scene in place (no clear).
  const clear: WorldAPICall = { tool: "ClearCreatures", args: {} };
  const calls: WorldAPICall[] = mode === "build" ? [clear, ...planned] : planned;
  const steps: RunStep[] = await runPlan(calls, bridge, {
    paths: { worldDirector: WORLD_PATH, creatureDirector: CREATURE_PATH },
    stopOnError: false,
  });
  const failed = steps.some((s) => s.response && !s.response.ok);
  return {
    ok: !failed,
    prompt,
    mode,
    reasoning,
    plan: calls,
    steps: steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      tool: s.tool,
      detail: s.detail,
      ok: s.response ? s.response.ok : true,
      error: s.response && !s.response.ok ? s.response.error : undefined,
    })),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rej);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  // Caddy proxies the full path through, so accept both with and without prefix.
  const path = url.replace(/^\/api\/brain/, "") || "/";

  if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
    json(res, 200, { ok: true, rc: RC_URL, world: WORLD_PATH });
    return;
  }

  if (req.method === "POST" && (path === "/prompt" || path === "/")) {
    let prompt = "";
    let mode: PromptMode = "modify";
    try {
      const raw = await readBody(req);
      const ct = req.headers["content-type"] ?? "";
      if (ct.includes("application/json")) {
        const b = JSON.parse(raw || "{}") as Record<string, unknown>;
        prompt = String(b.prompt ?? b.text ?? b.p ?? "").trim();
        // Default to "modify" so a bare prompt never wipes the scene unasked.
        mode = String(b.mode ?? "").toLowerCase() === "build" ? "build" : "modify";
      } else {
        prompt = raw.trim();
      }
    } catch (e) {
      json(res, 400, { ok: false, error: `bad request body: ${e instanceof Error ? e.message : e}` });
      return;
    }
    if (!prompt) {
      json(res, 400, { ok: false, error: "missing 'prompt'" });
      return;
    }
    try {
      const result = await serialize(() => handlePrompt(prompt, mode));
      json(res, result.ok ? 200 : 502, result);
    } catch (e) {
      json(res, 500, { ok: false, prompt, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  json(res, 404, { ok: false, error: `no route for ${req.method} ${url}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[brain-server] listening on 127.0.0.1:${PORT}  rc=${RC_URL}  world=${WORLD_PATH}  brainDir=${BRAIN_DIR}`,
  );
});
