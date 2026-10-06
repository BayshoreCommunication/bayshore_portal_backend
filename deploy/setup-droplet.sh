#!/usr/bin/env bash
# One-time droplet bootstrap. Run as root:
#   scp -r deploy root@<droplet-ip>:/root/bayshoreportal_deploy
#   ssh root@<droplet-ip> 'bash /root/bayshoreportal_deploy/setup-droplet.sh "<deploy public key>" [api domain]'
# Safe to re-run. The droplet is shared with other apps, so this only adds things:
# its own user, its own Node, its own folder and its own nginx site. It expects
# nginx (and certbot, for HTTPS) to be installed already and leaves the firewall alone.
set -euo pipefail

DEPLOY_PUBKEY="${1:?usage: setup-droplet.sh \"<deploy public key>\" [api domain]}"
DOMAIN="${2:-}"
APP_USER="bayshoreportal"
APP_NAME="bayshoreportal_backend"
APP_DIR="/var/www/$APP_NAME"
NODE_VERSION="v22.23.3"
NODE_SHA256="df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de"
NODE_DIR="/opt/node22"
NGINX_SITE="/etc/nginx/sites-available/$APP_NAME"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

# Node 22 from the official tarball, kept in its own folder so it cannot disturb
# root's nvm install or the distro packages.
if [ "$("$NODE_DIR/bin/node" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c -
  rm -rf "$NODE_DIR.new"
  mkdir -p "$NODE_DIR.new"
  tar -xJf "$tmp/node.tar.xz" -C "$NODE_DIR.new" --strip-components=1
  rm -rf "$NODE_DIR"
  mv "$NODE_DIR.new" "$NODE_DIR"
  rm -rf "$tmp"
fi
export PATH="$NODE_DIR/bin:$PATH"
[ -x "$NODE_DIR/bin/pm2" ] || npm install -g pm2 --no-audit --no-fund
for bin in node npm npx pm2; do
  ln -sfn "$NODE_DIR/bin/$bin" "/usr/local/bin/$bin"
done

# Unprivileged user the app runs as and the GitHub Actions deploy logs in as (no sudo).
id "$APP_USER" &>/dev/null || adduser --disabled-password --gecos "" "$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
AUTHORIZED_KEYS="/home/$APP_USER/.ssh/authorized_keys"
touch "$AUTHORIZED_KEYS"
grep -qxF "$DEPLOY_PUBKEY" "$AUTHORIZED_KEYS" || echo "$DEPLOY_PUBKEY" >> "$AUTHORIZED_KEYS"
chown "$APP_USER:$APP_USER" "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"

install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/incoming"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/shared"
if [ ! -e "$APP_DIR/shared/.env" ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /dev/null "$APP_DIR/shared/.env"
fi

# Bring the app back after a reboot.
env PATH="$NODE_DIR/bin:$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

cat > "/etc/logrotate.d/$APP_NAME" <<EOF
/home/$APP_USER/.pm2/logs/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
    su $APP_USER $APP_USER
}
EOF

# Nginx site, only once the API has a domain. Certbot rewrites the file to add
# TLS, so leave it alone after that.
if [ -z "$DOMAIN" ]; then
  echo "No domain given; skipping the nginx site."
elif [ -f "$NGINX_SITE" ] && grep -q "managed by Certbot" "$NGINX_SITE"; then
  echo "Nginx site already has TLS from certbot; not overwriting it."
else
  sed "s/__SERVER_NAME__/$DOMAIN/" "$HERE/nginx.conf" > "$NGINX_SITE"
  ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/$APP_NAME"
  nginx -t
  systemctl reload nginx
fi

PUBLIC_IP="$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<EOF

Droplet is ready.

1. Put the production env in $APP_DIR/shared/.env (owner $APP_USER, mode 600).
2. Add these GitHub Actions secrets to the repository:
     DO_HOST         $PUBLIC_IP
     DO_USER         $APP_USER
     DO_KNOWN_HOSTS  $PUBLIC_IP $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
     DO_SSH_KEY      the private half of the deploy key you passed in
3. Once DNS for the API domain points here, turn on HTTPS:
     certbot --nginx --redirect -d ${DOMAIN:-<api domain>}
EOF
