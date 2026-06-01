import { boundary } from "@yellow-ue/tracing";
import { WorldAPICallSchema } from "@yellow-ue/world-api";
import type { z } from "zod";

import type { LLMClient } from "./client.js";

/**
 * The *resolved* tool-call type — what `WorldAPICallSchema.parse()` returns,
 * with schema defaults filled in. (The package's exported `WorldAPICall` is
 * the input type, where defaults are optional.)
 */
type ResolvedWorldAPICall = z.infer<typeof WorldAPICallSchema>;
import {
  LLMCompletionRequestSchema,
  LLMCompletionResultSchema,
  type LLMCompletionRequest,
  type LLMCompletionResult,
} from "./contract.js";

/**
 * MockLLMClient — deterministic, rules-based stand-in for the real brain.
 *
 * It keyword-matches the prompt and emits the corresponding `WorldAPICall`s.
 * This makes page 01 a "prompt → tool calls" bench: type a prompt, see
 * exactly what the world would be told to do — with zero LLM cost or latency,
 * and perfectly reproducible.
 *
 * It is intentionally dumb. The real brain (Phase 2 Track A) reasons; this
 * one pattern-matches. The point is to exercise the *boundary*, not the
 * intelligence.
 */
export class MockLLMClient implements LLMClient {
  complete = boundary(
    "llm-brain.complete",
    async (request: LLMCompletionRequest): Promise<LLMCompletionResult> => {
      const { prompt } = LLMCompletionRequestSchema.parse(request);
      const p = prompt.toLowerCase();

      const toolCalls: ResolvedWorldAPICall[] = [];
      const reasons: string[] = [];

      const sky = matchSky(p);
      if (sky) {
        toolCalls.push(sky.call);
        reasons.push(sky.reason);
      }

      const time = matchTime(p);
      if (time) {
        toolCalls.push(time.call);
        reasons.push(time.reason);
      }

      const trees = matchTrees(p);
      if (trees) {
        toolCalls.push(trees.call);
        reasons.push(trees.reason);
      }

      const reasoning =
        reasons.length > 0
          ? reasons.join(" ")
          : "No world-API tool matched this prompt. The real brain may still " +
            "respond conversationally; the mock only emits tool calls it recognises.";

      const result: LLMCompletionResult = {
        toolCalls,
        reasoning,
        model: "mock-llm-v1",
        tokens: {
          input: Math.ceil(prompt.length / 4),
          output: 8 + toolCalls.length * 14,
        },
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      };

      // Validate our own output against the contract (R4 discipline).
      return LLMCompletionResultSchema.parse(result);
    },
  );
}

interface Match {
  call: ResolvedWorldAPICall;
  reason: string;
}

const SKY_RULES: ReadonlyArray<{ re: RegExp; preset: string; phrase: string }> = [
  { re: /storm|stormy|thunder|tempest/, preset: "storm", phrase: "a storm" },
  { re: /sunset|dusk|golden hour/, preset: "sunset", phrase: "sunset" },
  { re: /night|midnight|\bdark\b/, preset: "night", phrase: "night" },
  { re: /cloud|overcast|grey sky|gray sky/, preset: "cloudy", phrase: "cloudy skies" },
  { re: /clear|sunny|blue sky|bright/, preset: "clear", phrase: "a clear sky" },
];

function matchSky(p: string): Match | null {
  for (const rule of SKY_RULES) {
    if (rule.re.test(p)) {
      const call = WorldAPICallSchema.parse({
        tool: "SetSkyState",
        args: { preset: rule.preset },
      });
      return {
        call,
        reason: `Prompt asks for ${rule.phrase}, so SetSkyState(${rule.preset}).`,
      };
    }
  }
  return null;
}

function matchTime(p: string): Match | null {
  let hours: number | undefined;
  let speed: number | undefined;

  if (/week/.test(p)) hours = 168;
  else if (/\bday\b|tomorrow|24 hours/.test(p)) hours = 24;
  else if (/morning|dawn|sunrise/.test(p)) hours = 8;
  else if (/noon|midday/.test(p)) hours = 12;
  else if (/evening|tonight/.test(p)) hours = 18;

  const hourMatch = p.match(/(\d+)\s*hour/);
  if (hourMatch) hours = Number(hourMatch[1]);

  const speedMatch = p.match(/(\d+)\s*(?:x|×)/);
  if (speedMatch) speed = Number(speedMatch[1]);
  else if (/speed|faster|fast forward|fast-forward/.test(p)) speed = 100;

  if (hours === undefined && speed === undefined) return null;

  const call = WorldAPICallSchema.parse({
    tool: "AdvanceTime",
    args: {
      hours: hours ?? 1,
      ...(speed !== undefined ? { speed_multiplier: speed } : {}),
    },
  });
  const speedPart = speed !== undefined ? ` at ${speed}× speed` : "";
  return {
    call,
    reason: `Prompt implies time should advance${speedPart}, so AdvanceTime(${hours ?? 1}h).`,
  };
}

function matchTrees(p: string): Match | null {
  if (!/tree|forest|oak|pine|birch|plant|scatter|woods?/.test(p)) return null;

  const countMatch = p.match(/(\d+)/);
  const count = countMatch ? Number(countMatch[1]) : 25;

  const species = /pine/.test(p) ? "pine" : /birch/.test(p) ? "birch" : "oak";

  const growth = /seedling/.test(p)
    ? "seedling"
    : /sapling/.test(p)
      ? "sapling"
      : "mature";

  const call = WorldAPICallSchema.parse({
    tool: "SpawnTrees",
    args: {
      area: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
      count: Math.min(count, 10_000),
      species,
      growth_stage: growth,
    },
  });
  return {
    call,
    reason: `Prompt asks to plant trees, so SpawnTrees(${count} ${species} ${growth}).`,
  };
}
