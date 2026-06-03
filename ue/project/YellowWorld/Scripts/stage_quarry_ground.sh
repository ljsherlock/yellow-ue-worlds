#!/usr/bin/env bash
# Copy the South African Slate Quarry *surface* (uddmcgbia) into ThirdParty for
# headless import by make_map.py. Run on your Mac after downloading from Bridge/Fab.
#
#   bash Scripts/stage_quarry_ground.sh
#   bash Scripts/stage_quarry_ground.sh /path/to/south_african_slate_quarry_high
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$PROJECT_DIR/ThirdParty/Megascans/south_african_slate_quarry/uddmcgbia"
SRC="${1:-$HOME/Downloads/south_african_slate_quarry_high/uddmcgbia}"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC"
  echo "Unzip south_african_slate_quarry_mid.zip or _high.zip, or pass the uddmcgbia folder."
  exit 1
fi

mkdir -p "$DEST"
for map in Basecolor Normal Roughness AO; do
  # Prefer 2K (smaller cook) if present, else 4K.
  f=""
  for res in 2K 4K; do
    f=$(ls "$SRC"/*_"${res}"_"${map}".jpg 2>/dev/null | head -1 || true)
    [[ -n "$f" ]] && break
  done
  if [[ -z "$f" ]]; then
    echo "WARN: missing ${map} map in $SRC"
    continue
  fi
  cp "$f" "$DEST/"
  echo "staged $(basename "$f")"
done

echo "Done → $DEST ($(du -sh "$DEST" | cut -f1))"
