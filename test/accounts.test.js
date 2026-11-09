'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  maakAfdruk, controleerAfdruk, isSterkWachtwoord, nieuwToken, sessieKoekje, wisKoekje,
  leesKoekjes, tokenUitVerzoek, KOEKJE
} = require('../lib/accounts');

test('een afdruk bevat het wachtwoord niet en gebruikt een eigen zout', () => {
  const wachtwoord = 'mijn-huis-wachtwoord';
  const een = maakAfdruk(wachtwoord);
  const twee = maakAfdruk(wachtwoord);
  assert.equal(een.includes(wachtwoord), false, 'het wachtwoord zelf hoort er niet in te staan');
  assert.equal(een.startsWith('scrypt$16384$8$1$'), true);
  assert.equal(een.split('$').length, 6);
  assert.notEqual(een, twee, 'twee keer hetzelfde wachtwoord geeft twee verschillende afdrukken');
});

test('een te kort wachtwoord wordt geweigerd', () => {
  assert.equal(isSterkWachtwoord('kort'), false);
  assert.equal(isSterkWachtwoord('lang-genoeg-1'), true);
  assert.throws(() => maakAfdruk('kort'), /minstens 10 tekens/);
});

test('controleren: goed wachtwoord ja, fout wachtwoord nee', () => {
  const afdruk = maakAfdruk('een-lang-wachtwoord');
  assert.equal(controleerAfdruk('een-lang-wachtwoord', afdruk), true);
  assert.equal(controleerAfdruk('een-lang-wachtwoor', afdruk), false);
  assert.equal(controleerAfdruk('', afdruk), false);
});

test('een onleesbare afdruk geeft geen fout maar onwaar', () => {
  for (const stuk of ['', null, undefined, 'geen-afdruk', 'scrypt$1$2$3$4', 'scrypt$16384$8$1$zz$zz']) {
    assert.equal(controleerAfdruk('wat-dan-ook-1', stuk), false, String(stuk));
  }
});

test('een nieuw sessietoken is lang en uniek', () => {
  const gezien = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = nieuwToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(gezien.has(token), false);
    gezien.add(token);
  }
});

test('het sessiekoekje staat standaard op Secure, HttpOnly en SameSite=Lax', () => {
  const koekje = sessieKoekje('abc123');
  assert.match(koekje, new RegExp('^' + KOEKJE + '=abc123'));
  assert.match(koekje, /HttpOnly/);
  assert.match(koekje, /SameSite=Lax/);
  assert.match(koekje, /Secure/);
  assert.match(koekje, /Path=\//);
});

test('bij een proef op http kan Secure uit (anders stuurt de browser het koekje niet mee)', () => {
  assert.equal(/Secure/.test(sessieKoekje('abc123', { secure: false })), false);
  assert.match(wisKoekje(), /Max-Age=0/);
});

test('het koekje lezen uit een verzoek werkt, ook met meerdere koekjes', () => {
  const req = { headers: { cookie: 'iets=anders; ' + KOEKJE + '=deadbeef; nog=1' } };
  assert.equal(tokenUitVerzoek(req), 'deadbeef');
  assert.equal(leesKoekjes(req).iets, 'anders');
  assert.equal(tokenUitVerzoek({ headers: {} }), '');
  assert.equal(tokenUitVerzoek(null), '');
});
