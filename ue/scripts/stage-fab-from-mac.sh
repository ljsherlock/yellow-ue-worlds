#!/usr/bin/env bash
# Stage Epic's Fab UE plugin from the Mac Launcher engine install into ue/third-party/
# so the VM fab-import container can mount it. Run on your Mac before npm run ue:fab-import.
#
# One-time in Epic Launcher (Unreal Engine → Library → FAB LIBRARY):
#   "Fab UE Plugin" → Install to Engine  (for UE 5.7.x)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
UE_DIR="$(cd "$DIR/.." && pwd)"
DEST="$UE_DIR/third-party/FabPlugin/Fab"

UE_MAC_ROOT="${UE_MAC_ROOT:-}"
if [[ -z "$UE_MAC_ROOT" ]]; then
  for candidate in \
    "/Users/Shared/Epic Games/UE_5.7" \
    "/Users/Shared/Epic Games/UE_5.7.4"; do
    if [[ -f "$candidate/Engine/Plugins/Fab/Fab.uplugin" ]]; then
      UE_MAC_ROOT="$candidate"
      break
    fi
  done
fi

SRC="${UE_MAC_ROOT:+$UE_MAC_ROOT/Engine/Plugins/Fab}"

if [[ -z "$SRC" || ! -f "$SRC/Fab.uplugin" ]]; then
  echo "Fab plugin not found under /Users/Shared/Epic Games/UE_5.7*/Engine/Plugins/Fab"
  echo ""
  echo "In Epic Games Launcher:"
  echo "  Unreal Engine → Library → FAB LIBRARY → Fab UE Plugin → Install to Engine"
  echo "Then re-run: npm run ue:stage-fab"
  exit 1
fi

echo "Staging Fab plugin from: $SRC"
echo "                   to: $DEST"
mkdir -p "$(dirname "$DEST")"
# Drop Mac-built binaries — Linux editor must compile Fab itself on the VM.
rsync -a --delete \
  --exclude='Binaries/' \
  --exclude='Intermediate/' \
  "$SRC/" "$DEST/"

if [[ ! -d "$DEST/Source" ]]; then
  echo "ERROR: Fab plugin has no Source/ — cannot build for Linux."
  exit 1
fi
echo "OK: Staged Fab Source (no Mac Binaries/). VM will RunUAT BuildPlugin for Linux."

echo "Done. Next: npm run ue:fab-import  (and npm run ue:fab-vnc in another terminal)"
