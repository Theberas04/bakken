# Wat er per versie veranderd is

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
