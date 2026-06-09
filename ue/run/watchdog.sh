#!/usr/bin/env bash
# Minimal stream watchdog. Polls the streamed app's Remote Control endpoint; if
# it is unreachable for several consecutive checks (the app crashed or hung), it
# relaunches the stream via restart_stream.sh, then waits out a cooldown while
# the new app boots before resuming checks.
#
# Scope (honest): this catches CRASHES and full HANGS (RC stops answering). It
# does NOT detect a "wedged" streamer that is still alive on RC but no longer
# accepting WebRTC peers — the signalling server exposes no streamer-list HTTP
# endpoint to probe for that. Add such a check here if one becomes available.
#
# Runs in its own tmux session, independent of the stream's lifecycle:
#   tmux new-session -d -s watchdog "bash ~/ue/run/watchdog.sh > /tmp/watchdog.log 2>&1"
set -uo pipefail

RC="${RC_URL:-http://127.0.0.1:30010}"
RESTART="${RESTART_SCRIPT:-$HOME/ue/run/restart_stream.sh}"
CHECK_INTERVAL="${WATCHDOG_INTERVAL:-60}"   # seconds between checks
FAIL_THRESHOLD="${WATCHDOG_FAILS:-3}"       # consecutive misses before a restart
BOOT_COOLDOWN="${WATCHDOG_COOLDOWN:-180}"   # seconds to wait after a restart

ts() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }
echo "[watchdog $(ts)] up: RC=$RC interval=${CHECK_INTERVAL}s threshold=$FAIL_THRESHOLD"

fails=0
while true; do
  if curl -s -o /dev/null -m 5 "$RC/remote/info" 2>/dev/null; then
    if (( fails > 0 )); then echo "[watchdog $(ts)] RC healthy again (was failing $fails)"; fi
    fails=0
  else
    fails=$(( fails + 1 ))
    echo "[watchdog $(ts)] RC unreachable ($fails/$FAIL_THRESHOLD)"
    if (( fails >= FAIL_THRESHOLD )); then
      echo "[watchdog $(ts)] threshold hit -> restarting stream via $RESTART"
      if [[ -f "$RESTART" ]]; then
        bash "$RESTART" || echo "[watchdog $(ts)] restart script errored"
      else
        echo "[watchdog $(ts)] restart script not found: $RESTART"
      fi
      fails=0
      echo "[watchdog $(ts)] cooldown ${BOOT_COOLDOWN}s while the app boots"
      sleep "$BOOT_COOLDOWN"
      continue
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
