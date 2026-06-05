#!/usr/bin/env bash
# Natural-language prompt -> brain (LLM) -> rc-bridge -> live Unreal, over the
# Remote Control tunnel. This is the Phase-4 vertical slice for SCRIPTED
# behaviour: you type a sentence, the herd performs it in the streamed world.
#
# Prereqs — each in its own terminal, from ue/ :
#   1. UE streaming with Remote Control on, on the savanna map that has the
#      CreatureDirector authored into it:
#        YELLOW_MAP=/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1 npm run ue:run-rc
#   2. The RC tunnel so the VM's :30010 is reachable locally:
#        npm run ue:rc-tunnel
#
# Then, from the repo root:
#   scripts/scene.sh "the elephant herd migrates to the watering hole at sunset and drinks"
#
# Env:
#   RC_BASE_URL       RC web server  (default http://127.0.0.1:30010 — the tunnel)
#   RC_CREATURE_PATH  CreatureDirector object path (default = Landscape_1 CreatureDirector_0;
#                     see the add_creatures.py author log if it differs)
#   GOOGLE_API_KEY    if set (or in packages/brain/.env), the brain uses Gemini;
#                     otherwise the deterministic offline FakeProvider.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT="${*:?usage: scene.sh <natural language prompt>}"
RC_URL="${RC_BASE_URL:-http://127.0.0.1:30010}"

echo "== brain: planning ==" >&2
PLAN="$(cd "$ROOT/packages/brain" && uv run python -m brain.plan "$PROMPT")"
echo "  plan: $PLAN" >&2
echo >&2

echo "== bridge: executing over $RC_URL ==" >&2
printf '%s' "$PLAN" | (
  cd "$ROOT/packages/rc-bridge" &&
    RC_BASE_URL="$RC_URL" ./node_modules/.bin/tsx src/cli.ts run --url "$RC_URL"
)
