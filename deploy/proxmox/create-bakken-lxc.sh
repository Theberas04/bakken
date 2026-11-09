#!/usr/bin/env bash
# Maakt een Debian-container voor Bakken op de Proxmox-host.
# Print alleen het container-id op stdout; alle uitleg gaat naar stderr,
# zodat install.sh het id met $(...) kan opvangen.
set -euo pipefail

CTID="${CTID:-}"
HOSTNAME_CT="${HOSTNAME_CT:-bakken}"
GEHEUGEN="${GEHEUGEN:-1024}"
SCHIJF="${SCHIJF:-8}"
CORES="${CORES:-2}"
BRIDGE="${BRIDGE:-vmbr0}"
OPSLAG="${OPSLAG:-local-lvm}"
SJABLOON_OPSLAG="${SJABLOON_OPSLAG:-}"
DEBIAN_MAJOR="${DEBIAN_MAJOR:-12}"

melding() { echo "$@" >&2; }

# Kiest uit een lijst sjabloonnamen de Debian-variant die we willen: de ingestelde
# hoofdversie, en anders de nieuwste die de host aanbiedt. Zo werkt het ook op een host
# waar Debian 13 inmiddels de standaard is.
kies_sjabloon() {
  # De invoer één keer lezen: twee keer van dezelfde pijp lezen levert de tweede keer niets op.
  local alles eerste
  alles="$(cat)"
  eerste="$(printf '%s\n' "$alles" | grep "debian-$DEBIAN_MAJOR-standard" | sort -V | tail -1 || true)"
  if [ -n "$eerste" ]; then printf '%s\n' "$eerste"; return 0; fi
  printf '%s\n' "$alles" | grep -E "debian-[0-9]+-standard" | sort -V | tail -1 || true
}

if [ "$(id -u)" != "0" ]; then
  melding "Draai dit als root op de Proxmox-host."
  exit 1
fi

# Is dit nummer al in gebruik? Let op: 'pct' kent alleen containers. Een gewone VM met dat
# nummer meldt zich daar niet, en dan kiest dit script een nummer dat al bezet is — 'pct create'
# stopt dan met "VM <nummer> already exists". Daarom kijken we ook met 'qm' en naar de
# configuratiebestanden van beide soorten.
nummer_bezet() {
  local id="$1"
  pct status "$id" >/dev/null 2>&1 && return 0
  if command -v qm >/dev/null 2>&1; then
    qm status "$id" >/dev/null 2>&1 && return 0
  fi
  local knoop
  knoop="$(hostname)"
  [ -f "/etc/pve/nodes/$knoop/lxc/$id.conf" ] && return 0
  [ -f "/etc/pve/nodes/$knoop/qemu-server/$id.conf" ] && return 0
  # Op een host met meerdere knopen kan het nummer op een andere knoop staan.
  compgen -G "/etc/pve/nodes/*/lxc/$id.conf" >/dev/null 2>&1 && return 0
  compgen -G "/etc/pve/nodes/*/qemu-server/$id.conf" >/dev/null 2>&1 && return 0
  return 1
}

# Vrije container-id zoeken als er geen is opgegeven.
if [ -z "$CTID" ]; then
  for kandidaat in $(seq "${CTID_VANAF:-100}" 299); do
    if ! nummer_bezet "$kandidaat"; then CTID="$kandidaat"; break; fi
  done
fi
if [ -z "$CTID" ]; then
  melding "Geen vrij nummer gevonden tussen ${CTID_VANAF:-100} en 299. Geef er zelf een: CTID=<nummer>."
  exit 1
fi
if nummer_bezet "$CTID"; then
  melding "Nummer $CTID is al in gebruik (container of VM). Kies een ander nummer of verwijder het eerst."
  exit 1
fi

# Opslag die een containerschijf aankan. 'local-lvm' is de gewoonte, maar een host met ZFS
# heeft 'local-zfs' en dan stopt 'pct create' met een onduidelijke fout. Daarom zoeken we er
# zelf een als de ingestelde opslag het niet kan.
if ! pvesm status --content rootdir 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$OPSLAG"; then
  GEVONDEN="$(pvesm status --content rootdir 2>/dev/null | awk 'NR>1 {print $1}' | head -1)"
  if [ -n "$GEVONDEN" ]; then
    melding "Opslag '$OPSLAG' kan geen containerschijf aan; ik gebruik '$GEVONDEN'."
    OPSLAG="$GEVONDEN"
  else
    melding "Geen opslag gevonden voor een containerschijf. Kijk met 'pvesm status' welke opslag je hebt en geef die mee: OPSLAG=<naam>."
    exit 1
  fi
fi

# De bridge moet bestaan, anders krijgt de container geen netwerk.
if ! ip -o link show "$BRIDGE" >/dev/null 2>&1; then
  melding "Bridge '$BRIDGE' bestaat niet op deze host."
  melding "Beschikbare bridges: $(ip -o link show | awk -F': ' '{print $2}' | grep '^vmbr' | tr '\n' ' ')"
  melding "Geef de juiste mee: BRIDGE=vmbr1 ..."
  exit 1
