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

cleanup() { kill "$SS_PID" 2>/dev/null || true; }
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

echo
echo ">>> Once it's running, open:  http://${PUBLIC_IP:-<VM_PUBLIC_IP>}"
echo
exec "$APP_SH" -RenderOffscreen -AudioMixer -Unattended \
  -PixelStreamingSignallingURL=ws://127.0.0.1:8888 \
  ${RC_FLAGS[@]+"${RC_FLAGS[@]}"}
