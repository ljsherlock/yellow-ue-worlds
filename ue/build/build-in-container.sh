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
#   [2/3] run Scripts/make_map.py headless to (re)generate /Game/Maps/Spike
#         (skipped when SKIP_MAKE_MAP=1, e.g. cooking an imported map),
#   [3/3] RunUAT BuildCookRun → cook + stage + pak + archive a Linux build.
#
# Map is chosen by MAP (default /Game/Maps/Spike). To cook an imported map
# instead: MAP=/Game/<pack>/<...>/Map SKIP_MAKE_MAP=1 bash build-in-container.sh
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

# Compile-only validation switch: stop right after the editor target builds.
# Useful for verifying new C++ (e.g. CreatureDirector/SceneCreature) compiles
# without paying for the map-author + cook + package passes.
if [[ "${BUILD_ONLY:-0}" == "1" ]]; then
  echo "BUILD_ONLY=1 — editor target compiled OK, skipping map/cook/package."
  exit 0
fi

# Steps [2a]+[2b] build the procedural spike level. Skip them when cooking an
# imported map (e.g. the Savannah pack): set SKIP_MAKE_MAP=1 (vm.sh sets this
# automatically when YELLOW_MAP is given). Default keeps the spike behaviour.
if [[ "${SKIP_MAKE_MAP:-0}" == "1" ]]; then
  echo "[2/3] SKIP_MAKE_MAP=1 — skipping quarry import + make_map.py (cooking MAP=$MAP as-is)."
  if [[ "${ADD_WATER:-0}" == "1" ]]; then
    # Author a real Water plugin lake. AWaterBodyLake's spawn asserts on Slate
    # (CurrentBaseApplication.IsValid()) in a -nullrhi commandlet, so we must
    # drive the FULL editor headless under xvfb and run the script on first tick.
    # add_water_lake.py also repositions the PlayerStart over the lake, so this
    # supersedes the [2c] centering step. Tunable via WATER_X/Y/Z/R + SPAWN_*.
    echo "[2w/3] Authoring water lake via full editor (xvfb — Slate required) ..."
    $DOCKER exec -u root "$CONTAINER" bash -lc \
      'command -v xvfb-run >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq xvfb mesa-vulkan-drivers; }'
    # Run the editor detached; it commonly wedges in the render loop AFTER the
    # (synchronous) save, so we poll the log for the save marker and then kill it
    # rather than waiting on a clean QUIT_EDITOR.
    $DOCKER exec -d \
      -e MAP="$MAP" -e WATER_X -e WATER_Y -e WATER_Z -e WATER_R \
      -e WATER_CARVE -e SPAWN_OVER_LAKE -e SPAWN_HEIGHT -e SPAWN_PITCH \
      --workdir / "$CONTAINER" bash -lc \
      "xvfb-run -a -s '-screen 0 320x240x24' '$ENGINE/Engine/Binaries/Linux/UnrealEditor' \
        /project/YellowWorld.uproject \
        -ExecCmds='t.MaxFPS 8, py /project/Scripts/add_water_lake.py' \
        -norhithread -unattended -nosplash -nopause -ResX=320 -ResY=240 -stdout \
        > /tmp/water-author.log 2>&1"
    water_ok=0
    for _ in $(seq 1 120); do   # up to ~20 min for a cold-DDC first author
      if $DOCKER exec "$CONTAINER" bash -lc 'grep -aq "\[water\] saved" /tmp/water-author.log 2>/dev/null'; then
        water_ok=1; break
      fi
      if $DOCKER exec "$CONTAINER" bash -lc 'grep -aqE "Fatal error|Signal 1[12]|appError" /tmp/water-author.log 2>/dev/null'; then
        break
      fi
      sleep 10
    done
    $DOCKER exec -u root "$CONTAINER" bash -lc 'pkill -9 -f UnrealEditor; pkill -9 -f Xvfb; true'
    if [[ "$water_ok" == "1" ]]; then
      echo "[2w/3] Water lake authored + saved into $MAP."
      # Tearing the xvfb editor down and immediately cooking in the same run has
      # proven flaky (the run dies right after the save). AUTHOR_ONLY=1 lets us
      # author cleanly here, then run a separate cook-only pass (ADD_WATER=0
      # CENTER_START=0) which is reliable.
      if [[ "${AUTHOR_ONLY:-0}" == "1" ]]; then
        echo "AUTHOR_ONLY=1 — authored only, skipping cook (run a cook-only pass next)."
        exit 0
      fi
    else
      echo "ERROR: water authoring did not reach save — aborting before cook. Tail:"
      $DOCKER exec "$CONTAINER" bash -lc 'tail -30 /tmp/water-author.log' || true
      exit 1
    fi
  elif [[ "${ADD_CREATURES:-0}" == "1" ]]; then
    # Bake the ACreatureDirector into the map so Remote Control can address it at
    # runtime. A plain AActor needs no Slate, so -nullrhi is fine (unlike the
    # water lake). Creature types/instances are driven at runtime via RC; the
    # pack is force-cooked via DirectoriesToAlwaysCook. The director's object
    # path is logged — copy it into the runtime scene driver.
    echo "[2cr/3] Authoring CreatureDirector into $MAP (add_creatures.py, -nullrhi) ..."
    $DOCKER exec -i -e MAP="$MAP" --workdir / "$CONTAINER" \
      "$ENGINE/Engine/Binaries/Linux/UnrealEditor-Cmd" \
      /project/YellowWorld.uproject \
      -run=pythonscript -script=/project/Scripts/add_creatures.py \
      -unattended -nullrhi -nosplash -nopause
  elif [[ "${CENTER_START:-1}" != "0" ]]; then
    # Imported packs spawn the pawn at the map edge / origin. Re-centre the
    # PlayerStart on the terrain so the streamed view starts mid-map. Opt out with
    # CENTER_START=0. Pass MAP into the container (docker exec doesn't inherit it).
    echo "[2c/3] Centering PlayerStart on $MAP (center_player_start.py, -nullrhi) ..."
    $DOCKER exec -i -e MAP="$MAP" --workdir / "$CONTAINER" \
      "$ENGINE/Engine/Binaries/Linux/UnrealEditor-Cmd" \
      /project/YellowWorld.uproject \
      -run=pythonscript -script=/project/Scripts/center_player_start.py \
      -unattended -nullrhi -nosplash -nopause
  fi
else
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
fi

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
