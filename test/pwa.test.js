'use strict';
// De app moet te installeren zijn en zonder internet openen. Deze proeven kijken
// naar de schil: manifest, pictogram, service worker en de opmaak van de pagina.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const hulp = require('./hulp');

const PUBLIC = path.join(__dirname, '..', 'public');
const lees = (naam) => fs.readFileSync(path.join(PUBLIC, naam), 'utf8');

test('het manifest is geldige JSON met de velden die een telefoon eist', () => {
  const manifest = JSON.parse(lees('manifest.webmanifest'));
  assert.equal(manifest.name, 'Bakken');
  assert.equal(manifest.short_name, 'Bakken');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons && manifest.icons.length > 0, 'zonder pictogram kun je niet installeren');
  const bronnen = manifest.icons.map((p) => p.src);
  assert.ok(bronnen.includes('/icon.svg'), 'het pictogram uit de pagina hoort in het manifest');
});

test('de pagina laadt het manifest, het pictogram en de service worker', () => {
  const html = lees('index.html');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="icon" href="\/icon\.svg"/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
});

test('de service worker bewaart de hele schil in de cache', () => {
  const sw = lees('sw.js');
  for (const bestand of ['/index.html', '/styles.css', '/app.js', '/lib/qrcode.js', '/lib/qr.js',
    '/icon.svg', '/manifest.webmanifest']) {
    assert.ok(sw.includes("'" + bestand + "'"), bestand + ' hoort in de schil te staan');
  }
  // Een gescande link moet offline de pagina openen.
  assert.match(sw, /mode === 'navigate'/);
  assert.match(sw, /caches\.match\('\/index\.html'\)/);
  // Gegevens mogen nooit uit de cache komen; die houdt de app zelf bij.
  assert.match(sw, /'\/api\/'/);
});

test('de service worker haalt de schil vers op, niet uit de HTTP-cache', () => {
  const sw = lees('sw.js');
  // De server stuurt max-age=300 mee. Zonder cache: 'reload' houdt de telefoon
  // na een nieuwe versie vijf minuten de oude app, ook al is de cachenaam omhoog.
  assert.match(sw, /cache: 'reload'/, 'de schil hoort met cache: reload opgehaald te worden');
});

test('de cachenaam is opgehoogd ten opzichte van de eerste versie', () => {
  const sw = lees('sw.js');
  const naam = /var CACHE = '([^']+)'/.exec(sw);
  assert.ok(naam, 'de cachenaam hoort in een variabele te staan');
  assert.notEqual(naam[1], 'bakken-schil-v1', 'bij een wijziging van de pagina moet de cachenaam omhoog');
});

test('de server levert manifest en service worker met het juiste soort', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const manifest = await hulp.vraag(omgeving.basis, '/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.koppen.get('content-type'), /application\/manifest\+json/);

  const sw = await hulp.vraag(omgeving.basis, '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.koppen.get('content-type'), /javascript/);
  assert.equal(sw.koppen.get('cache-control'), 'no-store', 'de service worker mag niet uit de cache komen');

  const icoon = await hulp.vraag(omgeving.basis, '/icon.svg');
  assert.equal(icoon.status, 200);
  assert.match(icoon.koppen.get('content-type'), /image\/svg\+xml/);
});

test('een gescande sticker opent de pagina, ook zonder sessie', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const antwoord = await hulp.vraag(omgeving.basis, '/b/ABCDE');
  assert.equal(antwoord.status, 200);
  assert.match(antwoord.tekst, /<div id="app">/);
});
