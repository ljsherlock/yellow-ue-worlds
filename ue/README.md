# Track D — UE 5.7 on a GPU server (Pixel Streaming + Remote Control)

The goal of Track D is to de-risk the **existential** question: can a GCP **L4**
render a UE 5.7 world and stream it to a browser at acceptable FPS / latency /
cost — and can we drive that world from our brain via Remote Control?

**Decision (2026-06-02):** no local engine install. UE never touches the Mac;
everything builds and runs in Epic's official Linux containers on a GCP L4 VM.

## Spike sequence (de-risk infra before app complexity)

- **Spike 1a — infra/perf/cost:** get a UE Pixel Streaming build streaming from
  an L4 to a browser. Measure FPS, latency, bitrate, $/hr. *This is the risk.*
- **Spike 1b — control loop:** add Remote Control + the `WorldDirector` actor
  (`SetSkyState`) and drive it from our `rc-bridge`. Proves the full chain
  browser → brain → Remote Control → world change → streamed back.

## Status

| Piece | State |
|---|---|
| One-time account gate (Epic↔GitHub, PAT) | ✅ done by user 2026-06-02 |
| `gcp/provision-l4.sh` + `startup.sh` + `teardown.sh` | ✅ written + run |
| UE project skeleton (`WorldDirector`, plugins) | ✅ built |
| Build-in-container + run/stream scripts | ✅ working |
| **Spike 1a — stream UE 5.7 from GCP GPU to browser** | ✅ **PROVEN 2026-06-02** |
| Spike 1b — drive `WorldDirector` over Remote Control | ⏳ next |
| L4 perf/cost benchmark | ⏳ later (capacity-blocked; ran on T4) |

### Spike 1a result (2026-06-02)

Streamed a lit UE 5.7 scene from a **GCP T4** (`n1-standard-8`) to a browser via
Pixel Streaming 2. **L4 was capacity-exhausted** (Spot *and* on-demand across
us-central1/us-east4/us-west1), so we fell back to a T4 — it does H.264 NVENC,
which fully de-risks the *pipeline*. L4-specific perf/bitrate/AV1 numbers for the
**cost model** are deferred until L4 capacity returns.

Hard-won operational notes (folded into the scripts):
- GPU driver via GCP's `cuda_installer.pyz`, not `ubuntu-drivers` (matches `-gcp` kernel; reboots once).
- Startup `gpg --dearmor` needs `--no-tty`; install Docker via `get.docker.com`.
- Target files must use `BuildSettingsVersion.V6` (match prebuilt engine); `ProjectPackagingSettings.Build` is an enum, not a bool.
- Bind-mounted project must be owned by `ue4` (uid 1000) to build; chown back to your user to *run*.
- PS2 launch arg is `-PixelStreamingSignallingURL`; the 5.7 Cirrus server rejects `--publicIp` (STUN handles the public candidate).
- Level lights must be **Movable** (no lightmap bake headless; also required for runtime sun control).

---

## 0. One-time account gate (done) — how UE images are accessed

Epic ships official Linux container images at `ghcr.io/epicgames/unreal-engine`
(`dev-*` to build/package, `runtime-pixel-streaming-*` to run). To pull them:

1. **Link Epic ↔ GitHub** at https://www.epicgames.com/account/connections →
   GitHub → Link → confirm the email verification link.
2. **Join the EpicGames org** on GitHub (avatar → *Your organizations* → accept
   the join offer). Verify by opening https://github.com/EpicGames/UnrealEngine
   — if you can see it, you're in.
   - *Gotcha:* if access doesn't grant, leave the org, revoke the GitHub OAuth
     app, unlink+relink on Epic; the invite re-fires.
3. **Create a classic GitHub PAT** with **only** the `read:packages` scope
   (Settings → Developer settings → Personal access tokens → Tokens (classic)).
   Copy it once; treat it like a password.

> Verify the exact 5.7 tags at https://github.com/orgs/EpicGames/packages
> (e.g. `dev-5.7`, `dev-slim-5.7`, `runtime-pixel-streaming-5.7`).

## 1. Provision the L4 VM (Spike 1a infra)

From your Mac, with `gcloud` authenticated to your project:

```bash
cd ue/gcp
chmod +x *.sh
PROJECT=<your-project> ZONE=<l4-zone> ./provision-l4.sh
```

- `g2-standard-8` = 8 vCPU / 32 GB / **1× L4** (the L4 is built into the G2
  family — no separate accelerator flag). Spot by default (cheap; STOP on
  preempt). **300 GB** pd-ssd boot disk — `dev-5.7` unpacks to ~100 GB+ and you
  cook on top of it.
- Pick a `ZONE` that has L4 stock **and** your quota (you have 16 L4). Check the
  GCP console if `us-central1-a` is short.
- The startup script installs the NVIDIA driver via GCP's official
  `cuda_installer.pyz` (the supported path for the `-gcp` kernel), then Docker
  and the NVIDIA container toolkit. The driver install **may reboot the VM
  once**; GCE re-runs the startup script automatically and it skips once the
  driver is live. SSH in, `tail -f /var/log/startup.log`, and confirm with
  `nvidia-smi` listing the L4 before pulling the (large) UE image.

**Firewall opened** (verified against UE 5.7 docs + coturn, 2026-06-02):

| Port(s) | Purpose |
|---|---|
| TCP 80 / 443 | player page + signalling HTTP(S) |
| TCP/UDP 3478, 5349 | STUN/TURN (coturn) |
| UDP 49152–65535 | WebRTC media relay |

(Streamer↔signalling 8888 stays on localhost in a single-VM deploy.)

## 2. Authenticate Docker to the registry (on the VM)

```bash
echo "<YOUR_PAT>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
docker pull ghcr.io/epicgames/unreal-engine:dev-5.7   # confirm exact tag first
```

## 3. Build + stream — ⏳ scripts coming next

The next artifacts (being written) are:

- `ue/project/PixelSpike/` — a minimal UE 5.7 C++ project: a `WorldDirector`
  actor exposing `SetSkyState` to Remote Control, with Pixel Streaming + Remote
  Control plugins enabled in `Config/`.
- `ue/build/build-in-container.sh` — package a Linux build inside the `dev-5.7`
  image (headless cook; no editor GUI).
- `ue/run/run-stream.sh` — launch the packaged app (`-RenderOffScreen
  -PixelStreamingIP=localhost -PixelStreamingPort=8888`) + the signalling/web
  server, so the browser can connect at `http://<VM_EXTERNAL_IP>`.

> The one honest wrinkle in a fully headless flow is the **startup map** — a
> `.umap` is a binary asset normally authored in the editor. The skeleton will
> use an engine template/empty map (or a tiny Python-generated level run in the
> headless editor) so Spike 1a needs **no** GUI. PCG and richer content come
> later, when you can run the editor in the container over a remote desktop.

## Tear down (do this when done — L4 bills hourly)

```bash
cd ue/gcp && ./teardown.sh                 # delete the VM
DELETE_FIREWALL=true ./teardown.sh         # also remove the firewall rule
```
