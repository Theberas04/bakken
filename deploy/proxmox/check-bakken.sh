#!/usr/bin/env bash
# Alleen-lezen diagnose van een Bakken-container. Verandert niets.
#
#   bash check-bakken.sh [CTID]
#
# Zonder nummer zoekt het de container waar Bakken in staat, zodat je niets hoeft te weten.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/bakken}"
DATA_DIR="${DATA_DIR:-/var/lib/bakken}"
POORT="${POORT:-80}"

# Geen nummer meegegeven? Zoek de container waar Bakken in staat.
if [ -z "${CTID:-}" ]; then
  if command -v pct >/dev/null 2>&1; then
    for kandidaat in $(pct list | awk 'NR > 1 {print $1}'); do
      if pct exec "$kandidaat" -- test -d "$APP_DIR" 2>/dev/null; then CTID="$kandidaat"; break; fi
    done
  fi
fi
if [ -z "${CTID:-}" ]; then
  echo "Gebruik: bash check-bakken.sh <CTID>   (het nummer vind je met 'pct list')" >&2
  exit 2
fi

kop() { echo; echo "--- $* ---"; }
binnen() { pct exec "$CTID" -- bash -c "$1" 2>&1; }

kop "Container $CTID op de host"
pct status "$CTID" 2>&1
pct config "$CTID" 2>&1 | grep -E '^(hostname|memory|cores|rootfs|net0|onboot)' || true

kop "Netwerk in de container"
binnen "ip -4 -o addr show | sed 's/^/  /'"
binnen "ip route | sed 's/^/  /'"

kop "Dienst"
binnen "systemctl is-enabled bakken 2>&1; systemctl is-active bakken 2>&1"
binnen "systemctl status bakken --no-pager -l 2>&1 | tail -15"

kop "Node en de module node:sqlite"
binnen "node --version 2>&1"
binnen "node -e \"require('node:sqlite'); console.log('node:sqlite werkt')\" 2>&1 | tail -3"

kop "Antwoordt de app"
binnen "curl -fsS http://127.0.0.1:$POORT/healthz 2>&1 | head -2"

kop "Wat luistert er op poort $POORT"
binnen "ss -ltnpH 'sport = :$POORT' 2>&1 || echo '  niets'"

kop "Geheugen en schijf"
binnen "free -m | sed 's/^/  /'"
binnen "df -h / | sed 's/^/  /'"

kop "Bestanden"
binnen "ls -la $APP_DIR 2>&1 | head -15"
binnen "ls -la $DATA_DIR 2>&1 | head -10"

kop "Laatste regels uit het journaal"
binnen "journalctl -u bakken -n 25 --no-pager 2>&1"

kop "Wat nu?"
cat <<'HULP'
  - Staat de dienst niet actief?            pct exec <CTID> -- systemctl restart bakken
  - node:sqlite ontbreekt?                  Installeer Node 22:
      pct exec <CTID> -- bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'
  - Niets luistert op de poort?             pct exec <CTID> -- systemctl status bakken --no-pager -l
  - De app antwoordt niet op /healthz?      pct exec <CTID> -- journalctl -u bakken -n 50 --no-pager
  - Bijwerken naar de nieuwste versie:
      bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/update-from-github.sh)"
HULP
