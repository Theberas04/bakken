#!/usr/bin/env bash
# Richt een bestaande Debian-container in als Bakken-server.
#
#   bash deploy/proxmox/provision-bakken.sh <CTID>
#
# De app-bestanden komen uit $SRC (standaard /opt/bakken-pakket), de map die
# install.sh heeft gevuld. Met SRC=/pad/naar/checkout kun je een lokale werkboom
# naar de container sturen zonder GitHub.
#
# Er wordt GEEN container aangemaakt: Tom gebruikt een bestaande container.
set -euo pipefail

# Het container-id kan als eerste argument komen, via de omgeving (CTID=104 ...)
# of via 'bash -c "$(curl ...)" 104' — dat laatste zet het nummer in $0.
case "${0:-}" in
  *[!0-9]*|"") KANDIDAAT0="" ;;
  *) KANDIDAAT0="$0" ;;
esac
CTID="${1:-${CTID:-$KANDIDAAT0}}"
APP_DIR="${APP_DIR:-/opt/bakken}"
DATA_DIR="${DATA_DIR:-/var/lib/bakken}"
GEBRUIKER="${GEBRUIKER:-bakken}"
POORT="${POORT:-8080}"
SRC="${SRC:-/opt/bakken-pakket}"

if [ "$(id -u)" != "0" ]; then
  echo "Draai dit als root op de Proxmox-host." >&2
  exit 1
fi
if [ -z "$CTID" ]; then
  echo "Gebruik: bash provision-bakken.sh <CTID>" >&2
  exit 1
fi
if ! pct status "$CTID" >/dev/null 2>&1; then
  echo "Container $CTID bestaat niet." >&2
  exit 1
fi

RUNTIME=(
  "server.js"
  "lib/accounts.js"
  "lib/codes.js"
  "lib/db.js"
  "lib/rechten.js"
  "lib/versie.js"
)
PAGINA=(
  "public/index.html"
  "public/styles.css"
  "public/app.js"
  "public/lib/qrcode.js"
  "public/lib/qr.js"
  "public/sw.js"
  "public/manifest.webmanifest"
  "public/icon.svg"
)
DATA=(
  "VERSIE.json"
  "CHANGELOG.md"
  "deploy/proxmox/bijwerken.sh"
)

for f in "${RUNTIME[@]}" "${PAGINA[@]}" "${DATA[@]}"; do
  if [ ! -f "$SRC/$f" ]; then
    echo "Bestand ontbreekt op de host: $SRC/$f" >&2
    echo "Draai eerst deploy/proxmox/install.sh (of zet SRC naar je checkout)." >&2
    exit 1
  fi
done

binnen() { pct exec "$CTID" -- "$@"; }
binnen_bash() { pct exec "$CTID" -- bash -c "$1"; }

echo "== Pakketten installeren in container $CTID"
binnen_bash "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"

echo "== Node.js 22 installeren (node:sqlite vereist 22.5 of nieuwer)"
if ! binnen_bash "test -s /etc/apt/sources.list.d/nodesource.list"; then
  binnen_bash "curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh && bash /tmp/nodesource.sh >/dev/null 2>&1"
  binnen_bash "export DEBIAN_FRONTEND=noninteractive; apt-get install -y -qq nodejs >/dev/null"
fi
if ! binnen_bash "node -e \"require('node:sqlite')\"" >/dev/null 2>&1; then
  echo "Node in de container kan node:sqlite niet laden. Installeer Node 22 of nieuwer handmatig:" >&2
  echo "  pct exec $CTID -- bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'" >&2
  exit 1
fi
echo "   $(binnen_bash "node --version")"

echo "== Gebruiker en mappen"
binnen_bash "id -u $GEBRUIKER >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin $GEBRUIKER"
binnen_bash "install -d -o $GEBRUIKER -g $GEBRUIKER $APP_DIR $APP_DIR/lib $APP_DIR/public $APP_DIR/public/lib $APP_DIR/deploy/proxmox $DATA_DIR $DATA_DIR/media"

echo "== Bestanden naar de container sturen"
for f in "${RUNTIME[@]}"; do pct push "$CTID" "$SRC/$f" "$APP_DIR/$f" --perms 644; done
for f in "${PAGINA[@]}"; do pct push "$CTID" "$SRC/$f" "$APP_DIR/$f" --perms 644; done
for f in "${DATA[@]}"; do pct push "$CTID" "$SRC/$f" "$APP_DIR/$f" --perms 644; done
binnen_bash "chmod 755 $APP_DIR/deploy/proxmox/bijwerken.sh && chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR $DATA_DIR"

# De app moet weten welke versie hij draait; een installatie uit een archief heeft geen .git.
if [ -n "${COMMIT_VAST:-}" ]; then
  binnen_bash "printf '%s\n' '$COMMIT_VAST' > $DATA_DIR/commit.txt"
fi

echo "== Systemd-dienst"
UNIT="$(mktemp)"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Bakken: QR-stickers voor opbergbakken
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GEBRUIKER
Group=$GEBRUIKER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Environment=NODE_ENV=production
Environment=PORT=$POORT
Environment=DATA_DIR=$DATA_DIR
# Bijwerken vanuit de app: dit script haalt de nieuwste versie van GitHub.
Environment=UPDATE_SCRIPT=$APP_DIR/deploy/proxmox/bijwerken.sh
NoNewPrivileges=yes
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITEOF
pct push "$CTID" "$UNIT" /etc/systemd/system/bakken.service --perms 644
rm -f "$UNIT"

binnen_bash "systemctl daemon-reload && systemctl enable bakken >/dev/null 2>&1 && systemctl restart bakken"

echo "== Controle"
OK=0
for poging in $(seq 1 30); do
  if binnen_bash "curl -fsS http://127.0.0.1:$POORT/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  echo "De app antwoordt niet op poort $POORT. Bewijs:" >&2
  binnen_bash "systemctl is-active bakken; systemctl status bakken --no-pager -l | tail -20" >&2 || true
  binnen_bash "ss -ltnpH 'sport = :$POORT' || echo 'niets luistert op $POORT'" >&2 || true
  binnen_bash "journalctl -u bakken -n 25 --no-pager" >&2 || true
  exit 1
fi

if ! binnen_bash "ss -ltnpH 'sport = :$POORT' | grep -q node"; then
  echo "Poort $POORT antwoordt wel, maar niet door node. Wat luistert er:" >&2
  binnen_bash "ss -ltnpH 'sport = :$POORT'" >&2 || true
  exit 1
fi

echo "   $(binnen_bash "curl -fsS http://127.0.0.1:$POORT/healthz")"
echo "Bakken is klaar in container $CTID op poort $POORT."
