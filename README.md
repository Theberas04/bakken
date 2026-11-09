# Bakken

QR-stickers voor opbergbakken, met de voorraad per bak, foto's van de inhoud en accounts.

Je plakt een sticker op een bak, scant hem met de app en ziet meteen wat erin zit en
hoeveel ervan. De stickers maak je zelf in de app: je geeft elke code een eigen naam
(bijvoorbeeld "Garage - kerstspullen"), print een vel en plakt ze op.

## Wat het wordt

- **PWA** die je vanaf het adres op je telefoon installeert; de gegevens staan lokaal,
  dus scannen en kijken werkt ook zonder internet.
- **Web-app** met eigen accounts: één beheerder (Tom) deelt rechten uit en kan ze ook
  weer intrekken.
- **Versiecontrole** in de beheerkaart: de app meldt of er iets nieuws op GitHub staat,
  net als bij AkkoordKast.
- **Voorraad per bak**: producten met een aantal, plus foto's van de inhoud.

## Over dit repo

Er staat hier **geen adres**: geen domeinnaam en geen IP-adres van de eigen omgeving,
niet in de code en niet in de geschiedenis. Het adres van de app komt van het verzoek
zelf of uit de instellingen op de machine (buiten dit repo). `test/geen-adressen.test.js`
bewaakt dat automatisch.

## Draaien

Geen npm-afhankelijkheden; Node 22.5 of hoger (vanwege `node:sqlite`).

    node --test test/*.test.js

## Stand van zaken

- [x] Datalaag: gebruikers, sessies, bakken, producten, codes, foto's (46 proeven groen)
- [ ] Server: routes, inloggen, versiecontrole
- [ ] Web-app: bakken, scannen, codes, beheer
- [ ] PWA: service worker, offline, QR-decoder
- [ ] QR-generator en printvel
- [ ] Proxmox-installatie en Cloudflare-tunnel