fi

# Sjablonen staan op een opslag met 'vztmpl', en dat is op een standaardinstallatie 'local'
# terwijl de containerschijf op 'local-lvm' hoort. Eén opslagnaam voor allebei werkt dus niet:
# 'local-lvm' kan geen sjablonen aan.
SJABLOON_OPSLAGGEN="${SJABLOON_OPSLAG:-$(pvesm status --content vztmpl 2>/dev/null | awk 'NR>1 {print $1}')}"
if [ -z "$SJABLOON_OPSLAGGEN" ]; then
  melding "Geen opslag gevonden die sjablonen kan bewaren."
  melding "Kijk met 'pvesm status' welke opslag je hebt en zet die aan voor sjablonen met"
  melding "'pvesm set <naam> --content vztmpl', of geef hem mee: SJABLOON_OPSLAG=<naam> ..."
  exit 1
fi

# Sjabloon zoeken op elke opslag die sjablonen aankan, en anders downloaden.
SJABLOON=""
for opslag in $SJABLOON_OPSLAGGEN; do
  GEVONDEN="$(pveam list "$opslag" 2>/dev/null | awk '{print $1}' | kies_sjabloon || true)"
  if [ -n "$GEVONDEN" ]; then SJABLOON="$GEVONDEN"; break; fi
done
if [ -z "$SJABLOON" ]; then
  DOWNLOAD_OPSLAG="$(echo "$SJABLOON_OPSLAGGEN" | awk '{print $1}')"
  melding "Debian $DEBIAN_MAJOR-sjabloon wordt gedownload naar $DOWNLOAD_OPSLAG..."
  pveam update >/dev/null 2>&1 || true
  NAAM="$(pveam available --section system | awk '{print $2}' | kies_sjabloon || true)"
  if [ -z "$NAAM" ]; then
    melding "Geen Debian $DEBIAN_MAJOR-sjabloon gevonden. Download er handmatig een met 'pveam download'."
    exit 1
  fi
  pveam download "$DOWNLOAD_OPSLAG" "$NAAM"
  SJABLOON="$DOWNLOAD_OPSLAG:vztmpl/$NAAM"
fi
melding "Containerschijf op: $OPSLAG   sjabloon op: ${SJABLOON%%:*}"
melding "Sjabloon: $SJABLOON"

# Proxmox kan alsnog klagen dat het nummer bezet is, ook als de controle hierboven niets zag:
# een VM die op een andere knoop van het cluster staat, een container die half is aangemaakt, of
# iets wat alleen Proxmox zelf weet. In dat geval schuiven we door naar het volgende vrije nummer
# in plaats van de hele installatie te laten mislukken.
aanmaken() {
  pct create "$1" "$SJABLOON" \
    --hostname "$HOSTNAME_CT" \
    --cores "$CORES" \
    --memory "$GEHEUGEN" \
    --swap 512 \
    --rootfs "$OPSLAG:$SCHIJF" \
    --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
    --features nesting=1 \
    --unprivileged 1 \
    --onboot 1 \
    --start 1
}

GELUKT=0
for poging in $(seq 1 25); do
  if UITVOER="$(aanmaken "$CTID" 2>&1)"; then
    printf '%s\n' "$UITVOER" >&2
    GELUKT=1
    break
  fi
  printf '%s\n' "$UITVOER" >&2
  if printf '%s' "$UITVOER" | grep -qi "already exists"; then
    VOLGEND=""
    for kandidaat in $(seq $((CTID + 1)) 299); do
      if ! nummer_bezet "$kandidaat"; then VOLGEND="$kandidaat"; break; fi
    done
    if [ -z "$VOLGEND" ]; then
      melding "Nummer $CTID is bezet en ik vind geen vrij nummer meer. Geef er zelf een mee: CTID=<nummer>."
      exit 1
    fi
    melding "Nummer $CTID blijkt toch bezet; ik probeer nummer $VOLGEND."
    CTID="$VOLGEND"
    continue
  fi
  melding "Het aanmaken van de container is gestopt; zie de regels hierboven."
  exit 1
done
if [ "$GELUKT" != "1" ]; then
  melding "Kon na 25 pogingen geen vrij nummer vinden. Geef er zelf een mee: CTID=<nummer>."
  exit 1
fi

melding "Container $CTID gestart; wachten tot hij op het netwerk is..."
for poging in $(seq 1 40); do
  if pct exec "$CTID" -- bash -c "ip -4 -o addr show dev eth0 | grep -q 'inet '" 2>/dev/null; then break; fi
  sleep 1
done
if ! pct exec "$CTID" -- bash -c "ip -4 -o addr show dev eth0 | grep -q 'inet '" 2>/dev/null; then
  melding "Container $CTID kreeg geen IP-adres. Controleer de bridge ($BRIDGE) en DHCP."
  exit 1
fi

# Alleen het id op stdout, daar rekent install.sh mee.
echo "$CTID"
