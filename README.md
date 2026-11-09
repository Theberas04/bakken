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
- [ ] Web-app: bakken, scannen, codes, beheer
- [ ] PWA: service worker, offline, QR-decoder
- [ ] QR-generator en printvel
- [ ] Proxmox-installatie en Cloudflare-tunnel
