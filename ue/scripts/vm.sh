#!/usr/bin/env bash
# Mac-side orchestration for the UE spike VM. Usually invoked via the
# package.json scripts (npm run ue:<cmd> from the ue/ dir), but also runnable
# directly:  scripts/vm.sh <command> [args]
#
# Config via env (with defaults):
#   UE_INSTANCE (ue-pixelspike)  UE_ZONE (us-central1-a)  UE_PROJECT (task-assistant-project)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
UE_DIR="$(cd "$DIR/.." && pwd)"

INSTANCE="${UE_INSTANCE:-ue-pixelspike}"
ZONE="${UE_ZONE:-us-central1-a}"
PROJECT="${UE_PROJECT:-task-assistant-project}"
KEY="$HOME/.ssh/google_compute_engine"
GF=(--zone "$ZONE" --project "$PROJECT")

ip()  { gcloud compute instances describe "$INSTANCE" "${GF[@]}" \
          --format='get(networkInterfaces[0].accessConfigs[0].natIP)'; }
ssh_command() { gcloud compute ssh "$INSTANCE" "${GF[@]}" --command="$1"; }

cmd="${1:-help}"; shift || true

case "$cmd" in
  # --- lifecycle ----------------------------------------------------------
  provision) PROJECT="$PROJECT" ZONE="$ZONE" INSTANCE="$INSTANCE" bash "$UE_DIR/gcp/provision-l4.sh" ;;
  up)        gcloud compute instances start "$INSTANCE" "${GF[@]}" ;;
  down)      gcloud compute instances stop  "$INSTANCE" "${GF[@]}" ;;
  destroy)   PROJECT="$PROJECT" ZONE="$ZONE" INSTANCE="$INSTANCE" bash "$UE_DIR/gcp/teardown.sh" ;;
  status)    gcloud compute instances describe "$INSTANCE" "${GF[@]}" \
               --format='table(name,status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP)' ;;
  ip)        ip ;;
  ssh)       gcloud compute ssh "$INSTANCE" "${GF[@]}" "$@" ;;

  # --- sync (Mac -> VM) ---------------------------------------------------
  sync)
    target="$(whoami)@$(ip):~/ue/"
    echo "rsync ue/ -> $target"
    rsync -azhv --delete --stats \
      --exclude='Packaged/' --exclude='Intermediate/' --exclude='Saved/' \
      --exclude='Binaries/' --exclude='Build/' --exclude='DerivedDataCache/' \
      --exclude='.git/' --exclude='node_modules/' --exclude='.vite/' \
      -e "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      "$UE_DIR/" "$target" ;;
  fix-perms) ssh_command 'sudo chown -R "$USER:$USER" ~/ue' ;;

  # --- build & run (remote) ----------------------------------------------
  build) ssh_command 'PROJECT_DIR=$HOME/ue/project/YellowWorld bash ~/ue/build/build-in-container.sh' ;;
  run)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; tmux new-session -d -s stream "RC=0 bash ~/ue/run/run-stream.sh 2>&1 | tee /tmp/stream.log"; echo started'
    echo "Streaming in tmux 'stream'.  Open: http://$(ip)"
    echo "Watch:  npm run ue:logs:app  (UE app)   |   npm run ue:logs  (signalling)" ;;
  run-rc)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; tmux new-session -d -s stream "RC=1 bash ~/ue/run/run-stream.sh 2>&1 | tee /tmp/stream.log"; echo started'
    echo "Streaming (Remote Control ON) in tmux 'stream'.  Open: http://$(ip)" ;;
  stop-app)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; pkill -f YellowWorld 2>/dev/null; pkill -f SignallingWebServer 2>/dev/null; pkill -f cirrus 2>/dev/null; echo stopped; true' ;;

  # --- logs / debug -------------------------------------------------------
  logs)      ssh_command 'tail -n 100 /tmp/ss.log' ;;
  logs-app)  gcloud compute ssh "$INSTANCE" "${GF[@]}" --command='tmux attach -t stream' -- -t ;;
  ports)     ssh_command 'ss -tlnp 2>/dev/null | grep -E ":80|:8888|:30010" || echo "nothing on 80/8888/30010"' ;;

  # --- convenience --------------------------------------------------------
  open)      open "http://$(ip)" ;;
  deploy)    "$0" sync && "$0" build && "$0" run ;;

  *) echo "usage: vm.sh {provision|up|down|destroy|status|ip|ssh|sync|fix-perms|build|run|run-rc|stop-app|logs|logs-app|ports|open|deploy}"; exit 1 ;;
esac
