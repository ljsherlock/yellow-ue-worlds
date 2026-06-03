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
DOCKER="${DOCKER:-}"
GPUS="${GPUS:---gpus all}"
CONTAINER="${CONTAINER:-yellow-build}"
MAP="${MAP:-/Game/Maps/Spike}"

[[ -f "$PROJECT_DIR/YellowWorld.uproject" ]] \
  || { echo "No YellowWorld.uproject under $PROJECT_DIR — did you 'npm run ue:sync'?"; exit 1; }

# Pick the working docker invocation: plain if the user is in the docker group,
# else sudo. (A permission-denied 'docker' would otherwise masquerade as a
# missing image.) Honour an explicit $DOCKER override.
if [[ -n "${DOCKER:-}" ]]; then
  :
elif docker info >/dev/null 2>&1; then
  DOCKER="docker"
elif sudo docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
else
  echo "Cannot talk to the Docker daemon (tried 'docker' and 'sudo docker')."
  echo "Is Docker installed/running on the VM? (startup.sh installs it.)"
  exit 1
fi
echo "Using docker as: $DOCKER"

# Ensure the dev image is present; if not, try to pull it (login creds from the
# one-time 'docker login ghcr.io' are cached in ~/.docker/config.json).
if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not present — pulling (needs a prior 'docker login ghcr.io') ..."
  if ! $DOCKER pull "$IMAGE"; then
    echo "Pull failed. Authenticate once, then re-run the build:"
    echo "  echo <YOUR_GH_PAT> | $DOCKER login ghcr.io -u <YOUR_GH_USERNAME> --password-stdin"
    exit 1
  fi
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

# Megascans JPG import needs Slate; -nullrhi crashes in ImportAssetTasks.
QUARRY_JPG_DIR="/project/ThirdParty/Megascans/south_african_slate_quarry/uddmcgbia"
if [[ -d "$QUARRY_JPG_DIR" ]] && [[ "${YELLOW_QUARRY_GROUND:-1}" != "0" ]]; then
  echo "[2a/3] Importing quarry textures (xvfb — Slate required, no -nullrhi) ..."
  if command -v xvfb-run >/dev/null 2>&1; then
    run xvfb-run -a "$ENGINE/Engine/Binaries/Linux/UnrealEditor-Cmd" \
      /project/YellowWorld.uproject \
      -run=pythonscript -script=/project/Scripts/import_quarry_textures.py \
      -unattended -nosplash -nopause
  else
    echo "WARN: xvfb-run not found — skipping quarry import; make_map will use procedural sand"
    echo "      Install on VM: sudo apt-get install -y xvfb"
  fi
fi

echo "[2b/3] Generating spike level (Scripts/make_map.py, -nullrhi) ..."
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
