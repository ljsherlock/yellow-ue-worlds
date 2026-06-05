#!/usr/bin/env bash
# Demo mode: on first load, populate the savanna with a herd of elephants —
# 20 adults + 3 calves — on the flat camp shelf (water source colocated). No explicit
# choreography: each adult is autonomous, so the cooked drive/utility layer runs
# the show (graze near home, walk to the water when thirsty, drink, repeat). The
# calves trail three of the adults. The herd's *initial* thirst is seeded here so
# the scene opens with a staggered procession to the water (mirrors the brain
# seeding drives from the prompt — "they walked far" -> thirsty).
#
# Driven entirely over Remote Control against the running streamed build
# (run-stream.sh with RC=1). run-stream.sh calls this automatically when DEMO=1.
#
# Manual run (on the VM, after the stream + RC are up):
#   bash ~/ue/run/demo_herd.sh
set -uo pipefail

RC="${RC_URL:-http://127.0.0.1:30010}"
OBJ="${OBJ:-/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1.Landscape_1:PersistentLevel.CreatureDirector_0}"

A_MESH="/Game/Elephant/Meshes/SK_Elephant_Re.SK_Elephant_Re"
B_MESH="/Game/Elephant/Meshes/SK_Elephant_Baby_Re.SK_Elephant_Baby_Re"
CLIPS="idle=/Game/Elephant/Animations/Ele_C_Idle_01.Ele_C_Idle_01;\
walk=/Game/Elephant/Animations/Ele_IP_Walk.Ele_IP_Walk;\
run=/Game/Elephant/Animations/Ele_IP_Run_Forward.Ele_IP_Run_Forward;\
drink=/Game/Elephant/Animations/Ele_C_Drink.Ele_C_Drink"
YAW_OFF="${YAW_OFF:--90}"

# Herd home: flat checkered camp shelf (terrain-probed z~-5590). Follow-cam frames
# this area; thirsty elephants should not be sent down the basin cliff to lake2.
HOME_X="${HOME_X:-445000}"
HOME_Y="${HOME_Y:-626000}"

# Water source colocated with the camp — a small pool around home, not lake2.
# SetWaterSource(X,Y,Z,Radius) sets where thirsty creatures drink AND the
# shoreline-stop level. Z must be BELOW the camp ground (~-5590) or every graze
# step falsely reads as "atWater" and the herd jitters side-to-side. Thirsty
# elephants walk to the pool rim and drink on path arrival instead.
WATER_X="${WATER_X:-$HOME_X}"
WATER_Y="${WATER_Y:-$HOME_Y}"
WATER_Z="${WATER_Z:--5920}"
WATER_R="${WATER_R:-6000}"

ADULTS="${ADULTS:-20}"
CALVES="${CALVES:-3}"

call() { # $1=functionName  $2=parameters-json
  curl -s -m 8 -X PUT "$RC/remote/object/call" \
    -H "Content-Type: application/json" \
    -d "{\"objectPath\":\"$OBJ\",\"functionName\":\"$1\",\"parameters\":$2,\"generateTransaction\":true}" \
    >/dev/null
}

echo "[demo] registering elephant types (yaw offset ${YAW_OFF})"
call DefineCreatureType "{\"Type\":\"elephant_adult\",\"MeshPath\":\"$A_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":260,\"RunSpeed\":600,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"
call DefineCreatureType "{\"Type\":\"elephant_baby\",\"MeshPath\":\"$B_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":300,\"RunSpeed\":650,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"

echo "[demo] clearing any prior creatures + releasing follow-cam"
call ClearCreatures "{}"
call StopFocus "{}"

echo "[demo] water source = camp pool ($WATER_X,$WATER_Y,$WATER_Z) r=$WATER_R"
call SetWaterSource "{\"X\":$WATER_X,\"Y\":$WATER_Y,\"SurfaceZ\":$WATER_Z,\"Radius\":$WATER_R}"

echo "[demo] spawning $ADULTS adults around home ($HOME_X,$HOME_Y)"
for i in $(seq 1 "$ADULTS"); do
  read -r DX DY < <(awk -v i="$i" 'BEGIN{
    a = (i*47.0) * 3.14159265/180.0;        # spiral angle
    r = 800 + ((i-1)%5)*1400;                # 8..64 m rings
    printf "%.0f %.0f", r*cos(a), r*sin(a);
  }')
  X=$(( HOME_X + DX )); Y=$(( HOME_Y + DY ))
  ID=$(printf "a%02d" "$i")
  call SpawnCreature "{\"Type\":\"elephant_adult\",\"Id\":\"$ID\",\"X\":$X,\"Y\":$Y,\"Yaw\":-53}"
  # Seed thirst below the seek threshold (0.60) so the herd opens grazing calmly;
  # rises over ~20s before anyone walks to water (stagger still spreads the waves).
  T=$(awk -v i="$i" 'BEGIN{printf "%.2f", 0.22 + ((i*3)%6)*0.03}')
  call SetCreatureDrive "{\"Id\":\"$ID\",\"Drive\":\"thirst\",\"Value\":$T}"
  call SetCreatureDrive "{\"Id\":\"$ID\",\"Drive\":\"fatigue\",\"Value\":0.05}"
done

echo "[demo] spawning $CALVES calves trailing adults"
LEADERS=(a01 a07 a13)
for j in $(seq 1 "$CALVES"); do
  LEADER="${LEADERS[$(( (j-1) % ${#LEADERS[@]} ))]}"
  ID=$(printf "c%02d" "$j")
  # Spawn ~3 m behind the leader's home so the follow logic can tuck it in.
  X=$(( HOME_X + (j*250) )); Y=$(( HOME_Y - (j*250) ))
  call SpawnCreature "{\"Type\":\"elephant_baby\",\"Id\":\"$ID\",\"X\":$X,\"Y\":$Y,\"Yaw\":-53}"
  call SetCreatureLeader "{\"Id\":\"$ID\",\"LeaderId\":\"$LEADER\",\"Distance\":400}"
done

echo "[demo] follow-cam on a01 (default demo framing)"
sleep 2
call FocusCamera "{\"Id\":\"a01\"}"

echo "[demo] herd live: $ADULTS adults + $CALVES calves. Grazing first, then drinking."
echo "[demo] RC: FocusCamera {\"Id\":\"a01\"} follow · FocusHerdOverview wide · StopFocus free-fly"
