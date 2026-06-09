# Live Deploy

Free-form prompt control (option B: LLM brain) + public domain for the savanna stream.
Decisions to confirm: domain/registrar, LLM provider (Gemini already wired vs OpenAI/Anthropic), Caddy as TLS proxy.

## Reserve a static external IP — DONE

Static IP `35.232.241.32` (reservation `ue-pixelspike-ip`, region `us-central1`) attached to the VM and baked into `provision-l4.sh` (`--address`) so it survives stop/start and recreate. The domain A record points here.

## Point a domain at the IP — DONE

`3dworld.helloyellow.ai` A record → `35.232.241.32` (DNS at Namecheap), verified resolving via Google/Cloudflare. Clients use the domain + relative paths, so the IP can change underneath without app changes.

## TLS reverse proxy (Caddy) — DONE

Caddy v2.11.4 on the VM, config in `ue/run/Caddyfile` (deployed to `/etc/caddy/Caddyfile`). Valid Let's Encrypt cert for `3dworld.helloyellow.ai` (TLS-ALPN-01, auto-renew to Sep 2026). Binds 443 only; `http_port 8081` keeps :80 free for the signalling server; `reverse_proxy 127.0.0.1:80`. Returns 502 until the stream is up (expected). `/api/brain/*` now routed to the brain service on `127.0.0.1:8000` (`handle /api/brain/*`, prefix preserved).
Follow-up: Caddy was installed by hand — fold the install into `gcp/startup.sh` so it survives a VM recreate.

## Run the brain as a service on the VM — DONE

`yellow-brain.service` (systemd, user `ljsherlock`) runs `tsx packages/rc-bridge/src/server.ts` from `~/yellow`, co-located with UE so it reaches RC at `127.0.0.1:30010` with no SSH tunnel. Toolchain on the VM: Node 22 + pnpm 11 + tsx (global) for rc-bridge, uv 0.11 + Python 3.12 for the brain. Env in `/etc/yellow-brain.env` (RC URL + savanna WorldDirector/CreatureDirector paths; the Spike default in `mapping.ts` is wrong for this map). `enable --now`, restarts on failure. Code lives in `~/yellow` (synced from `packages/` + `apps/` + root manifests); `vm.sh sync` only covers `ue/`.
Follow-up: add a `vm.sh` sync+install target for `~/yellow`, and fold the toolchain install into `gcp/startup.sh` so it survives a recreate.

## Single prompt endpoint (plan → map → execute) — DONE

`POST /api/brain/prompt {"prompt": "..."}` → spawns `uv run python -m brain.plan` (the same planner as `scene.sh`) → runs the resulting `WorldAPICall[]` in-process via `runPlan` + `HttpRCBridge`. Returns `{ok, plan, steps[]}`. Prompts are serialized so multi-step plans never interleave RC calls. Server is `packages/rc-bridge/src/server.ts`, binds `127.0.0.1:8000` only. Verified end-to-end: "it is now sunset" → `SetWeatherPreset{sunset}` ok.

## Wire a real LLM provider + key — DONE

Gemini (`gemini-2.5-flash`) via `langchain-google-genai` (the brain's `gemini` extra, installed with `uv sync --extra gemini`). `GOOGLE_API_KEY` stays only in the synced, gitignored `packages/brain/.env`, loaded by `plan.py` — not duplicated into the systemd env. `make_provider()` picks Gemini when the key is present, else the offline FakeProvider.

## Keep Remote Control private — DONE

Firewall never opens :30010/:30020 — confirmed both RC `:30010` and the brain `:8000` are unreachable from the public IP. Only Caddy (localhost) proxies `:8000`, and only the brain process touches RC on localhost.

## Frontend prompt box

Add a text input to `ue/run/frontend/player.{html,ts}` that `fetch`es `/api/brain/prompt`. Rebuild + `deploy_frontend.sh`. No `emitUIInteraction`/StreamBridge change needed for B.

## Optional: keyword fast-path

Match common phrases ("sunset", "night", "noon") client-side and call the verb directly to skip the ~1–3s LLM round trip; fall through to the brain for free-form prompts.

## Optional: dynamic DNS instead of static IP

If avoiding the idle static-IP fee, update the A record from `gcp/startup.sh` on each boot (low TTL); use ACME DNS-01 so cert renewal doesn't depend on reachability.

## Optional: always-on front-door VM (scale path)

Cheap `e2-micro` in the same VPC holds the static IP + TLS + brain, reaching the GPU VM by stable internal DNS name. Makes the GPU VM fully disposable; natural shape for multiple GPU VMs.
