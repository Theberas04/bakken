'use strict';
const test = require('node:test');
const assert = require('node:assert');

const hulp = require('./hulp');

test('healthz en de status van de app', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const gezond = await hulp.vraag(omgeving.basis, '/healthz');
  assert.equal(gezond.status, 200);
  assert.match(gezond.tekst, /^ok bakken \d/);

  const status = await hulp.vraag(omgeving.basis, '/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.gegevens.ingesteld, false, 'een verse app is nog niet ingesteld');
  assert.equal(typeof status.gegevens.versie, 'string');
});

test('de pagina en een gescande link laden zonder sessie, de gegevens niet', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const pagina = await hulp.vraag(omgeving.basis, '/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.tekst, /Bakken/);
  assert.match(pagina.koppen.get('content-type'), /text\/html/);

  const gescand = await hulp.vraag(omgeving.basis, '/b/AB234');
  assert.equal(gescand.status, 200, 'een gescande sticker opent de app');
  assert.match(gescand.tekst, /Bakken/);

  const zonder = await hulp.vraag(omgeving.basis, '/api/bakken');
  assert.equal(zonder.status, 401);

  const uitDeMap = await hulp.vraag(omgeving.basis, '/../server.js');
  assert.notEqual(uitDeMap.status, 200, 'buiten de map public kom je niet');
});

test('de app instellen: wachtwoord-eisen en het beheerdersaccount', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const kort = await hulp.vraag(omgeving.basis, '/api/instellen', {
    methode: 'POST', lichaam: { naam: 'Tom', wachtwoord: 'kort' }
  });
  assert.equal(kort.status, 400);
  assert.match(kort.gegevens.fout, /10 tekens/);

  const gedaan = await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord');
  assert.equal(gedaan.antwoord.status, 200);
  assert.equal(gedaan.antwoord.gegevens.gebruiker.naam, 'Tom');
  assert.equal(gedaan.antwoord.gegevens.gebruiker.rol, 'beheerder');
  assert.equal('afdruk' in gedaan.antwoord.gegevens.gebruiker, false, 'nooit de afdruk naar buiten');
  assert.match(gedaan.koekje, /^bakken=[0-9a-f]{64}$/);
  assert.match(gedaan.antwoord.setCookies[0], /HttpOnly/);
  assert.equal(/Secure/.test(gedaan.antwoord.setCookies[0]), false, 'over http geen Secure, anders werkt de proef niet');

  const nogEens = await hulp.vraag(omgeving.basis, '/api/instellen', {
    methode: 'POST', lichaam: { naam: 'Iemand', wachtwoord: 'ook-lang-genoeg' }
  });
  assert.equal(nogEens.status, 403, 'de app is al ingesteld');

  const ik = await gedaan.klant.haal('/api/ik');
  assert.equal(ik.status, 200);
  assert.equal(ik.gegevens.gebruiker.naam, 'Tom');
});

test('achter https krijgt het sessiekoekje Secure mee', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());

  const antwoord = await hulp.vraag(omgeving.basis, '/api/instellen', {
    methode: 'POST',
    lichaam: { naam: 'Tom', wachtwoord: 'mijn-huis-wachtwoord' },
    koppen: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'bakken.voorbeeld.test' }
  });
  assert.equal(antwoord.status, 200);
  assert.match(antwoord.setCookies[0], /Secure/);
});

