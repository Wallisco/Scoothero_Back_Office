#!/usr/bin/env bash
# Run as root AFTER you have confirmed you can log in with your SSH key.
# Turns off password logins (root and everyone), keeps root login key-only.
set -euo pipefail

if [ ! -s /root/.ssh/authorized_keys ] && ! grep -qs . /home/*/.ssh/authorized_keys; then
  echo "No authorized SSH keys found. Add your public key first, or you will lock yourself out." >&2
  exit 1
fi

cat > /etc/ssh/sshd_config.d/99-scoothero-hardening.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
CONF

sshd -t
systemctl reload ssh
echo "Password logins are off. Keep this session open and test a NEW key login before closing it."
