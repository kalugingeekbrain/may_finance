#!/bin/sh
set -eu
cd /home/pigsuvskrot/pair-budget
sudo -n docker compose -f compose.yaml -f compose.server.yaml up -d --build
curl --retry 8 --retry-all-errors --retry-delay 2 -fsS http://127.0.0.1:8080/ -o /dev/null
if ! sudo -n grep -q '^budget.158-160-250-19.sslip.io {' /opt/portal/Caddyfile; then
  sudo -n cp -p /opt/portal/Caddyfile /opt/portal/Caddyfile.before-budget
  cat budget.caddy | sudo -n tee -a /opt/portal/Caddyfile > /dev/null
fi
if ! sudo -n docker exec portal-caddy-1 caddy validate --config /etc/caddy/Caddyfile; then
  sudo -n cp -p /opt/portal/Caddyfile.before-budget /opt/portal/Caddyfile
  exit 1
fi
sudo -n docker exec portal-caddy-1 caddy reload --config /etc/caddy/Caddyfile
