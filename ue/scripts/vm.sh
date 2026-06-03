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
VM_IP_CACHE="$UE_DIR/.vm-ip"
GF=(--zone "$ZONE" --project "$PROJECT")
SSH_USER="$(whoami)"

# gcloud compute API calls have been hanging for minutes today. When .vm-ip is
# valid, use direct ssh/rsync (seconds). Set UE_FORCE_GCLOUD=1 to skip the fast path.
gcloud_timeout() {
  local secs="$1"
  shift
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" gcloud "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$secs" gcloud "$@"
  else
    perl -e 'alarm shift; exec "gcloud", @ARGV' "$secs" "$@"
  fi
}

ssh_probe() {
  local ip="$1"
  ssh -i "$KEY" -o ConnectTimeout=5 -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new "${SSH_USER}@${ip}" true 2>/dev/null
}

ip_cache_read() {
  [[ -f "$VM_IP_CACHE" ]] || return 1
  tr -d '[:space:]' <"$VM_IP_CACHE"
}

ip_cache_write() {
  echo "$1" >"$VM_IP_CACHE"
}

ip() {
  if [[ "${UE_FORCE_GCLOUD:-}" != "1" ]]; then
    local cached
    if cached="$(ip_cache_read)" && [[ -n "$cached" ]] && ssh_probe "$cached"; then
      echo "$cached"
      return 0
    fi
  fi
  local got
  got="$(gcloud_timeout 90 compute instances describe "$INSTANCE" "${GF[@]}" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
  ip_cache_write "$got"
  echo "$got"
}

ssh_direct() {
  local ip="$1"
  shift
  ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    "${SSH_USER}@${ip}" "$@"
}

ssh_command() {
  if [[ "${UE_FORCE_GCLOUD:-}" == "1" ]]; then
    gcloud compute ssh "$INSTANCE" "${GF[@]}" --command="$1"
    return
  fi
  local cached
  if cached="$(ip_cache_read)" && [[ -n "$cached" ]] && ssh_probe "$cached"; then
    # Plain ssh takes the remote command as a positional arg, not --command= (gcloud only).
    ssh_direct "$cached" "$1"
    return
  fi
  gcloud compute ssh "$INSTANCE" "${GF[@]}" --command="$1"
}

cmd="${1:-help}"; shift || true

