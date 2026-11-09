'use strict';
// Bijwerken vanuit de app, net als bij AkkoordKast: de beheerder drukt op Bijwerken, de server
// start het bijwerkscript, en stopt daarna zodat systemd hem met de nieuwe versie opnieuw
// opstart. Deze proeven blijven weg van het echte script en van GitHub: ze gebruiken een eigen,
// klein script in een eigen map.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hulp = require('./hulp');

// Het proefscript woont in zijn eigen map, buiten de gegevensmap van de proef: die map wordt bij
// het opruimen van de app verwijderd, en dan zou het script verdwijnen voordat de proef kijkt.
function maakScript(inhoud, uitvoerbaar) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'bakken-bijwerken-'));
  const pad = path.join(map, 'proef-bijwerken.sh');
  fs.writeFileSync(pad, inhoud, { mode: uitvoerbaar === false ? 0o644 : 0o755 });
  return pad;
}

test('zonder bijwerkscript zegt de app dat het op de host moet', async () => {
  const omgeving = await hulp.start({ updateScript: '' });
  try {
    const { klant } = await hulp.stelIn(omgeving.basis);
    const versie = await klant.haal('/api/versie');
    assert.equal(versie.gegevens.updateMogelijk, false);
    assert.equal(versie.gegevens.updateScript, '');

    const uit = await klant.post('/api/update', {});
    assert.equal(uit.status, 400);
    assert.match(uit.gegevens.fout, /op je Proxmox-host/);
    assert.match(uit.gegevens.commando, /update-from-github\.sh/);
    assert.ok(!/CTID/.test(uit.gegevens.commando), 'het commando hoort geen container-nummer te vragen');
  } finally {
    await omgeving.stop();
  }
});

test('een script zonder uitvoerrecht telt niet als bijwerken mogelijk', async () => {
  const pad = maakScript('#!/bin/sh\nexit 0\n', false);
  const omgeving = await hulp.start({ updateScript: pad });
  try {
    const { klant } = await hulp.stelIn(omgeving.basis);
    const versie = await klant.haal('/api/versie');
    assert.equal(versie.gegevens.updateMogelijk, false);
    const uit = await klant.post('/api/update', {});
    assert.equal(uit.status, 400);
  } finally {
    await omgeving.stop();
  }
});

test('een bijwerkscript dat niet lukt, laat de oude versie staan', async () => {
  const pad = maakScript('#!/bin/sh\necho "ik doe niets"\nexit 3\n', true);
  const omgeving = await hulp.start({ updateScript: pad });
  try {
    const { klant } = await hulp.stelIn(omgeving.basis);
    const versie = await klant.haal('/api/versie');
    assert.equal(versie.gegevens.updateMogelijk, true);
    assert.equal(versie.gegevens.updateScript, pad);

    const uit = await klant.post('/api/update', {});
    assert.equal(uit.status, 500);
    assert.match(uit.gegevens.fout, /code 3/);
    assert.match(uit.gegevens.uitvoer, /ik doe niets/);

    // De dienst draait nog: een volgende vraag wordt gewoon beantwoord.
    const nog = await klant.haal('/api/versie');
    assert.equal(nog.status, 200);
  } finally {
    await omgeving.stop();
  }
});

test('zonder recht op bijwerken mag je het niet', async () => {
  const pad = maakScript('#!/bin/sh\nexit 0\n', true);
  const omgeving = await hulp.start({ updateScript: pad });
  try {
    const beheerder = await hulp.stelIn(omgeving.basis);
    const nieuw = await beheerder.klant.post('/api/gebruikers', { naam: 'Kim', wachtwoord: 'nog-een-lang-woord' });
    assert.equal(nieuw.status, 201);
    const ingelogd = await hulp.vraag(omgeving.basis, '/api/inloggen', {
      methode: 'POST', lichaam: { naam: 'Kim', wachtwoord: 'nog-een-lang-woord' }
    });
    const kim = hulp.klant(omgeving.basis, hulp.koekjeUit(ingelogd.setCookies));
    const uit = await kim.post('/api/update', {});
    assert.equal(uit.status, 403);
  } finally {
    await omgeving.stop();
  }
});
