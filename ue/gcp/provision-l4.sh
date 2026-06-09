#!/usr/bin/env bash
# Provision a single GCP L4 GPU VM for the UE Pixel Streaming spike (Track D).
# Run from your Mac with your own `gcloud` auth. Override any var inline, e.g.:
#   PROJECT=my-proj ZONE=us-central1-a ./provision-l4.sh
#
# Tear down when done (L4 bills per hour!):  ./teardown.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-central1-a}"          # must be a zone with stock + your quota
INSTANCE="${INSTANCE:-ue-pixelspike}"
DISK_GB="${DISK_GB:-300}"               # dev-5.7 unpacks to ~100GB+; leave room to cook
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu-2204-lts}"
IMAGE_PROJECT="${IMAGE_PROJECT:-ubuntu-os-cloud}"
SPOT="${SPOT:-true}"                    # preemptible; cheap and fine for a spike
GPU="${GPU:-l4}"                        # l4 (G2, built-in) | t4 (N1 + accelerator flag)
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "$PROJECT" ]]; then
  echo "Set PROJECT=... (or run: gcloud config set project <id>)"; exit 1
fi

# GPU selection. L4 lives in the G2 machine family (no --accelerator flag);
# T4 attaches to an N1 machine via an explicit accelerator flag. T4 is the
# reliable fallback when L4 capacity is exhausted — it does hardware NVENC
# (H.264) which is all Spike 1a needs (AV1/throughput edges of L4 only matter
# for the later cost model).
flags=(--maintenance-policy=TERMINATE)   # required for GPU VMs
case "$GPU" in
  l4)
    MACHINE="${MACHINE:-g2-standard-8}"   # 1x NVIDIA L4, built in
    GPU_DESC="1x L4"
    ;;
  t4)
    MACHINE="${MACHINE:-n1-standard-8}"
    flags+=(--accelerator=type=nvidia-tesla-t4,count=1)
    GPU_DESC="1x T4"
    ;;
  *)
    echo "Unknown GPU='$GPU' (use 'l4' or 't4')"; exit 1
    ;;
esac

if [[ "$SPOT" == "true" ]]; then
  flags+=(--provisioning-model=SPOT --instance-termination-action=STOP)
fi

# Reserve a stable external IP so the public address survives stop/start and
# destroy/recreate (ephemeral IPs change on every start, which breaks DNS/TLS).
# Idempotent: reuse the reservation if it already exists. The instance is then
# pinned to it via --address below.
ADDR_NAME="${INSTANCE}-ip"
REGION="${ZONE%-*}"
if ! gcloud compute addresses describe "$ADDR_NAME" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  echo "Reserving static IP '$ADDR_NAME' in $REGION ..."
  gcloud compute addresses create "$ADDR_NAME" --region="$REGION" --project="$PROJECT"
fi
STATIC_IP=$(gcloud compute addresses describe "$ADDR_NAME" --region="$REGION" --project="$PROJECT" --format='get(address)')
echo "Static IP ($ADDR_NAME): $STATIC_IP"

echo "Creating $INSTANCE ($MACHINE = $GPU_DESC) in $ZONE of project $PROJECT ..."
gcloud compute instances create "$INSTANCE" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --image-family="$IMAGE_FAMILY" \
  --image-project="$IMAGE_PROJECT" \
  --boot-disk-size="${DISK_GB}GB" \
  --boot-disk-type=pd-ssd \
  --address="$STATIC_IP" \
  --metadata-from-file=startup-script="$HERE/startup.sh" \
  --tags=pixelstreaming \
  "${flags[@]}"

# Firewall — ports verified against UE 5.7 docs + coturn (2026-06-02):
#   80   player/HTTP (signalling web server)
#   443  HTTPS (if you terminate TLS)
#   3478/5349 STUN/TURN (coturn), TCP+UDP
#   49152-65535 UDP — WebRTC media relay range
# (8888 streamer<->signalling stays localhost in a single-VM deploy.)
echo "Ensuring firewall rule 'pixelstreaming-allow' ..."
if gcloud compute firewall-rules describe pixelstreaming-allow --project="$PROJECT" >/dev/null 2>&1; then
  echo "  (rule already exists — skipping)"
else
  # Note: defaults to source-range 0.0.0.0/0 (public). Set --source-ranges=<your-ip>/32
  # below while testing if you want to keep it private.
  gcloud compute firewall-rules create pixelstreaming-allow \
    --project="$PROJECT" \
    --direction=INGRESS \
    --allow=tcp:80,tcp:443,tcp:3478,udp:3478,tcp:5349,udp:5349,udp:49152-65535 \
    --target-tags=pixelstreaming \
    --description="UE Pixel Streaming: HTTP(80/443), STUN/TURN(3478/5349), WebRTC media(UDP 49152-65535)"
fi

EXT_IP=$(gcloud compute instances describe "$INSTANCE" --zone "$ZONE" --project "$PROJECT" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo
echo "VM up. External IP: $EXT_IP"
echo "Next:"
echo "  1) SSH in:        gcloud compute ssh $INSTANCE --zone $ZONE --project $PROJECT"
echo "  2) Wait for startup to finish:  tail -f /var/log/startup.log  (then 'nvidia-smi')"
echo "  3) docker login ghcr.io  (use your GitHub PAT), then pull the UE images."
