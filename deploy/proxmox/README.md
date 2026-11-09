# Bakken op je Proxmox-server

De app draait in een **bestaande** Debian-container (geen nieuwe container nodig), op
poort **8080**, met een systemd-dienst. De gegevens staan in `/var/lib/bakken`, de code in
`/opt/bakken`. Bijwerken laat de gegevens met rust.

Vervang hieronder `104` door het nummer van jouw container.

## Installeren (eenmalig)

Op de Proxmox-host zelf, als root:

```bash
CTID=104 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/install.sh)"
```

De installer haalt de nieuwste bestanden van GitHub, installeert Node.js 22 in de container,
maakt de gebruiker `bakken`, zet de dienst op en controleert met `/healthz` of de app echt
antwoordt. Zegt hij dat de app niet antwoordt, dan print hij de dienst-status en de laatste
logregels.

Alleen de bestanden ophalen, zonder installeren (handig om te proberen):

```bash
FETCH_ONLY=1 bash deploy/proxmox/install.sh
```

## Bijwerken

```bash
CTID=104 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/bijwerken.sh)"
```

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
2. Zet de publieke hostnaam op de dienst `http://<ip-van-container-104>:8080`.
3. Installeer de tunnel als dienst in de container, met het token uit het dashboard:

```bash
pct exec 104 -- bash -c "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod 755 /usr/local/bin/cloudflared"
pct exec 104 -- cloudflared service install <TOKEN>
```

4. Zet in de app bij **Beheer → Adres van de app** dat vaste adres. Nieuwe stickers gebruiken
   het dan automatisch. Bestaande stickers blijven werken: de app leest de code uit elke link.

Camera en installatie als app eisen https. Achter de tunnel krijg je dat gratis; op een kaal
`http://192.168.…`-adres werkt scannen in de browser niet.

## Controleren of alles loopt

```bash
pct exec 104 -- systemctl status bakken --no-pager -l | tail -20
pct exec 104 -- curl -fsS http://127.0.0.1:8080/healthz
pct exec 104 -- journalctl -u bakken -n 40 --no-pager
```

## Gegevens veiligstellen

Alles wat de app bewaart staat in `/var/lib/bakken`: de databank en de foto's. Een kopie maken
vanaf de host:

```bash
pct exec 104 -- tar czf - /var/lib/bakken > bakken-backup-$(date +%F).tar.gz
```

Terugzetten: stop de dienst, pak de tar uit in de container, start de dienst weer.

## Poort veranderen

Standaard 8080. Een andere poort geef je mee bij de installatie:

```bash
CTID=104 POORT=8090 bash -c "$(curl -fsSL .../install.sh)"
```

Let op: bij het bijwerken moet dezelfde `POORT` bekend zijn, anders controleert het script de
verkeerde poort. Zet hem dan in de omgeving van de host of geef hem mee.
