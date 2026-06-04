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

echo "== Registering elephant types =="
call DefineCreatureType "{\"Type\":\"elephant_adult\",\"MeshPath\":\"$A_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":260,\"RunSpeed\":600,\"UniformScale\":1.0}"
call DefineCreatureType "{\"Type\":\"elephant_baby\",\"MeshPath\":\"$B_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":300,\"RunSpeed\":650,\"UniformScale\":1.0}"

echo "== Spawning herd on the dry ground NE of the watering hole =="
call SpawnCreature "{\"Type\":\"elephant_adult\",\"Id\":\"matriarch\",\"X\":152000,\"Y\":188000,\"Yaw\":225}"
call SpawnCreature "{\"Type\":\"elephant_baby\",\"Id\":\"calf\",\"X\":156000,\"Y\":192000,\"Yaw\":225}"

echo "== Calf trails the matriarch =="
call SetCreatureLeader "{\"Id\":\"calf\",\"LeaderId\":\"matriarch\",\"Distance\":1400}"

echo "== Matriarch migrates to the shoreline =="
call FollowPath "{\"Id\":\"matriarch\",\"PointsCsv\":\"140000,176000;130000,166000;125000,162000\",\"bLoop\":false,\"Speed\":420}"

WALK_SECS="${WALK_SECS:-75}"
echo "== Walking to water (~${WALK_SECS}s) =="
sleep "$WALK_SECS"

echo "== Drink at the hole =="
call SetCreatureState "{\"Id\":\"matriarch\",\"State\":\"drink\"}"
sleep 4
call SetCreatureState "{\"Id\":\"calf\",\"State\":\"drink\"}"

echo "== Scene running. Fly the camera (WASD, Shift=turbo) to frame the herd. =="
echo "   Re-run with different coords/states to direct further."