test('inloggen: verkeerd wachtwoord, te veel pogingen, en uitloggen', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord');

  const fout = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Tom', wachtwoord: 'verkeerd-wachtwoord' }
  });
  assert.equal(fout.status, 401);

  const onbekend = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Iemand', wachtwoord: 'mijn-huis-wachtwoord' }
  });
  assert.equal(onbekend.status, 401, 'een onbekende naam geeft dezelfde melding');

  // Blijven missen: op een gegeven moment wordt het afgeremd.
  let geblokkeerd = null;
  for (let i = 0; i < 15 && !geblokkeerd; i += 1) {
    const poging = await hulp.vraag(omgeving.basis, '/api/inloggen', {
      methode: 'POST', lichaam: { naam: 'Tom', wachtwoord: 'weer-verkeerd-' + i }
    });
    if (poging.status === 429) geblokkeerd = poging;
    else assert.equal(poging.status, 401);
  }
  assert.notEqual(geblokkeerd, null, 'na een reeks missers wordt het afgeremd');
  assert.match(geblokkeerd.gegevens.fout, /Te veel pogingen/);
  const ookGoed = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Tom', wachtwoord: 'mijn-huis-wachtwoord' }
  });
  assert.equal(ookGoed.status, 429, 'ook het juiste wachtwoord wacht even');

  // Een verse app om het inloggen zelf te toetsen (de teller staat hier vol).
  const tweede = await hulp.start();
  t.after(() => tweede.stop());
  await hulp.stelIn(tweede.basis, 'Tom', 'mijn-huis-wachtwoord');
  const goed = await hulp.vraag(tweede.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'tom', wachtwoord: 'mijn-huis-wachtwoord' }
  });
  assert.equal(goed.status, 200, 'de naam is niet hoofdlettergevoelig');
  const klant = hulp.klant(tweede.basis, hulp.koekjeUit(goed.setCookies));
  assert.equal((await klant.haal('/api/ik')).status, 200);
  assert.equal((await klant.post('/api/uitloggen')).status, 200);
  assert.equal((await klant.haal('/api/ik')).status, 401, 'na uitloggen is de sessie weg');
});

test('bakken, producten en de voorraad per bak via de server', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const beheerder = (await hulp.stelIn(omgeving.basis)).klant;

  const leeg = await beheerder.haal('/api/bakken');
  assert.deepEqual(leeg.gegevens.bakken, []);

  const nieuw = await beheerder.post('/api/bakken', { naam: 'Garage - kerstspullen', locatie: 'Rek 2' });
  assert.equal(nieuw.status, 201);
  const bakId = nieuw.gegevens.bak.id;

  assert.equal((await beheerder.post('/api/bakken/' + bakId + '/items', { naam: 'Kerstballen', aantal: 24, eenheid: 'stuks' })).status, 201);
  assert.equal((await beheerder.post('/api/bakken/' + bakId + '/items', { naam: 'Lichtsnoer', aantal: 3 })).status, 201);

  const detail = await beheerder.haal('/api/bakken/' + bakId);
  assert.equal(detail.gegevens.bak.producten, 2);
  assert.equal(detail.gegevens.bak.stuks, 27, 'de voorraad per bak telt de aantallen op');
  assert.equal(detail.gegevens.producten.length, 2);

  const ballen = detail.gegevens.producten.find((p) => p.naam === 'Kerstballen');
  const geteld = await beheerder.post('/api/items/' + ballen.id + '/tel', { verschil: -4 });
  assert.equal(geteld.gegevens.product.aantal, 20);
  assert.equal((await beheerder.haal('/api/bakken/' + bakId)).gegevens.bak.stuks, 23);

  const gewijzigd = await beheerder.patch('/api/bakken/' + bakId, { naam: 'Garage - kerst' });
  assert.equal(gewijzigd.gegevens.bak.naam, 'Garage - kerst');

  assert.equal((await beheerder.del('/api/items/' + ballen.id)).status, 200);
  assert.equal((await beheerder.del('/api/bakken/' + bakId)).status, 200);
  assert.equal((await beheerder.haal('/api/bakken/' + bakId)).status, 404);
});

