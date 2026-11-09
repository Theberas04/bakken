#!/usr/bin/env bash
# Werkt een bestaande Bakken-container bij naar de laatste versie op main.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/update-from-github.sh)"
#
# Wat het doet: haalt de bestanden op naar een tijdelijke map op de host, maakt een
# reservekopie in de container, schuift de nieuwe bestanden erin, herstart de dienst en
# controleert of de nieuwe versie echt draait. Mislukt de controle, dan gaat de reservekopie
# terug en blijft de oude werkende versie staan. De database en de foto's worden nooit
# overschreven.
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-Theberas04}"
REPO_NAAM="${REPO_NAAM:-bakken}"
BRANCH="${BRANCH:-main}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAAM/$BRANCH}"

# Versheid: de ruwe URL van GitHub houdt een bestand vijf minuten vast (cache-control
# max-age=300) en een ?cb= erachter verandert daar niets aan — de schijfcache van GitHub kijkt
# alleen naar het pad. Daarom halen we eerst de commit op waar de branch naar wijst en halen we
# alle bestanden van die vastgezette commit: die is onveranderlijk. Lukt dat niet (geen internet
# naar de API), dan gaan we door met de branch.
if [ "${RAW_BASE#file://}" = "$RAW_BASE" ] && [ -z "${COMMIT_VAST:-}" ]; then
  # Eerst de Atom-feed: die is geen API, heeft geen limiet per IP en noemt de nieuwste commit
  # bovenaan. De API geeft bij veel gebruik tijdelijk 403.
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

APP_DIR="${APP_DIR:-/opt/bakken}"
DATA_DIR="${DATA_DIR:-/var/lib/bakken}"
GEBRUIKER="${GEBRUIKER:-bakken}"
POORT="${POORT:-80}"
STAGING="${STAGING:-/opt/bakken-update}"

if [ "$(id -u)" != "0" ]; then
  echo "Draai dit als root op de Proxmox-host." >&2
  exit 1
fi

# Geen nummer meegegeven? Dan zoeken we de container waar Bakken in staat. Zo hoef je nooit een
# container-nummer te weten.
if [ -z "${CTID:-}" ]; then
  echo "== Ik zoek de container met Bakken"
  for kandidaat in $(pct list | awk 'NR > 1 {print $1}'); do
    if pct exec "$kandidaat" -- test -d "$APP_DIR" 2>/dev/null; then CTID="$kandidaat"; break; fi
  done
fi
if [ -z "${CTID:-}" ]; then
  echo "Geen container gevonden met $APP_DIR erin." >&2
  echo "Kijk met 'pct list' welke containers er zijn, en draai dit script daarna zo:" >&2
  echo "   bash -c \"\$(curl -fsSL .../update-from-github.sh)\" <nummer>" >&2
  exit 1
fi
if ! printf '%s' "$CTID" | grep -qE '^[0-9]+$' || ! pct status "$CTID" >/dev/null 2>&1; then
  echo "Container '$CTID' bestaat niet op deze host." >&2
  exit 1
fi

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
  "deploy/proxmox/bijwerken-in-de-app.sh"
)

binnen_bash() { pct exec "$CTID" -- bash -c "$1"; }

echo "== Nieuwe bestanden ophalen"
rm -rf "$STAGING"
mkdir -p "$STAGING"
for f in "${FILES[@]}"; do
  case "$f" in
    *" "*) echo "Interne fout: bestandsnaam met een spatie ($f)." >&2; exit 1 ;;
  esac
  mkdir -p "$STAGING/$(dirname "$f")"
  if [ "${RAW_BASE#file://}" != "$RAW_BASE" ]; then
    cp "${RAW_BASE#file://}/$f" "$STAGING/$f"
  elif ! curl -fsSL --max-time 60 "$RAW_BASE/$f?cb=$(date +%s)" -o "$STAGING/$f"; then
    echo "Download mislukt: $f" >&2
    exit 1
  fi
done
echo "   ${#FILES[@]} bestanden opgehaald"

