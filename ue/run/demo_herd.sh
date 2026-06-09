#!/usr/bin/env bash
# Demo mode: on first load, populate the savanna with a herd of elephants —
# 20 adults + 3 calves — on the shore of the interior basin lake. No explicit
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
# WorldDirector drives the sun/sky/clock (separate actor from the CreatureDirector).
WORLD_OBJ="${WORLD_OBJ:-/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1.Landscape_1:PersistentLevel.WorldDirector_0}"
# Default world clock. BeginPlay does not set time, so a fresh stream otherwise
# inherits the map's baked sun angle; pin it to 9am for a consistent morning open.
START_HOUR="${START_HOUR:-9}"

A_MESH="/Game/Elephant/Meshes/SK_Elephant_Re.SK_Elephant_Re"
B_MESH="/Game/Elephant/Meshes/SK_Elephant_Baby_Re.SK_Elephant_Baby_Re"
CLIPS="idle=/Game/Elephant/Animations/Ele_C_Idle_01.Ele_C_Idle_01;\
walk=/Game/Elephant/Animations/Ele_IP_Walk.Ele_IP_Walk;\
run=/Game/Elephant/Animations/Ele_IP_Run_Forward.Ele_IP_Run_Forward;\
drink=/Game/Elephant/Animations/Ele_C_Drink.Ele_C_Drink"
YAW_OFF="${YAW_OFF:--90}"

# Herd home: the interior basin lake centre (479552,625856). The spiral below
# spawns around this point; CreatureDirector pushes any spawn that lands in the
# water straight out to the dry shore, so the herd rings the lake bank instead of
# the lakebed. The drink target is bound from the lake's own geometry at runtime
# (see BindWaterToLake), so there is no manual water disc here any more.
HOME_X="${HOME_X:-479552}"
HOME_Y="${HOME_Y:-625856}"

ADULTS="${ADULTS:-20}"
CALVES="${CALVES:-3}"

call() { # $1=functionName  $2=parameters-json  (on the CreatureDirector)
  curl -s -m 8 -X PUT "$RC/remote/object/call" \
    -H "Content-Type: application/json" \
    -d "{\"objectPath\":\"$OBJ\",\"functionName\":\"$1\",\"parameters\":$2,\"generateTransaction\":true}" \
    >/dev/null
}

wcall() { # $1=functionName  $2=parameters-json  (on the WorldDirector)
  curl -s -m 8 -X PUT "$RC/remote/object/call" \
    -H "Content-Type: application/json" \
    -d "{\"objectPath\":\"$WORLD_OBJ\",\"functionName\":\"$1\",\"parameters\":$2,\"generateTransaction\":true}" \
    >/dev/null
}

echo "[demo] setting world clock to ${START_HOUR}:00"
wcall SetTimeOfDay "{\"Hours\":$START_HOUR}"

echo "[demo] registering elephant types (yaw offset ${YAW_OFF})"
call DefineCreatureType "{\"Type\":\"elephant_adult\",\"MeshPath\":\"$A_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":260,\"RunSpeed\":600,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"
call DefineCreatureType "{\"Type\":\"elephant_baby\",\"MeshPath\":\"$B_MESH\",\"ClipsCsv\":\"$CLIPS\",\"WalkSpeed\":300,\"RunSpeed\":650,\"UniformScale\":1.0,\"MeshYawOffset\":$YAW_OFF}"

echo "[demo] clearing any prior creatures + releasing follow-cam"
call ClearCreatures "{}"
call StopFocus "{}"

# Drink target = the actual WaterBodyLake geometry (tagged 'yellow_water_lake').
# The director auto-binds this at BeginPlay; re-call here so a manual demo re-run
# (after the level is already live) re-reads the lake too. No hand-set disc.
echo "[demo] binding water source to the authored lake geometry"
call BindWaterToLake "{}"

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

# On load, frame the whole herd (FocusHerdOverview tracks the herd centroid) so
# the stream opens looking at the elephants rather than empty savanna. Override
# with DEMO_FOCUS=a01 (or any id) to follow a single elephant; the UI's "Free
# fly" button still drops to manual WASD/mouse at any time.
sleep 2
if [[ -n "${DEMO_FOCUS:-}" ]]; then
  echo "[demo] follow-cam on ${DEMO_FOCUS}"
  call FocusCamera "{\"Id\":\"${DEMO_FOCUS}\"}"
else
  echo "[demo] herd overview cam at boot (set DEMO_FOCUS=a01 to follow one elephant)"
  call FocusHerdOverview "{}"
fi

echo "[demo] herd live: $ADULTS adults + $CALVES calves. Grazing first, then drinking."
echo "[demo] RC: FocusCamera {\"Id\":\"a01\"} follow · FocusHerdOverview wide · StopFocus free-fly"
