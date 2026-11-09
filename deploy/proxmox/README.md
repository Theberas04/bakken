# Bakken op je Proxmox-server

Het installatiescript **maakt zelf een Debian-container** aan (zoals bij de andere apps), op
poort **80**, met een systemd-dienst. De gegevens staan in `/var/lib/bakken`, de code in
`/opt/bakken`. Bijwerken laat de gegevens met rust.

## Installeren (eenmalig)

Op de Proxmox-host zelf, als root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/install.sh)"
```

Je hoeft geen container-nummer te weten: het script kiest een vrij nummer, maakt de container
aan, zet Node.js 22 en de dienst erin, en controleert met `/healthz` of de app echt antwoordt.
Net als bij de andere apps maakt elke installatie een eigen container.

Instellingen voor het aanmaken (allemaal optioneel):

| Variabele | Standaard | Betekenis |
|---|---|---|
| `HOSTNAME_CT` | `bakken` | hostnaam in de container |
| `GEHEUGEN` | `1024` | geheugen in MB |
| `SCHIJF` | `8` | schijf in GB |
| `CORES` | `2` | processors |
| `BRIDGE` | `vmbr0` | netwerkbrug |
| `OPSLAG` | `local-lvm` | opslag voor de containerschijf |
| `POORT` | `80` | poort van de app in de container |

Alleen de bestanden ophalen, zonder installeren (handig om te proberen):

```bash
FETCH_ONLY=1 bash deploy/proxmox/install.sh
```

## Bijwerken

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/update-from-github.sh)"
```

Ook hier is het nummer optioneel: het script zoekt de container waar Bakken in staat. Het maakt
eerst een reservekopie, controleert daarna of de nieuwste bestanden echt geserveerd worden, en
zet bij een mislukking de reservekopie terug.

Of vanuit de app: **Beheer → Controleer op een nieuwe versie → Bijwerken**. Dat werkt hetzelfde
als bij de andere apps: de app haalt de nieuwe bestanden, stopt daarna en systemd start hem
opnieuw op met de nieuwe code. De pagina wacht en ververscht zichzelf. Er gaat niets verloren;
de gegevens staan in `/var/lib/bakken` en worden nooit overschreven.

Tijdens een herstart is de app even weg. Achter Cloudflare zie je dan **1033** of **502** —
dat hoort erbij. Wacht tien tellen en herlaad.

## Cloudflare Tunnel met een vaste hostnaam

Gebruik een **named tunnel**, geen quick tunnel. Een quick tunnel krijgt elke keer een nieuwe
URL, en dan werken de QR-stickers die je al geplakt hebt niet meer.

1. Maak in het Cloudflare-dashboard een tunnel aan (Zero Trust → Networks → Tunnels → Create a
   tunnel), kies **Cloudflared**, en geef de tunnel een naam.
2. Op het scherm *Install and run a connector* staat het token. Kopieer dat lange stuk.
3. Voeg een **Public hostname** toe met als dienst `HTTP` → `127.0.0.1` (de tunnel loopt in
   dezelfde container als de app).
4. Laat **Cloudflare Access uit**. De app heeft zijn eigen inlog; Access zou een tweede
   inlogscherm geven.
5. Draai dit op de host — het zoekt de container zelf en zet de tunnel als dienst aan:

```bash
TOKEN=<token-uit-het-dashboard> bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/tunnel-bakken.sh)"
```

Zonder token vertelt dat script je precies waar je het token vindt; je kunt het dus ook eerst
zonder token draaien.

6. Zet in de app bij **Beheer → Adres van de app** dat vaste adres (bijvoorbeeld
   `https://bakken.<jouw-domein>`). Nieuwe stickers gebruiken het dan automatisch. Bestaande
   stickers blijven werken: de app leest de code uit elke link.

Camera en installatie als app eisen https. Achter de tunnel krijg je dat gratis; op een kaal
`http://192.168.…`-adres werkt scannen in de browser niet.

## Controleren of alles loopt

Vanaf de host, zonder iets te veranderen:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/check-bakken.sh)"
```

Of rechtstreeks in de container:

```bash
pct exec <nummer> -- systemctl status bakken --no-pager -l | tail -20
pct exec <nummer> -- curl -fsS http://127.0.0.1/healthz
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

Standaard 80 (zo werkt http://<ip>/ meteen). Een andere poort geef je mee bij de installatie:

```bash
POORT=8090 bash -c "$(curl -fsSL .../install.sh)"
```

Let op: bij het bijwerken moet dezelfde `POORT` bekend zijn, anders controleert het script de
verkeerde poort. Zet hem dan in de omgeving van de host of geef hem mee.
