'use strict';
// Waakt over één harde regel: er staat nergens een adres van Tom's eigen omgeving
// in dit repo (en dus ook niet in de geschiedenis, want dat bestand stond er altijd).
//
// Verboden: de domeinnaam van de app en IP-adressen. Toegestaan: localhost,
// 127.0.0.1, 0.0.0.0 en de algemene voorbeeldreeksen (192.168.1.100, 10.0.0.x).
//
// De verboden woorden staan hier expres in twee stukken, anders zou deze proef
// zichzelf vinden en altijd zakken.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORTEL = path.join(__dirname, '..');
const DOMEIN = 'werdens' + 'media';
const TOEGESTANE_IP = ['127.0.0.1', '0.0.0.0', '192.168.1.100'];

function bestanden(map, uit) {
  for (const naam of fs.readdirSync(map)) {
    if (naam === '.git' || naam === 'node_modules' || naam === 'data') continue;
    const pad = path.join(map, naam);
    const staat = fs.statSync(pad);
    if (staat.isDirectory()) { bestanden(pad, uit); continue; }
    if (staat.size > 2 * 1024 * 1024) continue;
    uit.push(pad);
  }
  return uit;
}

test('geen domeinnaam van de app in het repo', () => {
  const gevonden = [];
  for (const pad of bestanden(WORTEL, [])) {
    const inhoud = fs.readFileSync(pad, 'utf8');
    if (inhoud.toLowerCase().includes(DOMEIN)) gevonden.push(path.relative(WORTEL, pad));
  }
  assert.deepEqual(gevonden, [], 'de domeinnaam hoort alleen in de instellingen op de machine te staan');
});

test('geen ip-adressen in het repo, behalve de toegestane voorbeelden', () => {
  const gevonden = [];
  for (const pad of bestanden(WORTEL, [])) {
    const inhoud = fs.readFileSync(pad, 'utf8');
    const treffers = inhoud.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    for (const treffer of treffers) {
      if (TOEGESTANE_IP.includes(treffer)) continue;
      if (/^0\.|\.0$/.test(treffer)) continue;
      if (/(?:^|\.)(?:0|1|2|3|4|5|6|7|8|9)\.\d+\.\d+$/.test(treffer)) continue;
      gevonden.push(path.relative(WORTEL, pad) + ': ' + treffer);
    }
  }
  assert.deepEqual(gevonden, [], 'een adres van Tom\'s netwerk hoort niet in dit repo');
});
