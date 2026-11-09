#!/usr/bin/env bash
# Bakken op een Proxmox-host installeren.
#
# Draai dit op de Proxmox-host zelf (niet in een container), als root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/install.sh)"
#
# Wat het doet:
#   1. haalt alle app-bestanden op naar /opt/bakken-pakket,
#   2. maakt een Debian-container aan (create-bakken-lxc.sh),
#   3. richt de container in en start de dienst (provision-bakken.sh).
#
# Staat Bakken al in een container, dan wordt die opnieuw ingericht in plaats van dat er een
# tweede bij komt. Een nummer meegeven mag ook: CTID=<nummer> bash -c "$(curl -fsSL …)".
#
# Alleen de bestanden ophalen, zonder container:
#   FETCH_ONLY=1 bash deploy/proxmox/install.sh
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-Theberas04}"
REPO_NAAM="${REPO_NAAM:-bakken}"
BRANCH="${BRANCH:-main}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAAM/$BRANCH}"
TARGET_DIR="${TARGET_DIR:-/opt/bakken-pakket}"
FETCH_ONLY="${FETCH_ONLY:-0}"
CTID="${CTID:-}"

# Versheid: de ruwe URL van GitHub houdt een bestand vijf minuten vast. Daarom halen
# we eerst de nieuwste commit op en halen alle bestanden van die vaste commit.
if [ "${RAW_BASE#file://}" = "$RAW_BASE" ] && [ -z "${COMMIT_VAST:-}" ]; then
  COMMIT_VAST="$(curl -fsSL --max-time 20 \
    "https://github.com/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH.atom" 2>/dev/null \
    | sed -n 's/.*Grit::Commit\/\([0-9a-f]\{40\}\).*/\1/p' | head -1)"
  if [ -z "$COMMIT_VAST" ]; then
    COMMIT_VAST="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH" 2>/dev/null \
      | sed -n 's/.*"sha" *: *"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)"
  fi
  if [ -n "$COMMIT_VAST" ]; then
    RAW_BASE="https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAAM/$COMMIT_VAST"
    echo "== Commit ${COMMIT_VAST:0:7} van $BRANCH (alle bestanden komen uit die versie)"
  else
    echo "LET OP: kon de commit van $BRANCH niet ophalen; de bestanden kunnen tot vijf" >&2
    echo "minuten oud zijn." >&2
  fi
fi

PAKKET_VERSIE="2026-11-09.2"

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
  "deploy/proxmox/create-bakken-lxc.sh"
  "deploy/proxmox/provision-bakken.sh"
  "deploy/proxmox/bijwerken.sh"
)

if [ "$(id -u)" != "0" ] && [ "$FETCH_ONLY" != "1" ]; then
  echo "Draai dit als root op de Proxmox-host." >&2
  exit 1
fi

haal_bestand() {
  local f="$1"
  case "$f" in
    *" "*|"") echo "Interne fout: bestandsnaam met een spatie ($f)." >&2; exit 1 ;;
  esac
  mkdir -p "$TARGET_DIR/$(dirname "$f")"
  if [ "${RAW_BASE#file://}" != "$RAW_BASE" ]; then
    cp "${RAW_BASE#file://}/$f" "$TARGET_DIR/$f"
  else
    if ! curl -fsSL --max-time 60 "$RAW_BASE/$f?cb=$(date +%s)" -o "$TARGET_DIR/$f"; then
      echo "Download mislukt: $f" >&2
      echo "Controleer of de repository openbaar is en of $f echt bestaat." >&2
      exit 1
    fi
  fi
}

echo "== Bakken-installer $PAKKET_VERSIE"
echo "== Bestanden ophalen van $RAW_BASE naar $TARGET_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
for f in "${FILES[@]}"; do
  haal_bestand "$f"
  echo "   $f"
done

if [ "$FETCH_ONLY" = "1" ]; then
  echo "== Alleen ophalen gevraagd (FETCH_ONLY=1): klaar in $TARGET_DIR"
  exit 0
fi

for nodig in pct pvesm; do
  if ! command -v "$nodig" >/dev/null 2>&1; then
    echo "Dit lijkt geen Proxmox-host: $nodig ontbreekt." >&2
    echo "Draai dit op de host zelf, of gebruik FETCH_ONLY=1 om alleen de bestanden op te halen." >&2
    exit 1
  fi
done

# Waar moet het in? Een nummer dat je meegaf telt; anders kijken we of Bakken al ergens
# staat, zodat een tweede keer installeren dezelfde container bijwerkt in plaats van een
# tweede container naast de eerste te zetten.
BESTAAND=""
if [ -n "$CTID" ]; then
  if ! printf '%s' "$CTID" | grep -qE '^[0-9]+$'; then
    echo "Ongeldig container-nummer: '$CTID'." >&2
    exit 1
  fi
  if pct status "$CTID" >/dev/null 2>&1; then BESTAAND="$CTID"; fi
else
  for kandidaat in $(pct list | awk 'NR > 1 {print $1}'); do
    if pct exec "$kandidaat" -- test -d "${APP_DIR:-/opt/bakken}" 2>/dev/null; then
      BESTAAND="$kandidaat"
      break
    fi
  done
fi

if [ -n "$BESTAAND" ]; then
  CTID="$BESTAAND"
  echo "== Bakken staat al in container $CTID; ik richt die opnieuw in"
else
  echo "== Nieuwe container aanmaken"
  if [ ! -s "$TARGET_DIR/deploy/proxmox/create-bakken-lxc.sh" ]; then
    echo "Het aanmaakscript ontbreekt in het pakket; haal het alsnog op." >&2
    haal_bestand deploy/proxmox/create-bakken-lxc.sh
  fi
  CTID="$(CTID="$CTID" bash "$TARGET_DIR/deploy/proxmox/create-bakken-lxc.sh")"
  if ! printf '%s' "$CTID" | grep -qE '^[0-9]+$'; then
    echo "Kon geen container-id bepalen (kreeg: '$CTID')." >&2
    exit 1
  fi
  echo "   container $CTID"
fi

echo "== Container inrichten"
COMMIT_VAST="${COMMIT_VAST:-}" bash "$TARGET_DIR/deploy/proxmox/provision-bakken.sh" "$CTID"

IP="$(pct exec "$CTID" -- bash -c "ip -4 -o addr show dev eth0 | awk '{print \$4}' | cut -d/ -f1" 2>/dev/null || true)"
echo
echo "=============================================================="
echo " Bakken draait in container $CTID (aangemaakt of bijgewerkt)"
[ -n "$IP" ] && echo " Open in de container:  http://$IP:8080/"
echo " Zet daar een Cloudflare Tunnel met vaste hostnaam voor, anders"
echo " werkt de camera (QR scannen) niet: die eist https."
echo " Bijwerken later:"
echo "   bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAAM/$BRANCH/deploy/proxmox/bijwerken.sh)\""
echo "=============================================================="
