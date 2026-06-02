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
| **Spike 1b — drive `WorldDirector` over Remote Control** | ✅ **PROVEN 2026-06-02** |
| L4 perf/cost benchmark | ⏳ later (capacity-blocked; ran on T4) |

### Spike 1a result (2026-06-02)

Streamed a lit UE 5.7 scene from a **GCP T4** (`n1-standard-8`) to a browser via
Pixel Streaming 2. **L4 was capacity-exhausted** (Spot *and* on-demand across
us-central1/us-east4/us-west1), so we fell back to a T4 — it does H.264 NVENC,
which fully de-risks the *pipeline*. L4-specific perf/bitrate/AV1 numbers for the
**cost model** are deferred until L4 capacity returns.

### Spike 1b result (2026-06-02)

Drove `WorldDirector.SetSkyState(SunPitchDegrees, CloudCover, FogDensity)` on the
live packaged build over Remote Control (`-RCWebControlEnable`, HTTP :30010) and
watched the sun rotate in the stream. Transport is `HttpRCBridge` in
`packages/rc-bridge` (real `fetch`, `PUT /remote/object/call`), driven by its
`tsx` CLI. RC is unauthenticated so 30010 is **not** in the firewall — access is
via `npm run ue:rc-tunnel` (`ssh -L 30010:localhost:30010`), bridge hits
`http://127.0.0.1:30010`. Object path: `/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0`
(override with `RC_OBJECT_PATH` / `--path`).

Hard-won operational notes (folded into the scripts):
- GPU driver via GCP's `cuda_installer.pyz`, not `ubuntu-drivers` (matches `-gcp` kernel; reboots once).
- Startup `gpg --dearmor` needs `--no-tty`; install Docker via `get.docker.com`.
- Target files must use `BuildSettingsVersion.V6` (match prebuilt engine); `ProjectPackagingSettings.Build` is an enum, not a bool.
- Bind-mounted project must be owned by `ue4` (uid 1000) to build — `build-in-container.sh` now chowns to `ue4` for the build and **restores it to your user on exit** (trap), so no manual chown to run/sync/edit afterward.
- PS2 launch arg is `-PixelStreamingSignallingURL`; the 5.7 Cirrus server rejects `--publicIp` (STUN handles the public candidate).
- Level lights must be **Movable** (no lightmap bake headless; also required for runtime sun control).

## World controls — Tier 1 verb surface (2026-06-02)

`WorldDirector` now exposes the full **asset-free** control surface. Every verb
mutates a stock engine actor that `make_map.py` spawns into `/Game/Maps/Spike`
(DirectionalLight, SkyLight, ExponentialHeightFog, VolumetricCloud,
WindDirectionalSource, an unbound PostProcessVolume, a CameraActor) or the
procedural sand ground material — **no imported art required**.

Drive them from the Mac (after `ue:run:rc` + `ue:rc-tunnel`), from
`packages/rc-bridge/`:

```bash
pnpm cli -- ping                       # connectivity (GET /remote/info)
pnpm cli -- preset --name sunset       # one-shot mood (clear|cloudy|storm|sunset|night|dusty|misty)

# atmosphere
pnpm cli -- time     --hours 18
pnpm cli -- sun      --lux 35000 --kelvin 2400
pnpm cli -- skylight --intensity 0.8
pnpm cli -- fog      --density 0.05 --falloff 0.2
pnpm cli -- fogcolor --r 0.8 --g 0.5 --b 0.3
pnpm cli -- vfog     --on
pnpm cli -- cloud    --coverage 0.8
pnpm cli -- wind     --dir 90 --strength 0.6 --speed 0.2

# ground (procedural sand material; tan=dry, olive=greener)
pnpm cli -- ground   --r 0.52 --g 0.42 --b 0.26

# look / framing (colour grade + camera)
pnpm cli -- exposure --ev -0.5
pnpm cli -- grade    --kelvin 3200 --sat 1.2 --contrast 1.05
pnpm cli -- camera   --view aerial         # aerial|ground|wide|closeup|default
pnpm cli -- fov      --deg 60

# escape hatch — call any BlueprintCallable fn directly
pnpm cli -- call --fn SetColorGrade --params '{"WhiteTemp":7000,"Saturation":0.85,"Contrast":0.95}'
```