echo "== Reservekopie maken in de container"
binnen_bash "rm -rf $APP_DIR.bak && cp -a $APP_DIR $APP_DIR.bak"
if ! pct exec "$CTID" -- test -d "$APP_DIR.bak"; then
  echo "Kon geen reservekopie maken; ik stop voordat er iets verandert." >&2
  exit 1
fi

echo "== Nieuwe bestanden plaatsen"
for f in "${FILES[@]}"; do
  pct exec "$CTID" -- mkdir -p "$APP_DIR/$(dirname "$f")" 2>/dev/null || true
  pct push "$CTID" "$STAGING/$f" "$APP_DIR/$f" --perms 644
done
binnen_bash "chmod 755 $APP_DIR/deploy/proxmox/bijwerken-in-de-app.sh && chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR"

# Bijwerken vanuit de app aanzetten als het nog niet in de dienst staat (voor installaties die
# van vóór deze versie zijn). De app start dit script als je in de app op Bijwerken drukt.
if ! pct exec "$CTID" -- grep -q "UPDATE_SCRIPT" /etc/systemd/system/bakken.service 2>/dev/null; then
  pct exec "$CTID" -- sed -i "/^Environment=DATA_DIR=/i Environment=UPDATE_SCRIPT=$APP_DIR/deploy/proxmox/bijwerken-in-de-app.sh" /etc/systemd/system/bakken.service
  pct exec "$CTID" -- systemctl daemon-reload
  echo "   bijwerken vanuit de app is aangezet in de dienst"
fi

echo "== Dienst herstarten"
binnen_bash "systemctl restart bakken"

echo "== Controleren of de nieuwe versie echt draait"
OK=0
for poging in $(seq 1 60); do
  if binnen_bash "curl -fsS http://127.0.0.1:$POORT/healthz" 2>/dev/null | grep -q '^ok bakken'; then OK=1; break; fi
  sleep 2
done

if [ "$OK" = "1" ]; then
  if ! binnen_bash "ss -ltnpH 'sport = :$POORT' | grep -q node"; then
    echo "Poort $POORT antwoordt wel, maar niet door node. Wat luistert er:" >&2
    binnen_bash "ss -ltnpH 'sport = :$POORT'" >&2 || true
    exit 1
  fi
  # De pagina wordt per verzoek van schijf gelezen; vergelijk daarom een bestand dat alleen de
  # nieuwe versie schrijft, zodat een oud proces niet als "bijgewerkt" geldt.
  if binnen_bash "curl -fsS -H 'Cache-Control: no-cache' http://127.0.0.1:$POORT/sw.js -o /tmp/sw-gediend.js && cmp -s /tmp/sw-gediend.js $APP_DIR/public/sw.js"; then
    echo "   de nieuwste bestanden worden ook echt geserveerd"
  else
    echo "De bestanden staan in de container, maar de dienst serveert nog de oude versie." >&2
    binnen_bash "journalctl -u bakken -n 20 --no-pager" >&2 || true
    exit 1
  fi
else
  echo "De nieuwe versie start niet; ik zet de reservekopie terug." >&2
  binnen_bash "journalctl -u bakken -n 30 --no-pager" >&2 || true
  binnen_bash "systemctl stop bakken || true"
  binnen_bash "rm -rf $APP_DIR.stuk && mv $APP_DIR $APP_DIR.stuk && mv $APP_DIR.bak $APP_DIR && chown -R $GEBRUIKER:$GEBRUIKER $APP_DIR"
  binnen_bash "systemctl start bakken"
  echo "De oude versie draait weer. Bestanden die niet werkten staan in $APP_DIR.stuk." >&2
  exit 1
fi

binnen_bash "rm -rf $APP_DIR.bak $APP_DIR.stuk"

# De app laat zien welke versie er draait. Een installatie uit een archief heeft geen .git, dus
# leggen we de commit vast die we hierboven hebben geprikt.
if [ -n "${COMMIT_VAST:-}" ]; then
  binnen_bash "printf '%s\n' '$COMMIT_VAST' > '$DATA_DIR/commit.txt' 2>/dev/null || true"
  echo "   versie vastgelegd voor de app (${COMMIT_VAST:0:7})"
fi

echo "Bakken in container $CTID is bijgewerkt."
