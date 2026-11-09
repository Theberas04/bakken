# Wat er per versie veranderd is

## 0.4.0 - 9 november 2026
- Het installatiescript maakt zelf een Debian-container aan (zoals bij de andere apps), in
  plaats van een bestaande container te vragen. Staat Bakken al in een container, dan wordt die
  opnieuw ingericht. Instellingen zoals `GEHEUGEN`, `SCHIJF`, `BRIDGE` en `OPSLAG` zijn
  optioneel.

## 0.3.1 - 9 november 2026
- Installatie en bijwerken zonder container-nummer: het script zoekt de container waar Bakken in
  staat, of de enige draaiende container, en vraagt het nummer alleen als het moet.

## 0.3.0 - 9 november 2026
- Web-app: bakken met zoeken, bak-detail met voorraad (+ en -), foto's van de inhoud.
- Codes: eigen naam per sticker, status vrij/gedrukt/geplakt, koppelen aan een bak.
- Printvel: 48 stickers op A4 met de naam eronder, klaar voor de printer.
- Beheer: gebruikers met rechten aan en uit, versiecontrole, het vaste adres voor QR-links.
- PWA: manifest, pictogram en service worker; de app-schil staat in de cache, zodat de app en
  een gescande sticker ook zonder internet openen. Wat je offline wijzigt, gaat in een
  wachtrij en wordt later verstuurd.
- Installatie voor een bestaande Proxmox-container, met bijwerken en een Cloudflare-tunnel.

## 0.2.0 - 9 november 2026
- Server: API voor bakken, producten, codes, scannen en gebruikers.
- Accounts: eerste keer instellen, inloggen, uitloggen, sessiekoekje met Secure achter https.
- Rechten: de beheerder kent rechten toe en trekt ze weer in; de laatste beheerder blijft staan.
- Versiecontrole: `/api/versie` (wat draait hier) en `/api/versie/controle` (wat staat op GitHub).
- `/healthz`, zodat een tunnelmelding niet als kapotte app gelezen wordt.

## 0.1.0 - 9 november 2026
- Datalaag: gebruikers, sessies, bakken, producten per bak, codes en foto's.
- Codes zonder verwarrende tekens, QR-inhoud zonder adres, en het uitlezen van de code uit elke link.
- 48 proeven groen, waaronder een proef die adressen in dit repo weigert.