> **Ground:** options A/B (procedural sand material, runtime-recolourable) ship
> now. Option C (undulating **Landscape** from a noise heightmap) is a deliberate
> fast-follow — authoring a Landscape in the *headless* commandlet is the one
> fragile piece, kept separate so it can't break the base rebuild.
>
> **Clouds:** the layer renders with the engine default cloud material;
> `SetCloudiness` currently toggles clear-vs-cloudy. Fine-grained volumetric
> coverage needs a parameterised cloud material (follow-up).

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

## 3. Build + stream — npm ops (`ue/package.json`)

Day-to-day operation is wrapped in npm scripts so you never type raw
`gcloud`/`ssh`/`rsync`. **Run them from this `ue/` dir** (`cd ue && npm run …`).
They call `scripts/vm.sh`, which targets the VM via these env vars (defaults
shown): `UE_INSTANCE=ue-pixelspike`, `UE_ZONE=us-central1-a`,
`UE_PROJECT=task-assistant-project`. Override inline, e.g.
`UE_ZONE=us-east4-a npm run ue:up`.

| Command | What it does |
|---|---|
| `ue:provision` | create the GPU VM + firewall (`gcp/provision-l4.sh`; honours `GPU=t4`, `SPOT`, `DISK_GB`) |
| `ue:up` / `ue:down` | start / stop the VM (stop = no GPU bill, disk persists) |
| `ue:destroy` | delete the VM (`gcp/teardown.sh`) |
| `ue:status` / `ue:ip` | instance state + public IP |
| `ue:ssh` | interactive shell on the VM (extra args passed through) |
| `ue:sync` | `rsync` this `ue/` tree → `~/ue` on the VM (skips `Packaged/Intermediate/Saved/Binaries/Build/.git`) |
| `ue:fix-perms` | `chown` `~/ue` back to you (run once if a pre-fix build left `ue4`-owned files and `ue:sync` errors) |
| `ue:build` | headless cook + package inside `dev-5.7` (`build/build-in-container.sh`) |
| `ue:run` / `ue:run:rc` | stream the packaged build (`:rc` also enables Remote Control) in a `tmux` session `stream` |
| `ue:rc-tunnel` | SSH-forward the VM's RC port → `localhost:30010` so `rc-bridge` can drive it privately (blocks; own terminal) |
| `ue:stop-app` | kill the stream (tmux session + UE app + signalling) |
| `ue:logs` | tail signalling log (`/tmp/ss.log`) |
| `ue:logs:app` | attach the UE app's `tmux` session (Ctrl-b d to detach) |
| `ue:ports` | what's listening on 80 / 8888 / 30010 |
| `ue:open` | open `http://<VM_IP>` in your browser (macOS) |
| `ue:deploy` | `sync` → `build` → `run` in one go |

**Typical loop after a code change:**

```bash
cd ue
npm run ue:up        # if stopped
npm run ue:deploy    # sync + build + run  (or run the three steps individually)
npm run ue:open      # watch it in the browser
# ... iterate ...
npm run ue:down      # stop the GPU bill when done
```

First sync onto a VM that has older `ue4`-owned files: run `npm run ue:fix-perms`
once before `npm run ue:sync`. After that the build self-restores ownership, so
you won't need it again.

> The one honest wrinkle in a fully headless flow is the **startup map** — a
> `.umap` is a binary asset normally authored in the editor. We sidestep it with
> a tiny Python-generated level (`project/YellowWorld/Scripts/make_map.py`) run
> in the headless editor, so Spike 1a needs **no** GUI. PCG and richer content
> come later, when you can run the editor in the container over a remote desktop.

## Tear down (do this when done — L4 bills hourly)

```bash
cd ue/gcp && ./teardown.sh                 # delete the VM
DELETE_FIREWALL=true ./teardown.sh         # also remove the firewall rule
```
