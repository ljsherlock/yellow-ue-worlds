#!/usr/bin/env bash
# Spike 1a: stream the packaged YellowWorld build to a browser via Pixel
# Streaming 2. Run ON the GPU VM after build-in-container.sh produced
# Packaged/Linux. When it's up, open http://<VM_PUBLIC_IP> in your browser.
#
#   ./run-stream.sh           # Spike 1a (stream only)
#   RC=1 ./run-stream.sh      # Spike 1b (also enable Remote Control)
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/ue/project/YellowWorld}"
PACKAGED="${PACKAGED:-$PROJECT_DIR/Packaged/Linux}"
INFRA_DIR="${INFRA_DIR:-$HOME/PixelStreamingInfrastructure}"
INFRA_BRANCH="${INFRA_BRANCH:-UE5.7}"
RC="${RC:-0}"   # 1 => enable Remote Control (Spike 1b)
# DEMO (default 1): once the app + RC are up, auto-spawn the demo elephant herd
# (ue/run/demo_herd.sh) so a fresh load opens on a living scene. Needs RC, so we
# force it on. Set DEMO=0 to boot to an empty savanna.
DEMO="${DEMO:-1}"
if [[ "$DEMO" == "1" ]]; then RC=1; fi
# STREAM_MAP (optional): open this map instead of the packaged GameDefaultMap.
# Passed as the first positional arg to the launcher. Defaults to the savanna
# landscape because that is what we cook/package; the old spike map is no longer
# staged, so an empty value would fall back to /Game/Maps/Spike and exit on boot.
# Override with STREAM_MAP=... to open a different cooked map.
STREAM_MAP="${STREAM_MAP:-/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1}"

# Locate the packaged launcher (.sh next to the staged build).
APP_SH="$PACKAGED/YellowWorld.sh"
if [[ ! -f "$APP_SH" ]]; then
  APP_SH="$(find "$PACKAGED" -maxdepth 1 -name '*.sh' 2>/dev/null | head -n1 || true)"
fi
[[ -n "${APP_SH:-}" && -f "$APP_SH" ]] || { echo "No packaged launcher under $PACKAGED — run the build first."; exit 1; }
chmod +x "$APP_SH" || true

# GCE metadata gives us the public IP for WebRTC/STUN candidates.
PUBLIC_IP=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" || true)
echo "VM public IP: ${PUBLIC_IP:-<unknown>}"

# 1. Fetch the Pixel Streaming infrastructure (signalling server + frontend).
if [[ ! -d "$INFRA_DIR" ]]; then
  echo "Cloning PixelStreamingInfrastructure ($INFRA_BRANCH) ..."
  git clone --depth 1 -b "$INFRA_BRANCH" \
    https://github.com/EpicGamesExt/PixelStreamingInfrastructure.git "$INFRA_DIR"
fi

# 2. Start Cirrus (signalling + web server). First run installs Node + builds
#    the frontend, so it can take a few minutes. Logs -> /tmp/ss.log.
#    No --publicIp: the 5.7 server rejects it; the streamer discovers its public
#    ICE candidate via STUN, and the firewall opens the WebRTC UDP range. If
#    media fails to connect on a locked-down network, stand up coturn and pass
#    its config here instead.
echo "Starting signalling server (logs: /tmp/ss.log) ..."
(
  cd "$INFRA_DIR/SignallingWebServer/platform_scripts/bash"
  ./start.sh
) > /tmp/ss.log 2>&1 &
SS_PID=$!