case "$cmd" in
  # --- lifecycle ----------------------------------------------------------
  provision) PROJECT="$PROJECT" ZONE="$ZONE" INSTANCE="$INSTANCE" bash "$UE_DIR/gcp/provision-l4.sh" ;;
  up)
    gcloud_timeout 180 compute instances start "$INSTANCE" "${GF[@]}"
    nat="$(gcloud_timeout 90 compute instances describe "$INSTANCE" "${GF[@]}" \
      --format='get(networkInterfaces[0].accessConfigs[0].natIP)' || true)"
    [[ -n "$nat" ]] && ip_cache_write "$nat"
    ;;
  down)      gcloud_timeout 120 compute instances stop  "$INSTANCE" "${GF[@]}" ;;
  destroy)   PROJECT="$PROJECT" ZONE="$ZONE" INSTANCE="$INSTANCE" bash "$UE_DIR/gcp/teardown.sh" ;;
  status)
    if [[ "${UE_FORCE_GCLOUD:-}" != "1" ]]; then
      cached="$(ip_cache_read || true)"
      if [[ -n "${cached:-}" ]] && ssh_probe "$cached"; then
        printf 'NAME\tSTATUS\tMACHINE_TYPE\tNAT_IP\n'
        printf '%s\tRUNNING\t(via SSH)\t%s\n' "$INSTANCE" "$cached"
        echo "(fast status: gcloud API skipped; cached IP in ue/.vm-ip)" >&2
        exit 0
      fi
    fi
    echo "Querying gcloud (can take 1–2 min if the API is slow)…" >&2
    out="$(gcloud_timeout 120 compute instances describe "$INSTANCE" "${GF[@]}" \
      --format='table(name,status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP)')"
    echo "$out"
    nat="$(gcloud_timeout 90 compute instances describe "$INSTANCE" "${GF[@]}" \
      --format='get(networkInterfaces[0].accessConfigs[0].natIP)' || true)"
    [[ -n "$nat" ]] && ip_cache_write "$nat"
    ;;
  ip)        ip ;;
  ssh)       gcloud compute ssh "$INSTANCE" "${GF[@]}" "$@" ;;

  # --- sync (Mac -> VM) ---------------------------------------------------
  sync)
    target="$(whoami)@$(ip):~/ue/"
    echo "rsync ue/ -> $target"
    rsync -azhv --delete --stats \
      --exclude='Packaged/' --exclude='Intermediate/' --exclude='Saved/' \
      --exclude='Binaries/' --exclude='Build/' --exclude='DerivedDataCache/' \
      --exclude='project/YellowWorld/Content/' \
      --exclude='project/YellowWorld/Samples/' \
      --exclude='.git/' --exclude='node_modules/' --exclude='.vite/' \
      -e "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      "$UE_DIR/" "$target" ;;
  fix-perms) ssh_command 'sudo chown -R "$USER:$USER" ~/ue' ;;

  # --- build & run (remote) ----------------------------------------------
  build) ssh_command 'PROJECT_DIR=$HOME/ue/project/YellowWorld bash ~/ue/build/build-in-container.sh' ;;
  stage-fab) bash "$UE_DIR/scripts/stage-fab-from-mac.sh" ;;
  fab-import)
    echo "=== [1/3] Stage Fab plugin from Mac UE install ==="
    bash "$UE_DIR/scripts/stage-fab-from-mac.sh"
    echo "=== [2/3] Fix VM ownership + sync ue/ ==="
    "$0" fix-perms
    "$0" sync
    echo "=== [3/3] VM editor + VNC (long-running — keep this terminal open) ==="
    ssh_command 'tmux kill-session -t stream 2>/dev/null; pkill -f "[B]inaries/Linux/YellowWorld" 2>/dev/null; true; PROJECT_DIR=$HOME/ue/project/YellowWorld bash ~/ue/build/fab-import-in-container.sh' ;;
  fab-vnc)
    vm_ip="$(ip)"
    local_port="${UE_VNC_LOCAL_PORT:-5900}"
    if lsof -nP -iTCP:"${local_port}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "WARN: Mac port ${local_port} is already in use. Try:"
      echo "  UE_VNC_LOCAL_PORT=5901 npm run ue:fab-vnc"
      echo "  then connect to vnc://127.0.0.1:5901"
      exit 1
    fi
    if ssh -i "$KEY" -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      "${SSH_USER}@${vm_ip}" 'ss -tln | grep -q ":5900 "' 2>/dev/null; then
      echo "VM 127.0.0.1:5900 is open — starting SSH tunnel (leave this terminal open)."
    else
      echo "WARN: nothing listening on port 5900 on the VM yet."
      echo "      Run npm run ue:fab-import and wait for the VNC instructions."
      exit 1
    fi
    echo "Connect ONLY after this tunnel is running (VNC password: \${FAB_VNC_PASSWORD:-yellowfab}):"
    echo "  Finder → Go → Connect to Server → vnc://127.0.0.1:${local_port}"
    echo "  If Finder fails: brew install tiger-vnc && vncviewer 127.0.0.1:${local_port}"
    ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
      -L "${local_port}:127.0.0.1:5900" "${SSH_USER}@${vm_ip}" -N ;;
  run)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; tmux new-session -d -s stream "RC=0 bash ~/ue/run/run-stream.sh 2>&1 | tee /tmp/stream.log"; echo started'
    echo "Streaming in tmux 'stream'.  Open: http://$(ip)"
    echo "Watch:  npm run ue:logs:app  (UE app)   |   npm run ue:logs  (signalling)" ;;
  run-rc)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; tmux new-session -d -s stream "RC=1 bash ~/ue/run/run-stream.sh 2>&1 | tee /tmp/stream.log"; echo started'
    echo "Streaming (Remote Control ON) in tmux 'stream'.  Open: http://$(ip)" ;;
  stop-app)
    ssh_command 'tmux kill-session -t stream 2>/dev/null; pkill -f "[B]inaries/Linux/YellowWorld" 2>/dev/null; pkill -f SignallingWebServer 2>/dev/null; pkill -f cirrus 2>/dev/null; echo stopped; true' ;;

  # --- remote control (Spike 1b) -----------------------------------------
  # Forward the VM's unauthenticated RC web server (30010) to localhost so the
  # Mac-side rc-bridge can drive it privately. Blocks (run in its own terminal).
  rc-tunnel)
    echo "Tunnel localhost:30010 -> VM:30010 (Ctrl-C to stop). Point rc-bridge at http://127.0.0.1:30010"
    gcloud compute ssh "$INSTANCE" "${GF[@]}" -- -N -L 30010:localhost:30010 ;;

  # --- logs / debug -------------------------------------------------------
  logs)      ssh_command 'tail -n 100 /tmp/ss.log' ;;
  logs-app)  gcloud compute ssh "$INSTANCE" "${GF[@]}" --command='tmux attach -t stream' -- -t ;;
  ports)     ssh_command 'ss -tlnp 2>/dev/null | grep -E ":80|:8888|:30010" || echo "nothing on 80/8888/30010"' ;;

  # --- convenience --------------------------------------------------------
  open)      open "http://$(ip)" ;;
  deploy)    "$0" fix-perms && "$0" sync && "$0" build && "$0" run ;;

  *) echo "usage: vm.sh {provision|up|down|destroy|status|ip|ssh|sync|fix-perms|build|stage-fab|fab-import|fab-vnc|run|run-rc|rc-tunnel|stop-app|logs|logs-app|ports|open|deploy}"; exit 1 ;;
esac
