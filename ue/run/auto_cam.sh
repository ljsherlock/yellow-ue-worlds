#!/usr/bin/env bash
# Auto-cycling demo camera.
#
# WHY THIS EXISTS: the in-browser camera buttons (emitUIInteraction ->
# StreamBridge) are currently broken — the engine receives the UI message but
# never dispatches it to our handler. The camera *Remote Control* verbs
# (FocusCamera / FocusHerdOverview on the CreatureDirector) work fine, so for
# demoing we drive the (single, shared) stream camera server-side over RC.
#
# Behaviour: every AUTO_CAM_INTERVAL seconds, follow the next elephant in the
# herd (FocusCamera, a tracking shot). It deliberately does NOT use the herd
# overview, because that clears the follow target and drops the fly pawn at a
# static spot — once the herd walks off it looks like an abandoned manual/free
# camera. So the cycle is purely: animal#1, animal#2, animal#3, … always a live
# follow. The creature ids are re-queried each step, so a scene rebuilt by a
# prompt (new ids) is picked up automatically.
#
# Runs until Remote Control becomes unreachable (stream stopped) a few times in
# a row, then exits so it doesn't linger. run-stream.sh launches it in the
# background when DEMO=1; disable with AUTO_CAM=0.
set -uo pipefail

RC="${RC_URL:-http://127.0.0.1:30010}"
OBJ="${OBJ:-/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1.Landscape_1:PersistentLevel.CreatureDirector_0}"
INTERVAL="${AUTO_CAM_INTERVAL:-15}"

call() {
  # args: functionName, parameters-json. Echoes the raw RC response.
  curl -s -m 8 -X PUT "$RC/remote/object/call" \
    -H "Content-Type: application/json" \
    -d "{\"objectPath\":\"$OBJ\",\"functionName\":\"$1\",\"parameters\":$2,\"generateTransaction\":false}"
}

# Sorted creature ids from QueryCreatures. RC wraps the array as a JSON string
# under the ReturnValue key, so parse twice.
ids() {
  call QueryCreatures "{}" | python3 -c '
import sys, json
try:
    outer = json.load(sys.stdin)
    rv = outer.get("ReturnValue", outer) if isinstance(outer, dict) else outer
    arr = json.loads(rv) if isinstance(rv, str) else rv
    print("\n".join(c["id"] for c in arr if isinstance(c, dict) and c.get("id")))
except Exception:
    pass
' 2>/dev/null
}

echo "[auto-cam] following each elephant in turn every ${INTERVAL}s over RC ($RC)"
animal=0    # index into the current id list
fails=0

while true; do
  if ! curl -s -m 4 -o /dev/null "$RC/remote/info" 2>/dev/null; then
    fails=$(( fails + 1 ))
    if (( fails >= 3 )); then
      echo "[auto-cam] Remote Control unreachable ${fails}x — stream gone, exiting."
      exit 0
    fi
    sleep "$INTERVAL"
    continue
  fi
  fails=0

  mapfile -t LIST < <(ids)
  COUNT=${#LIST[@]}

  if (( COUNT == 0 )); then
    # No creatures yet (scene empty / mid-rebuild) — hold, don't free the cam.
    sleep "$INTERVAL"
    continue
  fi

  ID="${LIST[$(( animal % COUNT ))]}"
  call FocusCamera "{\"Id\":\"$ID\"}" >/dev/null
  animal=$(( animal + 1 ))
  sleep "$INTERVAL"
done