cleanup() {
  kill "$SS_PID" 2>/dev/null || true
  pkill -f "run/auto_cam.sh" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting ~20s for the signalling server to build/start ..."
sleep 20
echo "  (tail -f /tmp/ss.log in another shell to watch it)"

# 3. Launch the packaged app headless, connected to the signalling server.
#    -RenderOffscreen: no local window. PS2 uses -PixelStreamingSignallingURL.
RC_FLAGS=()
if [[ "$RC" == "1" ]]; then
  RC_FLAGS=(-RCWebControlEnable -RCWebInterfaceEnable)
  echo "Remote Control enabled (HTTP 30010 / WS 30020)."
fi

MAP_ARG=()
if [[ -n "$STREAM_MAP" ]]; then
  MAP_ARG=("$STREAM_MAP")
  echo "Opening map: $STREAM_MAP"
fi

# EXEC_CMDS (optional): comma-separated console commands run once at startup.
# Lets us tune scalability cvars (e.g. grass.CullDistanceScale to push the
# grass/tree pop-in distance) WITHOUT a rebuild — just relaunch. e.g.
#   EXEC_CMDS="grass.CullDistanceScale 10" RC=1 ./run-stream.sh
# SCREEN_MESSAGES (default 0): hide the on-screen engine debug text — the green
# (CreatureDirector) / yellow (WorldDirector) lines that scroll down the screen
# when a prompt fires (their Notify() calls AddOnScreenDebugMessage). UE_LOG file
# logging is unaffected. Set SCREEN_MESSAGES=1 to show them again for debugging.
SCREEN_MESSAGES="${SCREEN_MESSAGES:-0}"
EXEC_LIST=()
if [[ "$SCREEN_MESSAGES" == "0" ]]; then EXEC_LIST+=("DisableAllScreenMessages"); fi
if [[ -n "${EXEC_CMDS:-}" ]]; then EXEC_LIST+=("$EXEC_CMDS"); fi
EXEC_ARG=()
if (( ${#EXEC_LIST[@]} > 0 )); then
  # UE separates multiple console commands with commas inside -ExecCmds.
  IFS=,; EXEC_STR="${EXEC_LIST[*]}"; unset IFS
  EXEC_ARG=(-ExecCmds="$EXEC_STR")
  echo "ExecCmds: $EXEC_STR"
fi

echo
echo ">>> Once it's running, open:  http://${PUBLIC_IP:-<VM_PUBLIC_IP>}"
echo

# Launch the app in the background (not exec) so we can fire the demo herd once
# its Remote Control server is accepting calls, then wait on it.
"$APP_SH" ${MAP_ARG[@]+"${MAP_ARG[@]}"} -RenderOffscreen -AudioMixer -Unattended \
  -PixelStreamingSignallingURL=ws://127.0.0.1:8888 \
  ${RC_FLAGS[@]+"${RC_FLAGS[@]}"} \
  ${EXEC_ARG[@]+"${EXEC_ARG[@]}"} &
APP_PID=$!

if [[ "$DEMO" == "1" ]]; then
  (
    DEMO_SCRIPT="${DEMO_SCRIPT:-$HOME/ue/run/demo_herd.sh}"
    # Poll the RC web server until it accepts HTTP (app fully booted + map open).
    for _ in $(seq 1 150); do
      if curl -s -m 2 -o /dev/null "http://127.0.0.1:30010/remote/info" 2>/dev/null; then
        break
      fi
      sleep 2
    done
    sleep 4   # let the level + CreatureDirector finish BeginPlay
    if [[ -f "$DEMO_SCRIPT" ]]; then
      echo "[demo] spawning herd via $DEMO_SCRIPT"
      bash "$DEMO_SCRIPT" || echo "[demo] herd script failed"
    else
      echo "[demo] $DEMO_SCRIPT not found — skipping"
    fi
    # Auto-cycling demo camera (RC-driven; the browser buttons' input path is
    # broken). Alternates herd overview + a rotating focused elephant every
    # AUTO_CAM_INTERVAL seconds. Disable with AUTO_CAM=0.
    if [[ "${AUTO_CAM:-1}" == "1" ]]; then
      AUTOCAM_SCRIPT="${AUTOCAM_SCRIPT:-$HOME/ue/run/auto_cam.sh}"
      if [[ -f "$AUTOCAM_SCRIPT" ]]; then
        echo "[demo] starting auto-cycling camera (every ${AUTO_CAM_INTERVAL:-15}s)"
        AUTO_CAM_INTERVAL="${AUTO_CAM_INTERVAL:-15}" bash "$AUTOCAM_SCRIPT" >/tmp/autocam.log 2>&1 &
      fi
    fi
  ) &
fi

wait "$APP_PID"
