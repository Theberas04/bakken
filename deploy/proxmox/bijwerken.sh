#!/usr/bin/env bash
# Bakken bijwerken naar de nieuwste versie op GitHub.
#
# Op de Proxmox-host, als root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/bijwerken.sh)"
#
# Je hoeft geen container-nummer te weten: het script zoekt de container waar
# Bakken in staat. CTID=<nummer> meegeven mag ook.
#
# Het haalt de bestanden van de nieuwste commit op, stuurt ze naar de bestaande
# container en herstart de dienst. De gegevens in DATA_DIR blijven staan.
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-Theberas04}"
REPO_NAAM="${REPO_NAAM:-bakken}"
BRANCH="${BRANCH:-main}"
CTID="${CTID:-${1:-}}"
APP_DIR="${APP_DIR:-/opt/bakken}"
DATA_DIR="${DATA_DIR:-/var/lib/bakken}"
GEBRUIKER="${GEBRUIKER:-bakken}"
POORT="${POORT:-8080}"
PAKKET="${PAKKET:-/opt/bakken-pakket}"

if [ "$(id -u)" != "0" ]; then
  echo "Draai dit als root op de Proxmox-host." >&2
  exit 1
fi
if [ -z "$CTID" ]; then
  # Zoek de container waar Bakken in staat, zodat je geen nummer hoeft te weten.
  echo "== Geen nummer meegegeven; ik zoek de container met Bakken"
  GEVONDEN=""
  for kandidaat in $(pct list | awk 'NR > 1 {print $1}'); do
    if pct exec "$kandidaat" -- test -d "$APP_DIR" 2>/dev/null; then
      GEVONDEN="$GEVONDEN $kandidaat"
    fi
  done
  AANTAL="$(printf '%s\n' $GEVONDEN | grep -c '[0-9]' || true)"
  if [ "$AANTAL" = "1" ]; then
    CTID="$(printf '%s\n' $GEVONDEN | head -1)"
    echo "   gevonden: container $CTID"
  else
    pct list >&2
    if [ -e /dev/tty ]; then
      read -r -p "Welk container-nummer? " CTID < /dev/tty
    else
      echo "Geef het nummer mee: CTID=<nummer> bash -c \"\$(curl -fsSL .../bijwerken.sh)\"" >&2
      exit 1
    fi
  fi
fi
if ! printf '%s' "$CTID" | grep -qE '^[0-9]+$' || ! pct status "$CTID" >/dev/null 2>&1; then
  echo "Container '$CTID' bestaat niet op deze host." >&2
  exit 1
fi

echo "== Nieuwste commit van $BRANCH zoeken"
COMMIT_VAST="$(curl -fsSL --max-time 20 \
  "https://github.com/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH.atom" 2>/dev/null \
  | sed -n 's/.*Grit::Commit\/\([0-9a-f]\{40\}\).*/\1/p' | head -1)"
if [ -z "$COMMIT_VAST" ]; then
  COMMIT_VAST="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH" 2>/dev/null \
    | sed -n 's/.*"sha" *: *"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)"
fi
if [ -z "$COMMIT_VAST" ]; then
  echo "Kon de nieuwste commit niet ophalen. Controleer de internetverbinding." >&2
  exit 1
fi
RAW_BASE="https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAAM/$COMMIT_VAST"
echo "   commit ${COMMIT_VAST:0:7}"

FILES=(
  "server.js"
  "lib/accounts.js"
  "lib/codes.js"
  "lib/db.js"
  "lib/rechten.js"
  "lib/versie.js"
  "public/index.html"
  "public/styles.css"
  "public/app.js"
  "public/lib/qrcode.js"
  "public/lib/qr.js"
  "public/sw.js"
  "public/manifest.webmanifest"
  "public/icon.svg"
  "VERSIE.json"
  "CHANGELOG.md"
  "deploy/proxmox/bijwerken.sh"
)

echo "== Nieuwe bestanden ophalen"
rm -rf "$PAKKET"
mkdir -p "$PAKKET"
for f in "${FILES[@]}"; do
  mkdir -p "$PAKKET/$(dirname "$f")"
  if ! curl -fsSL --max-time 60 "$RAW_BASE/$f?cb=$(date +%s)" -o "$PAKKET/$f"; then
    echo "Download mislukt: $f" >&2
    exit 1
  fi
done

echo "== Bestanden naar container $CTID sturen"
for f in "${FILES[@]}"; do
  pct exec "$CTID" -- mkdir -p "$APP_DIR/$(dirname "$f")" 2>/dev/null || true
  pct push "$CTID" "$PAKKET/$f" "$APP_DIR/$f" --perms 644
done
pct exec "$CTID" -- bash -c "chmod 755 $APP_DIR/deploy/proxmox/bijwerken.sh; printf '%s\n' '$COMMIT_VAST' > $DATA_DIR/commit.txt; chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR"
rm -rf "$PAKKET"

echo "== Dienst herstarten"
pct exec "$CTID" -- systemctl restart bakken

echo "== Controle"
OK=0
for poging in $(seq 1 30); do
  if pct exec "$CTID" -- curl -fsS "http://127.0.0.1:$POORT/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" != "1" ]; then
  echo "De app antwoordt niet na het bijwerken. Bewijs:" >&2
  pct exec "$CTID" -- systemctl status bakken --no-pager -l 2>&1 | tail -20 >&2 || true
  pct exec "$CTID" -- journalctl -u bakken -n 25 --no-pager 2>&1 >&2 || true
  exit 1
fi

echo "   $(pct exec "$CTID" -- curl -fsS "http://127.0.0.1:$POORT/healthz")"
echo "Bakken is bijgewerkt in container $CTID."
