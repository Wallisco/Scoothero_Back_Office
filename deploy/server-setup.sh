#!/usr/bin/env bash
# One-time setup of the HostyAfrica VPS (Ubuntu 22.04 or 24.04). Run as root:
#   DOMAIN=backoffice.scoothero.co.za EMAIL=wahlied@scoothero.co.za bash server-setup.sh
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. backoffice.scoothero.co.za}"
: "${EMAIL:?Set EMAIL for the SSL certificate}"
APP=scoothero-backoffice
APP_USER=deploy
BASE=/var/www/$APP

echo "== Packages"
apt-get update
apt-get install -y curl git nginx postgresql postgresql-contrib ufw fail2ban \
  libreoffice-impress fonts-dejavu fontconfig certbot python3-certbot-nginx
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "== Swap (2 GB safety margin for LibreOffice)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "== Deploy user"
id -u $APP_USER >/dev/null 2>&1 || adduser --disabled-password --gecos "" $APP_USER
mkdir -p /home/$APP_USER/.ssh && chmod 700 /home/$APP_USER/.ssh
touch /home/$APP_USER/.ssh/authorized_keys && chmod 600 /home/$APP_USER/.ssh/authorized_keys
chown -R $APP_USER:$APP_USER /home/$APP_USER/.ssh

echo "== Folders"
mkdir -p $BASE/{releases,shared,storage,backups}
chown -R $APP_USER:$APP_USER $BASE
chmod 750 $BASE/storage $BASE/backups

echo "== Database"
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='backoffice'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE backoffice LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='backoffice'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE backoffice OWNER backoffice;"

if [ ! -f $BASE/shared/.env ]; then
  cat > $BASE/shared/.env <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://backoffice:$DB_PASS@127.0.0.1:5432/backoffice
SESSION_SECRET=$(openssl rand -hex 32)
STORAGE_DIR=$BASE/storage
STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)
APP_URL=https://$DOMAIN
ESIGN_PROVIDER=signeasy
# SIGNEASY_API_KEY=
# SIGNEASY_WEBHOOK_SECRET=
# MAIL_FROM=
ENV
  chown $APP_USER:$APP_USER $BASE/shared/.env && chmod 600 $BASE/shared/.env
  echo "Wrote $BASE/shared/.env (database password generated; not shown)."
fi

echo "== Nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$(dirname "$0")/nginx.conf" > /etc/nginx/sites-available/$APP
ln -sf /etc/nginx/sites-available/$APP /etc/nginx/sites-enabled/$APP
nginx -t && systemctl reload nginx

echo "== Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== SSL"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "== PM2 on boot"
env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER

echo "== Deploy script and GitHub read access"
install -m 750 -o $APP_USER -g $APP_USER "$(dirname "$0")/deploy.sh" $BASE/deploy.sh
if [ ! -f /home/$APP_USER/.ssh/id_ed25519 ]; then
  sudo -u $APP_USER ssh-keygen -t ed25519 -N "" -C "backoffice-server" -f /home/$APP_USER/.ssh/id_ed25519
  sudo -u $APP_USER sh -c "ssh-keyscan github.com >> /home/$APP_USER/.ssh/known_hosts"
fi

echo "== Nightly backups (02:00)"
install -m 750 -o $APP_USER -g $APP_USER "$(dirname "$0")/backup.sh" $BASE/backup.sh
( crontab -u $APP_USER -l 2>/dev/null | grep -v backup.sh; echo "0 2 * * * $BASE/backup.sh >> $BASE/backups/backup.log 2>&1" ) | crontab -u $APP_USER -

echo
echo "Done. Next:"
echo "  1. Add this key to the GitHub repo as a read-only Deploy key:"
cat /home/$APP_USER/.ssh/id_ed25519.pub
echo "  2. Add the GitHub Actions public key to /home/$APP_USER/.ssh/authorized_keys"
echo "  3. Point $DOMAIN's DNS A record at this server (before running certbot, if it failed above)"
echo "  4. Push to main"
