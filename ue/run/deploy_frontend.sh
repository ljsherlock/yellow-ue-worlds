#!/usr/bin/env bash
# Deploy the custom Pixel Streaming player (drives overlay + no default UI) to
# the VM's SignallingWebServer. Run ON the VM. Copies our version-controlled
# player.ts/player.html over Epic's reference implementation and rebuilds the
# frontend bundle into SignallingWebServer/www (webpack output path). The
# running signalling server serves www statically, so a browser refresh picks
# up the new UI — no stream restart required for frontend-only changes.
#
#   bash ~/ue/run/deploy_frontend.sh
set -eu

INFRA_DIR="${INFRA_DIR:-$HOME/PixelStreamingInfrastructure}"
SRC_DIR="${SRC_DIR:-$HOME/ue/run/frontend}"
IMPL="$INFRA_DIR/Frontend/implementations/typescript"

# The infra installs its own Node under the signalling server's scripts dir;
# put it on PATH so this works in a non-interactive shell.
export PATH="$INFRA_DIR/SignallingWebServer/platform_scripts/bash/node/bin:$PATH"

[[ -d "$IMPL/src" ]] || { echo "No frontend impl at $IMPL — is the infra cloned/built?"; exit 1; }
[[ -f "$SRC_DIR/player.ts" && -f "$SRC_DIR/player.html" ]] || { echo "Missing source under $SRC_DIR"; exit 1; }

echo "Copying custom player into $IMPL/src ..."
cp "$SRC_DIR/player.ts" "$IMPL/src/player.ts"
cp "$SRC_DIR/player.html" "$IMPL/src/player.html"

# Make sure node is on PATH (the infra pins a version via NODE_VERSION); fall
# back to whatever node is installed.
if command -v node >/dev/null 2>&1; then
  echo "node: $(node --version)"
else
  echo "WARN: node not found on PATH; the webpack build may fail."
fi

echo "Building frontend bundle (webpack prod) -> $INFRA_DIR/SignallingWebServer/www ..."
cd "$IMPL"
npx --yes webpack --config webpack.prod.js

echo "Done. Refresh http://<VM_PUBLIC_IP> to see the drives panel."
