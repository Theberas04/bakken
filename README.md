# Bakken

QR-stickers voor opbergbakken, met de voorraad per bak, foto's van de inhoud en accounts.

Je plakt een sticker op een bak, scant hem met de app en ziet meteen wat erin zit en
hoeveel ervan. De stickers maak je zelf in de app: je geeft elke code een eigen naam
(bijvoorbeeld "Garage - kerstspullen"), print een vel en plakt ze op.

## Wat de app doet

| Onderdeel | Wat het doet |
|---|---|
| Accounts | Inloggen met gebruikersnaam en wachtwoord; de eerste keer stel je de beheerder in. |
| Rechten | De beheerder kent rechten toe aan gebruikers (bakken bekijken, wijzigen, verwijderen, codes beheren, gebruikers beheren, bijwerken) en kan ze weer intrekken. |
| Bakken | Bakken met een naam, locatie en omschrijving; per bak zie je het aantal producten en het totaal aantal stuks. |
| Voorraad per bak | Producten met een aantal, eenheid en notitie, met + en - om te tellen. |
| Codes | Zelf gemaakte stickers met een eigen naam, status (vrij, gedrukt, geplakt) en de printdatum, zodat je ze in de gaten kunt houden. |
| Scannen | De code uit de sticker opzoeken en meteen de bak met zijn voorraad tonen. |
| Foto's | Foto's van de inhoud van een bak, met de stand of ze al op de server staan. |
| Versiecontrole | De beheerder ziet of er iets nieuws op GitHub staat en hoe hij bijwerkt (net als bij AkkoordKast). |
| PWA | Installeren vanaf het adres van de app; de gegevens staan lokaal, dus scannen blijft werken zonder internet. |

## Over dit repo

Er staat hier **geen adres**: geen domeinnaam en geen IP-adres van de eigen omgeving,
niet in de code en niet in de geschiedenis. Het adres van de app komt van het verzoek
zelf of uit de instelling `basis_adres` op de machine (buiten dit repo). QR-links worden
met dat adres opgebouwd en de scanner leest de code uit het pad, dus geprinte stickers
blijven werken, ook als je later vanaf een ander adres print.
`test/geen-adressen.test.js` bewaakt dat automatisch.

## Draaien

Geen npm-afhankelijkheden; Node 22.5 of hoger (vanwege `node:sqlite`).

    node --test test/*.test.js     # alle proeven
    PORT=8110 node server.js       # de app zelf

Gegevens horen buiten dit repo: `DATA_DIR`, `DB_PATH` en `MEDIA_DIR` wijzen ze aan
(standaard onder `data/`, dat in `.gitignore` staat).

## Stand van zaken

- [x] Datalaag: gebruikers, sessies, bakken, producten, codes, foto's
- [x] Server: inloggen, accounts, rechten, bakken en producten, codes en scannen, versiecontrole, `/healthz`
- [x] Web-app: bakken, scannen, codes met eigen naam, beheer
- [x] QR-generator en printvel (48 stickers op A4)
- [x] PWA: manifest, pictogram, service worker met de app-schil in de cache
- [ ] PWA: foto's offline opvangen
- [x] Proxmox-installatie en Cloudflare-tunnel (zie `deploy/proxmox/README.md`)

## Installeren op je Proxmox-server

Een bestaande container inrichten vanaf de host:

    bash -c "$(curl -fsSL https://raw.githubusercontent.com/Theberas04/bakken/main/deploy/proxmox/install.sh)"

Bijwerken: zie `deploy/proxmox/README.md`. Gebruik een Cloudflare **named** tunnel met een
vaste hostnaam; een quick tunnel geeft elke keer een nieuwe URL en dan werken geplakte
stickers niet meer. Camera en installeren als app eisen https.
