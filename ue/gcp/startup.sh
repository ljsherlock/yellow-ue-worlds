#!/usr/bin/env bash
# Runs automatically on first boot of the L4 VM (passed as startup-script).
# Installs the NVIDIA driver, Docker, and the NVIDIA container toolkit so the
# UE `runtime-pixel-streaming` image can run with GPU access.
# Logs to /var/log/startup.log — tail it after boot to watch progress.
set -euo pipefail
exec > >(tee -a /var/log/startup.log) 2>&1
echo "[startup] $(date -u) begin"

export DEBIAN_FRONTEND=noninteractive
apt-get update
# tmux + rsync are used by the Mac-side ops scripts (npm run ue:run / ue:sync).
apt-get install -y build-essential ca-certificates curl gnupg python3 tmux rsync git

# --- NVIDIA driver via GCP's official cuda_installer (L4/G2 needs R535+) ------
# This is GCP's recommended path for Compute Engine and builds modules against
# the -gcp kernel correctly. It may trigger a reboot; GCE re-runs this startup
# script on every boot, and the installer continues until done. We skip once
# nvidia-smi works, so the reboot loop terminates.
if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi >/dev/null 2>&1; then
  echo "[startup] installing NVIDIA driver via cuda_installer.pyz ..."
  mkdir -p /opt/google/cuda-installer
  cd /opt/google/cuda-installer
  curl -fsSL -O https://storage.googleapis.com/compute-gpu-installation-us/installer/latest/cuda_installer.pyz
  # install_driver only (CUDA toolkit ships inside the UE image); may reboot.
  python3 cuda_installer.pyz install_driver || true
  cd /
fi

# --- Docker engine (skip if already present, e.g. after a driver reboot) ------
# Use Docker's official convenience script: it handles the apt repo + key
# without manual gpg (which fails in GCE's non-interactive startup context with
# "cannot open /dev/tty").
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# --- NVIDIA container toolkit (GPU passthrough into Docker) -------------------
# Note: --no-tty is required here; without it gpg aborts under the startup
# script's ttyless environment and (with pipefail) kills the whole script.
if ! dpkg -s nvidia-container-toolkit >/dev/null 2>&1; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --no-tty --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

# let the login user run docker without sudo (best-effort)
usermod -aG docker "$(getent passwd 1000 | cut -d: -f1)" 2>/dev/null || true

echo "[startup] $(date -u) pass complete."
echo "[startup] The NVIDIA install may reboot the VM and re-run this script;"
echo "[startup] it's finished when 'nvidia-smi' lists the L4. Tail /var/log/startup.log."
