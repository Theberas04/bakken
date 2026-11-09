#!/usr/bin/env bash
# Werkt Bakken bij van binnenuit de container.
#
# De app start dit script als je in de app op "Bijwerken" drukt (de knop staat in de kaart
# "Versie"). Het haalt het nieuwste archief van GitHub, legt alleen de bestanden van de app op
# hun plek en laat de dienst opnieuw starten. Er is geen root en geen pct nodig: de app-map is
# van de gebruiker die de dienst draait, en systemd start de dienst opnieuw op zodra de app stopt
# (Restart=always).
#
# Wat het NOOIT doet: de database, de foto's en de instellingen in de gegevensmap blijven staan.
# Alleen code en pagina's worden vervangen, en van de oude bestanden wordt eerst een
# reservekopie in $DATA_DIR gezet.
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-Theberas04}"
REPO_NAAM="${REPO_NAAM:-bakken}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bakken}"
DATA_DIR="${DATA_DIR:-/var/lib/bakken}"
ARCHIEF="https://codeload.github.com/$REPO_OWNER/$REPO_NAAM/tar.gz/$BRANCH"

WERK="$(mktemp -d)"
trap 'rm -rf "$WERK"' EXIT

echo "Ophalen: $ARCHIEF"
curl -fsSL --max-time 180 "$ARCHIEF" -o "$WERK/bron.tgz"
tar -xzf "$WERK/bron.tgz" -C "$WERK"
BRON="$(find "$WERK" -maxdepth 1 -mindepth 1 -type d -name "$REPO_NAAM-*" | head -1)"
if [ -z "$BRON" ]; then
  echo "De map uit het archief is niet gevonden."
  exit 1
fi

# Alleen wat de app nodig heeft. De gegevens (database, foto's, instellingen) staan in $DATA_DIR
# en blijven dus ongemoeid.
PATRONEN=(server.js lib public VERSIE.json CHANGELOG.md)
for p in "${PATRONEN[@]}"; do
  if [ ! -e "$BRON/$p" ]; then
    echo "In het archief mist $p; er wordt niets veranderd."
    exit 1
  fi
done

# Eerst kijken of de nieuwe bestanden te lezen zijn. Gaat er iets mis, dan stopt het hier en
# blijft de oude versie staan.
echo "Nieuwe bestanden controleren…"
node --check "$BRON/server.js"
for f in "$BRON"/lib/*.js; do node --check "$f"; done
if [ -f "$BRON/deploy/proxmox/bijwerken-in-de-app.sh" ]; then
  bash -n "$BRON/deploy/proxmox/bijwerken-in-de-app.sh"
fi

# Reservekopie van wat er nu staat.
RESERVE="$DATA_DIR/bijwerken-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESERVE"
for p in "${PATRONEN[@]}"; do
  if [ -e "$APP_DIR/$p" ]; then cp -a "$APP_DIR/$p" "$RESERVE/"; fi
done
echo "Reservekopie van de oude bestanden: $RESERVE"

# En nu de nieuwe bestanden op hun plek.
for p in "${PATRONEN[@]}"; do
  rm -rf "$APP_DIR/$p"
  cp -a "$BRON/$p" "$APP_DIR/$p"
done

chmod 644 "$APP_DIR/server.js" "$APP_DIR/VERSIE.json" "$APP_DIR/CHANGELOG.md" 2>/dev/null || true
chmod -R u+rwX,go+rX "$APP_DIR/lib" "$APP_DIR/public" 2>/dev/null || true

# Is er een nieuw bijwerkscript meegekomen, dan leggen we dat ook op zijn plek, zodat de volgende
# keer de nieuwste versie van het script draait.
if [ -f "$BRON/deploy/proxmox/bijwerken-in-de-app.sh" ]; then
  install -d "$APP_DIR/deploy/proxmox"
  cp -a "$BRON/deploy/proxmox/bijwerken-in-de-app.sh" "$APP_DIR/deploy/proxmox/bijwerken-in-de-app.sh"
  chmod 755 "$APP_DIR/deploy/proxmox/bijwerken-in-de-app.sh"
fi

# Welke commit is dit? De app laat het zien in de beheerkaart en bij het bijwerken. Dit archief
# heeft geen .git, dus vragen we het aan GitHub; lukt dat niet, dan blijft de vorige waarde staan.
COMMIT_NU="$(curl -fsSL --max-time 20 \
  "https://github.com/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH.atom" 2>/dev/null \
  | sed -n 's/.*Grit::Commit\/\([0-9a-f]\{40\}\).*/\1/p' | head -1)"
if [ -z "$COMMIT_NU" ]; then
  COMMIT_NU="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAAM/commits/$BRANCH" 2>/dev/null \
    | sed -n 's/.*"sha" *: *"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)"
fi
if [ -n "$COMMIT_NU" ]; then
  printf '%s\n' "$COMMIT_NU" > "$DATA_DIR/commit.txt" 2>/dev/null || true
fi

VERSIE="$(grep -o "const VERSIE = '[^']*'" "$APP_DIR/server.js" | head -1 | cut -d"'" -f2)"
echo "De nieuwe bestanden staan op hun plek (versie ${VERSIE:-onbekend})."
echo "De app stopt nu en systemd start hem opnieuw op met de nieuwe versie."
exit 0
