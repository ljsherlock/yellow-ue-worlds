#!/usr/bin/env bash
# Headless build + cook + package of YellowWorld inside Epic's official Linux
# dev container (no GUI, no local engine install). Run ON the GPU VM:
#
#   PROJECT_DIR=$HOME/ue/project/YellowWorld bash ~/ue/build/build-in-container.sh
#
# Produces $PROJECT_DIR/Packaged/Linux/YellowWorld.sh (the streamable launcher).
#
# Three steps in one long-lived container:
#   [1/3] build the editor target (compiles our C++ WorldDirector),
#   [2/3] run Scripts/make_map.py headless to (re)generate /Game/Maps/Spike,
#   [3/3] RunUAT BuildCookRun → cook + stage + pak + archive a Linux build.
set -euo pipefail

# --- config (override via env) ---------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-$HOME/ue/project/YellowWorld}"
UE_TAG="${UE_TAG:-dev-5.7}"
IMAGE="${IMAGE:-ghcr.io/epicgames/unreal-engine:${UE_TAG}}"
ENGINE="${ENGINE:-/home/ue4/UnrealEngine}"
DOCKER="${DOCKER:-docker}"
GPUS="${GPUS:---gpus all}"
CONTAINER="${CONTAINER:-yellow-build}"
MAP="${MAP:-/Game/Maps/Spike}"

[[ -f "$PROJECT_DIR/YellowWorld.uproject" ]] \
  || { echo "No YellowWorld.uproject under $PROJECT_DIR — did you 'npm run ue:sync'?"; exit 1; }

if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not present locally. Pull it first (after 'docker login ghcr.io'):"
  echo "  $DOCKER pull $IMAGE"
  exit 1
fi

# Remember who owns the project on the host so we can hand it back at the end —
# this avoids the chown dance (build needs ue4=uid 1000; you need it back to
# run / rsync / edit).
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

# Start a long-lived container with the project bind-mounted at /project.
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "Starting build container ($IMAGE) ..."
$DOCKER run --rm -d --name "$CONTAINER" $GPUS \
  -v "$PROJECT_DIR":/project \
  "$IMAGE" sleep infinity >/dev/null

# Every build command runs inside the container.
run() { $DOCKER exec -i --workdir / "$CONTAINER" "$@"; }

# The image's ue4 user is uid 1000; the VM login user usually isn't, so ue4
# can't write to the bind-mounted project. Chown it to ue4 for the build; the
# EXIT trap restores it to you ($HOST_UID) afterward — win or lose.
echo "Aligning project ownership to ue4 for the build ..."
$DOCKER exec -u root "$CONTAINER" chown -R ue4:ue4 /project

echo "[1/3] Building editor target (compiles C++) ..."
run "$ENGINE/Engine/Build/BatchFiles/Linux/Build.sh" \
  YellowWorldEditor Linux Development \
  -project=/project/YellowWorld.uproject

echo "[2/3] Generating spike level (Scripts/make_map.py) ..."
run "$ENGINE/Engine/Binaries/Linux/UnrealEditor-Cmd" \
  /project/YellowWorld.uproject \
  -run=pythonscript -script=/project/Scripts/make_map.py \
  -unattended -nullrhi -nosplash -nopause

echo "[3/3] Cooking + packaging (RunUAT BuildCookRun) ..."
run "$ENGINE/Engine/Build/BatchFiles/RunUAT.sh" BuildCookRun \
  -utf8output -platform=Linux -clientconfig=Development \
  -project=/project/YellowWorld.uproject \
  -map="$MAP" \
  -noP4 -nodebuginfo -cook -build -stage -prereqs -pak -archive \
  -archivedirectory=/project/Packaged

echo "Done. Packaged build under: $PROJECT_DIR/Packaged/Linux"
echo "Look for the launcher: $PROJECT_DIR/Packaged/Linux/YellowWorld.sh"
echo "(Project ownership restored to you on exit — no manual chown needed.)"