test('codes met een eigen naam, koppelen en scannen', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const beheerder = (await hulp.stelIn(omgeving.basis)).klant;

  const gemaakt = await beheerder.post('/api/codes', { aantal: 48, naam: 'Garage - kerstspullen' });
  assert.equal(gemaakt.status, 201);
  assert.equal(gemaakt.gegevens.codes.length, 48);
  assert.equal(new Set(gemaakt.gegevens.codes.map((c) => c.code)).size, 48);
  for (const code of gemaakt.gegevens.codes) {
    assert.equal(code.naam, 'Garage - kerstspullen');
    assert.match(code.inhoud, new RegExp('/b/' + code.code + '$'));
  }

  const eerste = gemaakt.gegevens.codes[0];
  const gedrukt = await beheerder.patch('/api/codes/' + eerste.code, { status: 'gedrukt' });
  assert.equal(gedrukt.gegevens.code.status, 'gedrukt');
  assert.notEqual(gedrukt.gegevens.code.gedruktOp, '');

  const bak = await beheerder.post('/api/bakken', { naam: 'Garage - kerstspullen' });
  await beheerder.post('/api/bakken/' + bak.gegevens.bak.id + '/items', { naam: 'Kerstballen', aantal: 24 });
  await beheerder.patch('/api/codes/' + eerste.code, { bakId: bak.gegevens.bak.id, status: 'geplakt' });

  // Scannen met precies wat er in de QR staat (de link).
  const gescand = await beheerder.post('/api/scan', { inhoud: eerste.inhoud });
  assert.equal(gescand.status, 200);
  assert.equal(gescand.gegevens.bak.naam, 'Garage - kerstspullen');
  assert.equal(gescand.gegevens.bak.stuks, 24);
  assert.equal(gescand.gegevens.producten.length, 1);

  // En met alleen de losse code, zoals bij handmatige invoer.
  const los = await beheerder.post('/api/scan', { inhoud: eerste.code.toLowerCase() });
  assert.equal(los.status, 200);

  // Een onbekende maar geldige sticker.
  const onbekend = await beheerder.post('/api/scan', { inhoud: 'ABCDE' });
  assert.equal(onbekend.status, 404);

  // En iets dat geen sticker is.
  const onzin = await beheerder.post('/api/scan', { inhoud: 'https://voorbeeld.test/over-ons' });
  assert.equal(onzin.status, 400);
});

test('een gewone gebruiker mag kijken maar niets veranderen, tot de beheerder rechten geeft', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord')).klant;

  const nieuw = await tom.post('/api/gebruikers', { naam: 'Lisa', wachtwoord: 'een-lang-wachtwoord' });
  assert.equal(nieuw.status, 201);
  assert.equal(nieuw.gegevens.gebruiker.rol, 'gebruiker');
  assert.equal(nieuw.gegevens.gebruiker.rechten.bakken_bekijken, true, 'kijken kan iedereen');
  assert.equal(nieuw.gegevens.gebruiker.rechten.bakken_wijzigen, false);

  const ingelogd = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Lisa', wachtwoord: 'een-lang-wachtwoord' }
  });
  const lisa = hulp.klant(omgeving.basis, hulp.koekjeUit(ingelogd.setCookies));

  assert.equal((await lisa.haal('/api/bakken')).status, 200, 'kijken mag');
  const geweigerd = await lisa.post('/api/bakken', { naam: 'Zolder' });
  assert.equal(geweigerd.status, 403);
  assert.match(geweigerd.gegevens.fout, /bakken_wijzigen/);
  assert.equal((await lisa.haal('/api/codes')).status, 403, 'codes beheren is een eigen recht');
  assert.equal((await lisa.haal('/api/gebruikers')).status, 403, 'gebruikersbeheer is voor de beheerder');
  assert.equal((await lisa.haal('/api/versie/controle')).status, 403, 'bijwerken is een eigen recht');

  // De beheerder zet het recht aan: nu mag Lisa wel.
  const rechten = Object.assign({}, nieuw.gegevens.gebruiker.rechten, { bakken_wijzigen: true, codes_beheren: true });
  const gezet = await tom.patch('/api/gebruikers/' + nieuw.gegevens.gebruiker.id, { rechten });
  assert.equal(gezet.status, 200);
  assert.equal((await lisa.post('/api/bakken', { naam: 'Zolder' })).status, 201);
  assert.equal((await lisa.haal('/api/codes')).status, 200);

  // En weer intrekken.
  const terug = Object.assign({}, rechten, { bakken_wijzigen: false, codes_beheren: false });
  await tom.patch('/api/gebruikers/' + nieuw.gegevens.gebruiker.id, { rechten: terug });
  assert.equal((await lisa.post('/api/bakken', { naam: 'Schuur' })).status, 403);
  assert.equal((await lisa.haal('/api/codes')).status, 403);

  // Verwijderen van die gebruiker.
  assert.equal((await tom.del('/api/gebruikers/' + nieuw.gegevens.gebruiker.id)).status, 200);
  assert.equal((await lisa.haal('/api/ik')).status, 401, 'weg is weg, ook de sessie');
});

