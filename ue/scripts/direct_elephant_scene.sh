#!/usr/bin/env bash
# Drive a directed elephant scene over Remote Control against the running,
# streamed packaged build (RC web server on :30010 — run-stream.sh with RC=1).
#
# Proof-of-concept for "the brain animates Fab creatures": this is exactly the
# shape of call the brain will emit later, just hand-scripted for now. It
#   1) registers the adult + baby elephant *types* (mesh + state->clip map),
#   2) spawns them near the SW watering hole (lake1 @ ~120000,160000),
#   3) makes the baby trail the adult, and
#   4) walks the adult to the shoreline, then both drink.
#
# Usage (on the VM, after the stream is up):
#   OBJ='/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1.Landscape_1:PersistentLevel.CreatureDirector_0' \
#     bash ~/ue/scripts/direct_elephant_scene.sh
# The OBJ path is logged by add_creatures.py at author time ("[creatures] CreatureDirector path=...").
set -uo pipefail

RC="${RC_URL:-http://127.0.0.1:30010}"
OBJ="${OBJ:?set OBJ to the CreatureDirector object path (see add_creatures.py log)}"

A_MESH="/Game/Elephant/Meshes/SK_Elephant_Re.SK_Elephant_Re"
B_MESH="/Game/Elephant/Meshes/SK_Elephant_Baby_Re.SK_Elephant_Baby_Re"
# In-place (Ele_IP_*) locomotion so the legs cycle while WE translate the actor;
# Ele_C_* for the in-place actions (idle/drink).
CLIPS="idle=/Game/Elephant/Animations/Ele_C_Idle_01.Ele_C_Idle_01;\
walk=/Game/Elephant/Animations/Ele_IP_Walk.Ele_IP_Walk;\
run=/Game/Elephant/Animations/Ele_IP_Run_Forward.Ele_IP_Run_Forward;\
drink=/Game/Elephant/Animations/Ele_C_Drink.Ele_C_Drink"

call() { # $1=functionName  $2=parameters-json
  curl -s -m 8 -X PUT "$RC/remote/object/call" \
    -H "Content-Type: application/json" \
    -d "{\"objectPath\":\"$OBJ\",\"functionName\":\"$1\",\"parameters\":$2,\"generateTransaction\":true}"
  echo "  <- $1"
}

# MeshYawOffset corrects the pack's model-forward axis (the elephant walked
# left-flank-first at yaw=0). -90 rotates it so the trunk leads; flip to 90 and
# respawn if it faces the wrong way — it's data now, no recompile.
YAW_OFF="${YAW_OFF:--90}"

echo "== Registering elephant types (yaw offset ${YAW_OFF}) =="
call DefineCreatureType "{\"Type\":\"elephant_adult\",\"MeshPath\":\"$A_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":260,\"RunSpeed\":600,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"
call DefineCreatureType "{\"Type\":\"elephant_baby\",\"MeshPath\":\"$B_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":300,\"RunSpeed\":650,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"

# lake2: the interior basin (center 479552,625856, surface -6000, ~1.3 km).
# SetWaterLevel makes the herd stop at the shoreline instead of wading down the
# collision-less lakebed; it also applies to creatures spawned afterwards.
echo "== Telling creatures the lake2 waterline (-6000) =="
call SetWaterLevel "{\"SurfaceZ\":-6000}"

# Gentle NW rim of lake2 (terrain-probed: ~15 m above the -6000 waterline, dry),
# walking SE down to the water. The E/NE/SW rims are +30..100 m ridges; N and W
# are low. Yaw -53 points the herd toward the lake from the NW.
#
# The calf spawns ~3 m NW of (i.e. just behind, relative to the SE march) the
# matriarch. It MUST start adjacent: the follow logic chases the leader at the
# leader's own speed, so it can only *maintain* a gap, never close one — spawn it
# far away and it stays far away. Behind = NW (path heads SE), so offset -X,+Y.
echo "== Spawning herd on the gentle NW rim of lake2 (calf right behind) =="
call SpawnCreature "{\"Type\":\"elephant_adult\",\"Id\":\"matriarch\",\"X\":389552,\"Y\":745856,\"Yaw\":-53}"
call SpawnCreature "{\"Type\":\"elephant_baby\",\"Id\":\"calf\",\"X\":389342,\"Y\":746066,\"Yaw\":-53}"

# FollowDistance is the trailing gap (cm). 400 cm ≈ 4 m keeps the calf tucked in
# behind the matriarch (the user wants 1–5 m), close enough to read as a pair
# without the bodies clipping.
echo "== Calf trails the matriarch (~4 m) =="
call SetCreatureLeader "{\"Id\":\"calf\",\"LeaderId\":\"matriarch\",\"Distance\":400}"

echo "== Matriarch migrates SE toward lake2; halts at the shoreline =="
call FollowPath "{\"Id\":\"matriarch\",\"PointsCsv\":\"430000,690000;460000,655000;479552,625856\",\"bLoop\":false,\"Speed\":420}"

WALK_SECS="${WALK_SECS:-75}"
echo "== Walking to water (~${WALK_SECS}s) =="
sleep "$WALK_SECS"

echo "== Drink at the hole =="
call SetCreatureState "{\"Id\":\"matriarch\",\"State\":\"drink\"}"
sleep 4
call SetCreatureState "{\"Id\":\"calf\",\"State\":\"drink\"}"

echo "== Scene running. Fly the camera (WASD, Shift=turbo) to frame the herd. =="
echo "   Re-run with different coords/states to direct further."
