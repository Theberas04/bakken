# Bakken op je Proxmox-server

Het installatiescript **maakt zelf een Debian-container** aan (zoals bij de andere apps), op
poort **8080**, met een systemd-dienst. De gegevens staan in `/var/lib/bakken`, de code in
`/opt/bakken`. Bijwerken laat de gegevens met rust.

## Installeren (eenmalig)

Op de Proxmox-host zelf, als root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/install.sh)"
```

Je hoeft geen container-nummer te weten: het script zoekt een vrij nummer, maakt de container
aan, zet Node.js 22 en de dienst erin, en controleert met `/healthz` of de app echt antwoordt.
Staat Bakken al in een container, dan wordt die opnieuw ingericht in plaats van dat er een
tweede naast komt.

Instellingen voor het aanmaken (allemaal optioneel):

| Variabele | Standaard | Betekenis |
|---|---|---|
| `CTID` | eerste vrije vanaf 100 | nummer van de nieuwe container |
| `HOSTNAME_CT` | `bakken` | hostnaam in de container |
| `GEHEUGEN` | `1024` | geheugen in MB |
| `SCHIJF` | `8` | schijf in GB |
| `CORES` | `2` | processors |
| `BRIDGE` | `vmbr0` | netwerkbrug |
| `OPSLAG` | `local-lvm` | opslag voor de containerschijf |
| `POORT` | `8080` | poort van de app in de container |

Alleen de bestanden ophalen, zonder installeren (handig om te proberen):

```bash
FETCH_ONLY=1 bash deploy/proxmox/install.sh
```

## Bijwerken

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/bijwerken.sh)"
```

Ook hier is het nummer optioneel: het script zoekt de container waar Bakken in staat.

Of vanuit de app: **Beheer → Controleer op een nieuwe versie → Bijwerken**. De app start het
bijwerken niet zelf; hij toont het commando. Dat is bewust: de app mag de dienst waar hij zelf
in draait niet herstarten.

Tijdens een herstart is de app even weg. Achter Cloudflare zie je dan **1033** of **502** —
dat hoort erbij. Wacht tien tellen en herlaad.

## Cloudflare Tunnel met een vaste hostnaam

Gebruik een **named tunnel**, geen quick tunnel. Een quick tunnel krijgt elke keer een nieuwe
URL, en dan werken de QR-stickers die je al geplakt hebt niet meer.

1. Maak in het Cloudflare-dashboard een tunnel aan (Zero Trust → Networks → Tunnels) en kies
   de hostnaam waarop de app moet komen.
2. Zet de publieke hostnaam op de dienst `http://<ip-van-de-container>:8080`.
3. Installeer de tunnel als dienst in de container, met het token uit het dashboard:

```bash
pct exec <nummer> -- bash -c "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod 755 /usr/local/bin/cloudflared"
pct exec <nummer> -- cloudflared service install <TOKEN>
```

4. Zet in de app bij **Beheer → Adres van de app** dat vaste adres. Nieuwe stickers gebruiken
   het dan automatisch. Bestaande stickers blijven werken: de app leest de code uit elke link.

Het container-nummer vind je met `pct list` — het is de container met hostnaam `bakken`;
vervang hierboven `<nummer>` daarmee.

Camera en installatie als app eisen https. Achter de tunnel krijg je dat gratis; op een kaal
`http://192.168.…`-adres werkt scannen in de browser niet.

## Controleren of alles loopt

```bash
pct exec <nummer> -- systemctl status bakken --no-pager -l | tail -20
pct exec <nummer> -- curl -fsS http://127.0.0.1:8080/healthz
pct exec <nummer> -- journalctl -u bakken -n 40 --no-pager
```

## Gegevens veiligstellen

Alles wat de app bewaart staat in `/var/lib/bakken`: de databank en de foto's. Een kopie maken
vanaf de host:

```bash
pct exec <nummer> -- tar czf - /var/lib/bakken > bakken-backup-$(date +%F).tar.gz
```

Terugzetten: stop de dienst, pak de tar uit in de container, start de dienst weer.

## Poort veranderen

Standaard 8080. Een andere poort geef je mee bij de installatie:

```bash
POORT=8090 bash -c "$(curl -fsSL .../install.sh)"
```

Let op: bij het bijwerken moet dezelfde `POORT` bekend zijn, anders controleert het script de
verkeerde poort. Zet hem dan in de omgeving van de host of geef hem mee.
