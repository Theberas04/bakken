'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  ALFABET, CODE_LENGTE, normaliseer, isCode, maakCode, qrInhoud, codeUitInhoud
} = require('../lib/codes');

test('het alfabet laat de verwarrende tekens weg', () => {
  for (const teken of ['0', 'O', '1', 'I', 'L']) {
    assert.equal(ALFABET.includes(teken), false, teken + ' hoort niet in het alfabet');
  }
  assert.equal(new Set(ALFABET).size, ALFABET.length, 'geen dubbele tekens in het alfabet');
});

test('normaliseren haalt spaties, streepjes en hoofletters eruit', () => {
  assert.equal(normaliseer(' a b-3 4 '), 'AB34');
  assert.equal(normaliseer(null), '');
  assert.equal(normaliseer(undefined), '');
});

test('isCode keurt lengte en tekens', () => {
  assert.equal(isCode('AB234'), true);
  assert.equal(isCode('ab234'), true, 'kleine letters worden gelezen als hoofdletters');
  assert.equal(isCode('AB23'), false, 'te kort');
  assert.equal(isCode('AB2345'), false, 'te lang');
  assert.equal(isCode('ABO34'), false, 'de letter O bestaat niet');
  assert.equal(isCode('AB034'), false, 'de nul bestaat niet');
  assert.equal(isCode('ABI34'), false, 'de letter I bestaat niet');
  assert.equal(isCode(''), false);
  assert.equal(isCode(null), false);
});

test('maakCode levert unieke, geldige codes', () => {
  const gezien = new Set();
  for (let i = 0; i < 500; i += 1) {
    const code = maakCode([...gezien]);
    assert.equal(isCode(code), true);
    assert.equal(code.length, CODE_LENGTE);
    assert.equal(gezien.has(code), false, 'code kwam al voor');
    gezien.add(code);
  }
});

test('maakCode ontwijkt bestaande codes', () => {
  const bestaand = ['AB234', 'CD567', 'EF89G'];
  for (let i = 0; i < 50; i += 1) {
    assert.equal(bestaand.includes(maakCode(bestaand)), false);
  }
});

test('qrInhoud zonder basis is de losse code: geen adres nodig', () => {
  assert.equal(qrInhoud('ab234', ''), 'AB234');
  assert.equal(qrInhoud('ab234', null), 'AB234');
});

test('qrInhoud met basis maakt de link, ook met een schuine streep erachter', () => {
  assert.equal(qrInhoud('ab234', 'https://voorbeeld'), 'https://voorbeeld/b/AB234');
  assert.equal(qrInhoud('ab234', 'https://voorbeeld/'), 'https://voorbeeld/b/AB234');
  assert.equal(qrInhoud('ab234', 'https://voorbeeld//'), 'https://voorbeeld/b/AB234');
});

test('qrInhoud weigert onzin', () => {
  assert.throws(() => qrInhoud('AB23', ''), /geldige code/);
});

test('codeUitInhoud haalt de code uit een losse code of uit welke link dan ook', () => {
  assert.equal(codeUitInhoud('AB234'), 'AB234');
  assert.equal(codeUitInhoud('  ab234 '), 'AB234');
  assert.equal(codeUitInhoud('https://bakken.voorbeeld.net/b/AB234'), 'AB234');
  assert.equal(codeUitInhoud('https://iets-anders.nl/b/AB234?bron=sticker'), 'AB234');
  assert.equal(codeUitInhoud('http://192.168.1.100:8080/b/AB234'), 'AB234');
  assert.equal(codeUitInhoud('B/AB234'), 'AB234');
});

test('codeUitInhoud geeft niets terug bij onzin', () => {
  assert.equal(codeUitInhoud(''), '');
  assert.equal(codeUitInhoud('gewoon een zin zonder code'), '');
  assert.equal(codeUitInhoud('https://voorbeeld.net/over-ons'), '');
  assert.equal(codeUitInhoud(null), '');
});
