'use strict';
// Korte codes voor de QR-stickers op de bakken.
//
// Het alfabet laat 0, O, 1, I en L weg: op een geprinte sticker zijn die niet uit
// elkaar te houden, en een verkeerd voorgelezen code is niet stil te repareren.
// Daarom ook geen O->0 of l->1 in het normaliseren: een letter die niet in het
// alfabet zit is een fout, geen typefout om weg te poetsen.

const { randomInt } = require('node:crypto');

const ALFABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTE = 5;

// Wat er in de QR staat als er geen adres bekend is: de losse code. Zo hoeft er
// nooit een domeinnaam of IP-adres in de code, het repo of de geschiedenis te staan.
function normaliseer(code) {
  return String(code == null ? '' : code).toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function isCode(code) {
  const c = normaliseer(code);
  if (c.length !== CODE_LENGTE) return false;
  for (const teken of c) {
    if (!ALFABET.includes(teken)) return false;
  }
  return true;
}

function maakCode(bestaande) {
  const inGebruik = new Set((bestaande || []).map(normaliseer));
  for (let poging = 0; poging < 1000; poging += 1) {
    let code = '';
    for (let i = 0; i < CODE_LENGTE; i += 1) code += ALFABET[randomInt(ALFABET.length)];
    if (!inGebruik.has(code)) return code;
  }
  throw new Error('Geen vrije code gevonden na 1000 pogingen');
}

// De inhoud van de QR. `basis` komt van de server (uit het verzoek of uit de
// instellingen) en staat nergens hard in de code.
function qrInhoud(code, basis) {
  const c = normaliseer(code);
  if (!isCode(c)) throw new Error('Geen geldige code: ' + code);
  const schoon = String(basis == null ? '' : basis).trim().replace(/\/+$/, '');
  return schoon ? schoon + '/b/' + c : c;
}

// Haalt de code uit wat er ook in de QR staat: een losse code of een link.
// Bewust adres-onafhankelijk: welk domein er ook voor staat, de laatste
// code-achtige groep uit het pad is de code.
function codeUitInhoud(tekst) {
  const t = String(tekst == null ? '' : tekst).trim();
  if (!t) return '';
  if (isCode(t)) return normaliseer(t);
  let pad = t;
  try {
    pad = new URL(t).pathname;
  } catch (e) {
    // Geen url: dan is het misschien "b/ABCDE" of "ABCDE?x=1"; hieronder splitsen we toch.
  }
  const delen = pad.split(/[/?#=&]+/).filter(Boolean);
  for (let i = delen.length - 1; i >= 0; i -= 1) {
    if (isCode(delen[i])) return normaliseer(delen[i]);
  }
  return '';
}

module.exports = {
  ALFABET,
  CODE_LENGTE,
  normaliseer,
  isCode,
  maakCode,
  qrInhoud,
  codeUitInhoud
};
