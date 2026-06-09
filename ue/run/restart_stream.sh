#!/usr/bin/env bash
# Restart the streamed app cleanly: kill the running app + auto-cam + signalling,
# free the signalling port, then relaunch run-stream.sh (DEMO=1 -> RC + 9am clock
# + herd + auto-cycling camera) in the 'stream' tmux session. Safe to call from
# the watchdog or by hand. Does NOT touch the brain service (systemd, port 8000).
#
#   bash ~/ue/run/restart_stream.sh
set -uo pipefail

pkill -f "run/auto_cam.sh" 2>/dev/null || true
tmux kill-session -t autocam 2>/dev/null || true
tmux kill-session -t stream 2>/dev/null || true
pkill -f "Packaged/Linux/YellowWorld" 2>/dev/null || true
sleep 3
# Free the signalling port if a node server is still bound (brain is on 8000).
fuser -k 8888/tcp 2>/dev/null || true
sleep 3
tmux new-session -d -s stream "cd \$HOME/ue/run && bash run-stream.sh > /tmp/stream.log 2>&1"
sleep 2
tmux ls 2>/dev/null || true
