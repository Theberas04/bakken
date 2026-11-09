'use strict';
// Wachtwoorden en sessies.
//
// Van een wachtwoord bewaren we nooit het wachtwoord zelf, alleen een
// scrypt-afdruk met een eigen zout per gebruiker. Het formaat staat in de
// afdruk zodat een latere kostprijsverhoging oude afdrukken kan blijven lezen.

const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');

const KOSTEN = { N: 16384, r: 8, p: 1 };
const SLEUTELLENGTE = 64;
const SESSIE_DAGEN = 30;
const KOEKJE = 'bakken';
const MIN_WACHTWOORD = 10;

function maakAfdruk(wachtwoord) {
  if (!isSterkWachtwoord(wachtwoord)) {
    throw new Error('Een wachtwoord van minstens ' + MIN_WACHTWOORD + ' tekens');
  }
  const zout = randomBytes(16);
  const afdruk = scryptSync(String(wachtwoord), zout, SLEUTELLENGTE, KOSTEN);
  return ['scrypt', KOSTEN.N, KOSTEN.r, KOSTEN.p, zout.toString('hex'), afdruk.toString('hex')].join('$');
}

// Controleert een wachtwoord tegen een afdruk. Geeft altijd een boolean, ook bij
// een onleesbare afdruk: de aanroeper hoort geen verschil te kunnen meten.
function controleerAfdruk(wachtwoord, afdruk) {
  if (typeof afdruk !== 'string' || !afdruk) return false;
  const delen = afdruk.split('$');
  if (delen.length !== 6 || delen[0] !== 'scrypt') return false;
  const N = Number(delen[1]);
  const r = Number(delen[2]);
  const p = Number(delen[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let zout;
  let verwacht;
  try {
    zout = Buffer.from(delen[4], 'hex');
    verwacht = Buffer.from(delen[5], 'hex');
  } catch (e) {
    return false;
  }
  if (!zout.length || !verwacht.length) return false;
  let berekend;
  try {
    berekend = scryptSync(String(wachtwoord == null ? '' : wachtwoord), zout, verwacht.length, { N, r, p });
  } catch (e) {
    return false;
  }
  if (berekend.length !== verwacht.length) return false;
  return timingSafeEqual(berekend, verwacht);
}

function isSterkWachtwoord(wachtwoord) {
  return typeof wachtwoord === 'string' && wachtwoord.length >= MIN_WACHTWOORD;
}

function nieuwToken() {
  return randomBytes(32).toString('hex');
}

// Het sessiekoekje. `secure` hoort aan te staan zodra de app achter https staat
// (Cloudflare), en uit te staan bij een proef op http, anders stuurt de browser
// het koekje niet mee en lijkt inloggen stuk.
function sessieKoekje(token, opties) {
  const o = opties || {};
  const dagen = Number.isFinite(o.dagen) ? o.dagen : SESSIE_DAGEN;
  const delen = [KOEKJE + '=' + token, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' + Math.round(dagen * 86400)];
  if (o.secure !== false) delen.push('Secure');
  return delen.join('; ');
}

function wisKoekje() {
  return KOEKJE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

function leesKoekjes(req) {
  const uit = {};
  const regel = (req && req.headers && req.headers.cookie) || '';
  for (const stuk of regel.split(';')) {
    const i = stuk.indexOf('=');
    if (i < 0) continue;
    uit[stuk.slice(0, i).trim()] = decodeURIComponent(stuk.slice(i + 1).trim());
  }
  return uit;
}

function tokenUitVerzoek(req) {
  return leesKoekjes(req)[KOEKJE] || '';
}

module.exports = {
  KOSTEN,
  SESSIE_DAGEN,
  KOEKJE,
  MIN_WACHTWOORD,
  maakAfdruk,
  controleerAfdruk,
  isSterkWachtwoord,
  nieuwToken,
  sessieKoekje,
  wisKoekje,
  leesKoekjes,
  tokenUitVerzoek
};
