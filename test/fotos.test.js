'use strict';
// Foto's van de inhoud: uploaden, terugkijken, weigeren wat geen foto is, het
// maximum per bak en de rechten.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const hulp = require('./hulp');

// Een echte 1x1 JPEG, klein genoeg om in de proef te passen.
const KLEINE_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAA' +
  'AAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function metBak(t) {
  const omgeving = await hulp.start();
  const ingesteld = await hulp.stelIn(omgeving.basis);
  const klant = ingesteld.klant;
  const bak = (await klant.post('/api/bakken', { naam: 'Garage', locatie: 'stelling 2' })).gegevens.bak;
  t.after(() => omgeving.stop());
  return { omgeving, klant, bak };
}

test('een foto uploaden en weer terugkijken', async (t) => {
  const { omgeving, klant, bak } = await metBak(t);
  const antwoord = await klant.post('/api/bakken/' + bak.id + '/fotos', {
    data: 'data:image/jpeg;base64,' + KLEINE_JPEG,
    breedte: 1,
    hoogte: 1
  });
  assert.equal(antwoord.status, 201);
  assert.equal(antwoord.gegevens.foto.soort, 'image/jpeg');
  assert.equal(antwoord.gegevens.foto.opServer, true);

  // Zonder sessie mag de foto niet naar buiten.
  const zonderSessie = await fetch(omgeving.basis + '/api/fotos/' + antwoord.gegevens.foto.id);
  assert.equal(zonderSessie.status, 401);

  const metSessie = await klant.haal('/api/fotos/' + antwoord.gegevens.foto.id);
  assert.equal(metSessie.status, 200);
  assert.match(metSessie.koppen.get('content-type'), /image\/jpeg/);

  const lijst = await klant.haal('/api/bakken/' + bak.id + '/fotos');
  assert.equal(lijst.gegevens.fotos.length, 1);
});

test('wat geen foto is, komt er niet in', async (t) => {
  const { klant, bak } = await metBak(t);
  const antwoord = await klant.post('/api/bakken/' + bak.id + '/fotos', {
    data: Buffer.from('dit is geen foto, maar tekst').toString('base64')
  });
  assert.equal(antwoord.status, 400);
  assert.match(antwoord.gegevens.fout, /geen JPEG/i);
});

test('een leeg verzoek wordt geweigerd', async (t) => {
  const { klant, bak } = await metBak(t);
  const antwoord = await klant.post('/api/bakken/' + bak.id + '/fotos', {});
  assert.equal(antwoord.status, 400);
  assert.match(antwoord.gegevens.fout, /geen foto/i);
});

test('het maximum per bak geldt', async (t) => {
  const { klant, bak } = await metBak(t);
  for (let i = 0; i < 12; i += 1) {
    const uit = await klant.post('/api/bakken/' + bak.id + '/fotos', { data: KLEINE_JPEG });
    assert.equal(uit.status, 201, 'foto ' + (i + 1));
  }
  const teveel = await klant.post('/api/bakken/' + bak.id + '/fotos', { data: KLEINE_JPEG });
  assert.equal(teveel.status, 400);
  assert.match(teveel.gegevens.fout, /al 12 foto/i);
});

test('een foto verwijderen haalt het bestand weg', async (t) => {
  const { omgeving, klant, bak } = await metBak(t);
  const foto = (await klant.post('/api/bakken/' + bak.id + '/fotos', { data: KLEINE_JPEG })).gegevens.foto;
  const weg = await klant.del('/api/fotos/' + foto.id);
  assert.equal(weg.status, 200);
  assert.equal((await klant.haal('/api/fotos/' + foto.id)).status, 404);
  assert.equal(fs.readdirSync(omgeving.app.mediaDir).length, 0, 'het bestand is ook van de schijf weg');
});

test('zonder recht om bakken te wijzigen kun je geen foto toevoegen', async (t) => {
  const { omgeving, klant, bak } = await metBak(t);
  const nieuw = await klant.post('/api/gebruikers', {
    naam: 'Lisa',
    wachtwoord: 'nog-een-lang-wachtwoord',
    rol: 'gebruiker',
    rechten: { bakken_bekijken: true }
  });
  assert.equal(nieuw.status, 201);

  const inlog = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST',
    lichaam: { naam: 'Lisa', wachtwoord: 'nog-een-lang-wachtwoord' }
  });
  assert.equal(inlog.status, 200);
  const lisa = hulp.klant(omgeving.basis, hulp.koekjeUit(inlog.setCookies));

  // Ze mag kijken...
  assert.equal((await lisa.haal('/api/bakken/' + bak.id)).status, 200);
  // ...maar niets toevoegen.
  const geprobeerd = await lisa.post('/api/bakken/' + bak.id + '/fotos', { data: KLEINE_JPEG });
  assert.equal(geprobeerd.status, 403);
});

test('een foto van een bak die niet bestaat wordt geweigerd', async (t) => {
  const { klant } = await metBak(t);
  const antwoord = await klant.post('/api/bakken/9999/fotos', { data: KLEINE_JPEG });
  assert.equal(antwoord.status, 400);
  assert.match(antwoord.gegevens.fout, /bestaat niet/i);
});
