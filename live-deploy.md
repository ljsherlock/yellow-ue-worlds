# Live Deploy

Free-form prompt control (option B: LLM brain) + public domain for the savanna stream.
Decisions to confirm: domain/registrar, LLM provider (Gemini already wired vs OpenAI/Anthropic), Caddy as TLS proxy.

## Reserve a static external IP

Reserve a GCP address and attach it in `provision-l4.sh` (`--address`) so the public IP survives stop/start. Trivial cost vs the GPU VM; removes IP churn.

## Point a domain at the IP

DNS A record `stream.<domain>` → the static IP. Clients only ever use the domain + relative paths, so the IP can change underneath without app changes.

## TLS reverse proxy (Caddy)

Run Caddy on :443 (auto Let's Encrypt). Route `/` + `wss` → SignallingWebServer :80, `/api/brain/*` → brain :8000. Firewall already allows 80/443.

## Run the brain as a service on the VM

Turn the Mac-side `scripts/scene.sh` flow into a long-running service co-located with UE, so it reaches RC at `127.0.0.1:30010` with no SSH tunnel. systemd unit or container.

## Single prompt endpoint (plan → map → execute)

`POST /api/brain/prompt {text}` → `packages/brain` plans `WorldAPICall[]` → `packages/rc-bridge` maps + executes RC calls. Welds the existing plan and execute halves behind one HTTP handler.

## Wire a real LLM provider + key

Set `BRAIN_PROVIDER`/`GOOGLE_API_KEY` (Gemini already in `providers.py`) or add OpenAI/Anthropic. Currently defaults to the fake regex provider.

## Keep Remote Control private

Never expose :30010/:30020 in the firewall. The brain (on the VM, authenticated) is the only thing that touches RC.

## Frontend prompt box

Add a text input to `ue/run/frontend/player.{html,ts}` that `fetch`es `/api/brain/prompt`. Rebuild + `deploy_frontend.sh`. No `emitUIInteraction`/StreamBridge change needed for B.

## Optional: keyword fast-path

Match common phrases ("sunset", "night", "noon") client-side and call the verb directly to skip the ~1–3s LLM round trip; fall through to the brain for free-form prompts.

## Optional: dynamic DNS instead of static IP

If avoiding the idle static-IP fee, update the A record from `gcp/startup.sh` on each boot (low TTL); use ACME DNS-01 so cert renewal doesn't depend on reachability.

## Optional: always-on front-door VM (scale path)

Cheap `e2-micro` in the same VPC holds the static IP + TLS + brain, reaching the GPU VM by stable internal DNS name. Makes the GPU VM fully disposable; natural shape for multiple GPU VMs.
