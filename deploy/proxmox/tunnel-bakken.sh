#!/usr/bin/env bash
# Cloudflare Tunnel met een vaste hostnaam aanzetten voor Bakken.
#
# Draai dit op de Proxmox-host als root, met het token uit het Cloudflare-dashboard:
#
#   TOKEN=<token> bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/tunnel-bakken.sh)"
#
# Het nummer van de container hoef je niet te weten: het script zoekt de container waar Bakken in
# staat. De tunnel loopt ín de container, naast de app, en praat met http://127.0.0.1.
#
# Waarom een named tunnel en geen quick tunnel: een quick tunnel krijgt elke keer een nieuwe URL,
# en dan werken de QR-stickers die je al op de bakken hebt geplakt niet meer.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bakken}"
POORT="${POORT:-80}"
TOKEN="${TOKEN:-${TUNNEL_TOKEN:-}}"
CTID="${CTID:-}"

if [ "$(id -u)" != "0" ]; then
  echo "Draai dit als root op de Proxmox-host." >&2
  exit 1
fi
if ! command -v pct >/dev/null 2>&1; then
  echo "Dit lijkt geen Proxmox-host: pct ontbreekt." >&2
  exit 1
fi

# Geen nummer meegegeven? Zoek de container waar Bakken in staat.
if [ -z "$CTID" ]; then
  for kandidaat in $(pct list | awk 'NR > 1 {print $1}'); do
    if pct exec "$kandidaat" -- test -d "$APP_DIR" 2>/dev/null; then CTID="$kandidaat"; break; fi
  done
fi
if [ -z "$CTID" ]; then
  echo "Geen container met Bakken erin gevonden ($APP_DIR). Draai eerst de installatie." >&2
  exit 2
fi
binnen() { pct exec "$CTID" -- bash -c "$1"; }

if [ -z "$TOKEN" ]; then
  cat >&2 <<'HULP'

Er hoort een token mee. Zo kom je eraan:

  1. Cloudflare-dashboard, Zero Trust, Networks, Tunnels, Create a tunnel
  2. Kies "Cloudflared" en geef de tunnel een naam (bijvoorbeeld "bakken")
  3. Op het scherm "Install and run a connector" staat het token in het commando,
     achter "cloudflared service install". Kopieer dat lange stuk.
  4. Voeg daarna een Public hostname toe:
        Subdomain/domein : het adres waarop de app moet komen
        Service          : HTTP   ->   127.0.0.1
  5. Laat Cloudflare Access UIT. De app heeft zijn eigen inlog; Access zou een
     tweede inlogscherm geven.

Draai dit script daarna opnieuw, met het token ervoor:

  TOKEN=<token> bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/tunnel-bakken.sh)"

HULP
  exit 1
fi

echo "== Bakken gevonden in container $CTID"

if binnen "command -v cloudflared" >/dev/null 2>&1; then
  echo "== cloudflared is al geinstalleerd"
else
  echo "== cloudflared installeren in de container"
  if ! binnen "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod 755 /usr/local/bin/cloudflared"; then
    echo "Kon cloudflared niet ophalen. Heeft de container internet?" >&2
    exit 1
  fi
fi

echo "== Tunnel als dienst aanzetten"
# Het token gaat niet door de uitvoer heen: alleen cloudflared zelf ziet het, en dat bewaren we
# in de container onder /etc/cloudflared/.
if ! binnen "cloudflared service install '$TOKEN' >/dev/null 2>&1"; then
  echo "Kon de tunnel niet als dienst aanzetten. Kijk in de container met:" >&2
  echo "  systemctl status cloudflared --no-pager -l" >&2
  exit 1
fi

echo "== Wachten tot de tunnel verbinding maakt"
sleep 6

ACTIEF="$(binnen "systemctl is-active cloudflared 2>&1" || true)"
echo "   cloudflared: ${ACTIEF:-onbekend}"
binnen "journalctl -u cloudflared -n 40 --no-pager 2>&1 | grep -i 'registered tunnel connection' | tail -2" || true

echo
echo "=============================================================="
if [ "$ACTIEF" = "active" ]; then
  echo " De tunnel draait in container $CTID en praat met 127.0.0.1:$POORT."
else
  echo " Let op: de dienst is niet actief (status: ${ACTIEF:-onbekend})."
  echo " Kijk in de container met:  systemctl status cloudflared --no-pager -l"
fi
echo
echo " Zet nu in de app bij Beheer, Adres van de app, het vaste adres dat je"
echo " in het dashboard hebt gekozen (bijvoorbeeld https://bakken.<jouw-domein>)."
echo " Nieuwe stickers gebruiken dat adres dan automatisch. Bestaande stickers"
echo " blijven werken: de app leest de code uit elke link."
echo "=============================================================="
