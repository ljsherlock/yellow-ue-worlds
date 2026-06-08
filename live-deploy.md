# Live Deploy

Free-form prompt control (option B: LLM brain) + public domain for the savanna stream.
Decisions to confirm: domain/registrar, LLM provider (Gemini already wired vs OpenAI/Anthropic), Caddy as TLS proxy.

## Reserve a static external IP — DONE

Static IP `35.232.241.32` (reservation `ue-pixelspike-ip`, region `us-central1`) attached to the VM and baked into `provision-l4.sh` (`--address`) so it survives stop/start and recreate. The domain A record points here.

## Point a domain at the IP — DONE

`3dworld.helloyellow.ai` A record → `35.232.241.32` (DNS at Namecheap), verified resolving via Google/Cloudflare. Clients use the domain + relative paths, so the IP can change underneath without app changes.

## TLS reverse proxy (Caddy) — DONE

Caddy v2.11.4 on the VM, config in `ue/run/Caddyfile` (deployed to `/etc/caddy/Caddyfile`). Valid Let's Encrypt cert for `3dworld.helloyellow.ai` (TLS-ALPN-01, auto-renew to Sep 2026). Binds 443 only; `http_port 8081` keeps :80 free for the signalling server; `reverse_proxy 127.0.0.1:80`. Returns 502 until the stream is up (expected). `/api/brain/*` route added with tasks 4-6.
Follow-up: Caddy was installed by hand — fold the install into `gcp/startup.sh` so it survives a VM recreate.

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
