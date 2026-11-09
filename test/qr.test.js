'use strict';
// De QR-code moet niet alleen mooi zijn, maar ook leesbaar. Daarom maken we hem
// en lezen we hem met een echte lezer (jsqr) weer terug: komt er precies de
// inhoud uit die erin ging, dan klopt de code.
//
// jsqr staat alleen bij de proeven, niet in de app zelf.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const qr = require('../public/lib/qr.js');
const jsqr = require('jsqr');

const codes = require('../lib/codes');

// Een matrix omzetten naar beeldpunten die de lezer begrijpt (zwart-wit RGBA).
function naarBeeld(matrix, schaal) {
  const s = schaal || 4;
  const stil = qr.STIL;
  const zijde = (matrix.aantal + stil * 2) * s;
  const beeld = new Uint8ClampedArray(zijde * zijde * 4).fill(255);
  for (let r = 0; r < matrix.aantal; r += 1) {
    for (let k = 0; k < matrix.aantal; k += 1) {
      if (!matrix.rijen[r][k]) continue;
      for (let dy = 0; dy < s; dy += 1) {
        for (let dx = 0; dx < s; dx += 1) {
          const y = (r + stil) * s + dy;
          const x = (k + stil) * s + dx;
          const i = (y * zijde + x) * 4;
          beeld[i] = 17; beeld[i + 1] = 17; beeld[i + 2] = 17; beeld[i + 3] = 255;
        }
      }
    }
  }
  return { beeld, zijde };
}

function leesTerug(inhoud, opties) {
  const uit = qr.maakSvg(inhoud, opties);
  const { beeld, zijde } = naarBeeld(uit.matrix);
  const gevonden = jsqr(beeld, zijde, zijde);
  assert.ok(gevonden, 'de lezer moet de code kunnen vinden');
  return gevonden.data;
}

test('de QR-code leest terug wat erin ging', () => {
  const inhoud = codes.qrInhoud('3TCBT', 'https://voorbeeld.net');
  assert.equal(inhoud, 'https://voorbeeld.net/b/3TCBT');
  assert.equal(leesTerug(inhoud), inhoud);
});

test('ook een lange link met een eigen adres leest goed terug', () => {
  const inhoud = 'https://mijn-eigen-omgeving-voorbeeld.net/b/9ZXCV';
  assert.equal(leesTerug(inhoud), inhoud);
});

test('de code is vierkant en heeft een stille rand', () => {
  const uit = qr.maakSvg('https://voorbeeld.net/b/3TCBT');
  assert.equal(uit.matrix.rijen.length, uit.matrix.aantal);
  for (const rij of uit.matrix.rijen) assert.equal(rij.length, uit.matrix.aantal);
  // 21 modules (versie 1) of meer, altijd oneven.
  assert.ok(uit.matrix.aantal >= 21);
  assert.equal(uit.matrix.aantal % 2, 1);
  // De rand zit in de SVG als wit vlak onder het pad.
  assert.match(uit.svg, /fill="#ffffff"/);
  assert.match(uit.svg, /shape-rendering="crispEdges"/);
});

test('een printversie schaalt mee met het vak', () => {
  const uit = qr.maakPrintSvg('https://voorbeeld.net/b/3TCBT');
  const eerste = /^<svg[^>]*>/.exec(uit)[0];
  assert.ok(!/ width="/.test(eerste), 'geen vaste breedte in de printversie');
  assert.ok(!/ height="/.test(eerste), 'geen vaste hoogte in de printversie');
  assert.match(eerste, /viewBox="0 0 \d+ \d+"/);
  // De witte achtergrond blijft staan, anders is de code onleesbaar.
  assert.match(uit, /fill="#ffffff"/);
});

test('elke code uit het alfabet geeft een leesbare sticker', () => {
  const steekproef = ['AAAAA', '23456', '9ZWXK', 'MNPQR'];
  for (const code of steekproef) {
    const inhoud = codes.qrInhoud(code, 'https://voorbeeld.net');
    assert.equal(leesTerug(inhoud), inhoud, 'code ' + code);
  }
});

test('zonder inhoud weigert de generator', () => {
  assert.throws(() => qr.maakMatrix(''), /inhoud/i);
  assert.throws(() => qr.maakSvg(null), /inhoud/i);
});
