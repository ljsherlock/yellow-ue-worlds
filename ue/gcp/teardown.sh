#!/usr/bin/env bash
# Delete the spike VM (and optionally the firewall rule). L4 bills per hour, so
# run this the moment you're done testing.
set -euo pipefail
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-central1-a}"
INSTANCE="${INSTANCE:-ue-pixelspike}"

echo "Deleting instance $INSTANCE in $ZONE ..."
gcloud compute instances delete "$INSTANCE" --zone "$ZONE" --project "$PROJECT" --quiet || true

if [[ "${DELETE_FIREWALL:-false}" == "true" ]]; then
  gcloud compute firewall-rules delete pixelstreaming-allow --project "$PROJECT" --quiet || true
fi
echo "Done."
