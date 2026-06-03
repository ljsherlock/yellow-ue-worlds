#!/usr/bin/env bash
# Fab / marketplace import via full UnrealEditor + VNC in the Epic dev container.
# Requires Fab plugin staged on the VM (from Mac Launcher → npm run ue:stage-fab → ue:sync).
#
#   PROJECT_DIR=$HOME/ue/project/YellowWorld bash ~/ue/build/fab-import-in-container.sh
#
# Mac (two terminals):
#   npm run ue:fab-import
#   npm run ue:fab-vnc   → vnc://127.0.0.1:5900  password: yellowfab (or FAB_VNC_PASSWORD)
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/ue/project/YellowWorld}"
UE_TAG="${UE_TAG:-dev-5.7}"
IMAGE="${IMAGE:-ghcr.io/epicgames/unreal-engine:${UE_TAG}}"
ENGINE="${ENGINE:-/home/ue4/UnrealEngine}"
DOCKER="${DOCKER:-}"
GPUS="${GPUS:---gpus all}"
CONTAINER="${CONTAINER:-yellow-fab}"
VNC_PORT="${VNC_PORT:-5900}"
VNC_PASS="${FAB_VNC_PASSWORD:-yellowfab}"
# ~/ue/project/YellowWorld → ~/ue/third-party/FabPlugin/Fab
FAB_PLUGIN_DIR="${FAB_PLUGIN_DIR:-$(dirname "$(dirname "$PROJECT_DIR")")/third-party/FabPlugin/Fab}"

[[ -f "$PROJECT_DIR/YellowWorld.uproject" ]] \
  || { echo "No YellowWorld.uproject under $PROJECT_DIR — run 'npm run ue:sync' from the Mac first."; exit 1; }

[[ -f "$FAB_PLUGIN_DIR/Fab.uplugin" ]] || {
  echo "No staged Fab plugin at: $FAB_PLUGIN_DIR"
  echo "On Mac: Launcher → Fab UE Plugin → Install to Engine, then: npm run ue:stage-fab && npm run ue:sync"
  exit 1
}

if [[ -n "${DOCKER:-}" ]]; then
  :
elif docker info >/dev/null 2>&1; then
  DOCKER="docker"
elif sudo docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
else
  echo "Cannot talk to the Docker daemon (tried 'docker' and 'sudo docker')."
  exit 1
fi
echo "Using docker as: $DOCKER"
echo "Fab plugin mount: $FAB_PLUGIN_DIR → $ENGINE/Engine/Plugins/Fab"

if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not present — pulling (needs a prior 'docker login ghcr.io') ..."
  $DOCKER pull "$IMAGE"
fi

HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

restore_ownership() {
  $DOCKER exec -u root "$CONTAINER" chown -R "$HOST_UID:$HOST_GID" /project 2>/dev/null || true
}
cleanup() {
  restore_ownership
  $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "Starting Fab import container ($IMAGE) ..."
$DOCKER run --rm -d --name "$CONTAINER" $GPUS --network host \
  -v "$PROJECT_DIR":/project \
  -v "$FAB_PLUGIN_DIR":"$ENGINE/Engine/Plugins/Fab" \
  "$IMAGE" sleep infinity >/dev/null

run() { $DOCKER exec -i --workdir / "$CONTAINER" "$@"; }
run_root() { $DOCKER exec -i -u root --workdir / "$CONTAINER" "$@"; }

echo "Aligning project + Fab plugin ownership to ue4 ..."
run_root chown -R ue4:ue4 /project "$ENGINE/Engine/Plugins/Fab"

echo "Installing Xvfb + x11vnc inside the container ..."
run_root bash -lc 'export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq xvfb x11vnc'

if [[ "${SKIP_FAB_BUILDPLUGIN:-}" == "1" ]] \
  && run bash -lc 'test -d "'"$ENGINE"'/Engine/Plugins/Fab/Binaries/Linux"'; then
  echo "SKIP_FAB_BUILDPLUGIN=1 and Fab Binaries/Linux exist — skipping BuildPlugin."
else
  echo "Building Fab plugin for Linux (Mac Binaries/ are not staged) ..."
  run bash -lc 'set -euo pipefail
    rm -rf "'"$ENGINE"'/Engine/Plugins/Fab/Binaries" "'"$ENGINE"'/Engine/Plugins/Fab/Intermediate"
    "'"$ENGINE"'/Engine/Build/BatchFiles/RunUAT.sh" BuildPlugin \
      -Plugin="'"$ENGINE"'/Engine/Plugins/Fab/Fab.uplugin" \
      -Package=/tmp/FabPluginPkg \
      -TargetPlatforms=Linux
    built="$(find /tmp/FabPluginPkg -name Fab.uplugin | head -1)"
    [[ -n "$built" ]] || { echo "BuildPlugin produced no Fab.uplugin"; exit 1; }
    # Fab is bind-mounted from the host — do not rm the mount point (EBUSY).
    cp -a "$(dirname "$built")"/. "'"$ENGINE"'/Engine/Plugins/Fab/"
    test -d "'"$ENGINE"'/Engine/Plugins/Fab/Binaries/Linux" \
      || { echo "ERROR: No Fab Binaries/Linux after BuildPlugin"; exit 1; }
    echo "Fab Linux binaries ready."'
fi

if [[ "${SKIP_EDITOR_BUILD:-}" != "1" ]]; then
  echo "Building editor target ..."
  run "$ENGINE/Engine/Build/BatchFiles/Linux/Build.sh" \
    YellowWorldEditor Linux Development \
    -project=/project/YellowWorld.uproject
else
  echo "SKIP_EDITOR_BUILD=1 — skipping compile step."
fi

echo "Starting virtual display :99 and VNC on port ${VNC_PORT} ..."
run bash -lc 'set -e
  Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
  sleep 3
  x11vnc -storepasswd "'"${VNC_PASS}"'" /tmp/vncpass
  x11vnc -display :99 -rfbauth /tmp/vncpass -forever -shared -rfbport '"${VNC_PORT}"' \
    -noxrecord -noxfixes -noxdamage -bg -o /tmp/x11vnc.log
  sleep 1
  if ! grep -q "Listening for VNC connections on TCP port '"${VNC_PORT}"'" /tmp/x11vnc.log 2>/dev/null; then
    echo "ERROR: x11vnc did not open port '"${VNC_PORT}"'. Log:"
    cat /tmp/x11vnc.log 2>/dev/null || true
    exit 1
  fi
  echo "VNC listening on 127.0.0.1:'"${VNC_PORT}"' (password: '"${VNC_PASS}"')"'

echo ""
echo "=== Mac: second terminal (required) ==="
echo "  cd yellow-ue-worlds/ue && npm run ue:fab-vnc"
echo "  vnc://127.0.0.1:5900  password: ${VNC_PASS}"
echo "  (TigerVNC if Finder fails: brew install tiger-vnc && vncviewer 127.0.0.1:5900)"
echo ""
echo "=== In the editor (VNC) ==="
echo "  Edit → Plugins → enable Fab → restart if asked"
echo "  Window → Fab → sign in (device code in this terminal if panel is blank)"
echo "  Add 8K Savannah Landscape Pack → wait → File → Save All → quit"
echo ""
echo "Launching UnrealEditor ..."
run bash -lc "export DISPLAY=:99
  exec $ENGINE/Engine/Binaries/Linux/UnrealEditor \
    /project/YellowWorld.uproject -log -ResX=1280 -ResY=720"