test('de laatste beheerder raakt zijn rol niet kwijt', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const gedaan = await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord');

  const geprobeerd = await gedaan.klant.patch('/api/gebruikers/' + gedaan.antwoord.gegevens.gebruiker.id, { rol: 'gebruiker' });
  assert.equal(geprobeerd.status, 400);
  assert.match(geprobeerd.gegevens.fout, /laatste beheerder/);
  assert.equal((await gedaan.klant.del('/api/gebruikers/' + gedaan.antwoord.gegevens.gebruiker.id)).status, 400);
});

test('een wachtwoord wijzigen kan, en logt de oude sessies uit', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord')).klant;

  const nieuw = await tom.post('/api/gebruikers', { naam: 'Lisa', wachtwoord: 'een-lang-wachtwoord' });
  const ingelogd = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Lisa', wachtwoord: 'een-lang-wachtwoord' }
  });
  const lisa = hulp.klant(omgeving.basis, hulp.koekjeUit(ingelogd.setCookies));
  assert.equal((await lisa.haal('/api/ik')).status, 200);

  const gezet = await tom.patch('/api/gebruikers/' + nieuw.gegevens.gebruiker.id, { wachtwoord: 'een-nieuw-wachtwoord' });
  assert.equal(gezet.status, 200);
  assert.equal((await lisa.haal('/api/ik')).status, 401, 'een nieuw wachtwoord sluit de oude sessies');
  const opnieuw = await hulp.vraag(omgeving.basis, '/api/inloggen', {
    methode: 'POST', lichaam: { naam: 'Lisa', wachtwoord: 'een-nieuw-wachtwoord' }
  });
  assert.equal(opnieuw.status, 200);
});

test('de afdruk van een wachtwoord komt nergens naar buiten', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis, 'Tom', 'mijn-huis-wachtwoord')).klant;
  const lijst = await tom.haal('/api/gebruikers');
  assert.equal(lijst.status, 200);
  assert.equal(JSON.stringify(lijst.gegevens).includes('scrypt'), false);
  assert.equal(JSON.stringify(lijst.gegevens).includes('afdruk'), false);
  assert.equal(lijst.gegevens.rechten.length > 0, true, 'de rechten met uitleg komen mee voor het scherm');
});

test('het adres voor de QR-links: uit het verzoek, of zoals ingesteld', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis)).klant;

  const gemaakt = await tom.post('/api/codes', { aantal: 1, naam: 'Test' });
  assert.match(gemaakt.gegevens.codes[0].inhoud, new RegExp('^' + omgeving.basis + '/b/'), 'zonder instelling komt het adres uit het verzoek');

  const ingesteld = await tom.patch('/api/instellingen', { basisAdres: 'https://bakken.voorbeeld.test/' });
  assert.equal(ingesteld.status, 200);
  const opnieuw = await tom.post('/api/codes', { aantal: 1, naam: 'Test 2' });
  assert.match(opnieuw.gegevens.codes[0].inhoud, /^https:\/\/bakken\.voorbeeld\.test\/b\//);

  const onzin = await tom.patch('/api/instellingen', { basisAdres: 'niet-eens-een-adres' });
  assert.equal(onzin.status, 400);
});

test('/api/versie vertelt wat hier draait en hoe je bijwerkt', async (t) => {
  const omgeving = await hulp.start();
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis)).klant;

  const versie = await tom.haal('/api/versie');
  assert.equal(versie.status, 200);
  assert.match(versie.gegevens.versie, /^\d+\.\d+\.\d+$/);
  assert.match(versie.gegevens.updateCommando, /raw\.githubusercontent\.com\/Theberas04\/bakken/);
  assert.equal(versie.gegevens.updateMogelijk, false, 'zonder script kan de app niet zelf bijwerken');
});
