'use strict';
// Proeven op zoeken over alles, kast/plank/categorie, de totalen en het logboek.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../lib/db');
const hulp = require('./hulp');

function tijdelijkeDb() {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'bakken-db-'));
  return { map, databank: db.openDatabase(path.join(map, 'p.db')) };
}

test('een bak onthoudt kast, plank en categorie', () => {
  const { map, databank } = tijdelijkeDb();
  try {
    const bak = db.voegBakToe(databank, {
      naam: 'Kerstspullen', kast: 'Garage', plank: '2', categorie: 'Kerst'
    });
    assert.equal(bak.kast, 'Garage');
    assert.equal(bak.plank, '2');
    assert.equal(bak.categorie, 'Kerst');

    const gewijzigd = db.wijzigBak(databank, bak.id, { plank: '3' });
    assert.equal(gewijzigd.plank, '3', 'een plank wijzigen laat de rest staan');
    assert.equal(gewijzigd.kast, 'Garage');
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('een bestaande databank krijgt de nieuwe kolommen erbij', () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'bakken-db-'));
  try {
    // Zo zag de databank van 0.6.0 eruit: geen kast, plank of categorie.
    const { DatabaseSync } = require('node:sqlite');
    const oud = new DatabaseSync(path.join(map, 'p.db'));
    oud.exec(`CREATE TABLE bakken (
      id INTEGER PRIMARY KEY AUTOINCREMENT, naam TEXT NOT NULL,
      locatie TEXT NOT NULL DEFAULT '', omschrijving TEXT NOT NULL DEFAULT '',
      aangemaakt TEXT NOT NULL DEFAULT '', gewijzigd TEXT NOT NULL DEFAULT '');
      INSERT INTO bakken (naam) VALUES ('Oude bak');`);
    oud.close();

    const databank = db.openDatabase(path.join(map, 'p.db'));
    const bak = db.lijstBakken(databank)[0];
    assert.equal(bak.naam, 'Oude bak', 'de bestaande rij blijft staan');
    assert.equal(bak.kast, '', 'de nieuwe kolom begint leeg');
    const bijgewerkt = db.wijzigBak(databank, bak.id, { kast: 'Schuur' });
    assert.equal(bijgewerkt.kast, 'Schuur', 'en is daarna gewoon te vullen');
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('zoeken vindt een product in een andere bak', () => {
  const { map, databank } = tijdelijkeDb();
  try {
    const kerst = db.voegBakToe(databank, { naam: 'Kerstspullen', kast: 'Garage', categorie: 'Kerst' });
    const klus = db.voegBakToe(databank, { naam: 'Gereedschap', kast: 'Schuur' });
    db.voegItemToe(databank, kerst.id, { naam: 'Kerstverlichting', aantal: 4, eenheid: 'doos' });
    db.voegItemToe(databank, klus.id, { naam: 'Boorhamer', aantal: 1 });

    const opProduct = db.zoekAlles(databank, 'boor');
    assert.equal(opProduct.producten.length, 1);
    assert.equal(opProduct.producten[0].product.naam, 'Boorhamer');
    assert.equal(opProduct.producten[0].bak.naam, 'Gereedschap', 'de bak komt mee in het antwoord');
    assert.equal(opProduct.producten[0].bak.kast, 'Schuur');

    const opBak = db.zoekAlles(databank, 'kerst');
    assert.equal(opBak.bakken.length, 1);
    assert.equal(opBak.bakken[0].naam, 'Kerstspullen');
    assert.equal(opBak.producten.length, 1, 'het product in die bak komt ook mee');

    assert.deepEqual(db.zoekAlles(databank, ''), { term: '', bakken: [], producten: [] });
    assert.equal(db.zoekAlles(databank, 'bestaatniet').producten.length, 0);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('zoeken is niet hoofdlettergevoelig en kijkt ook in de kastnaam', () => {
  const { map, databank } = tijdelijkeDb();
  try {
    const bak = db.voegBakToe(databank, { naam: 'Losse rommel', kast: 'Zolder' });
    db.voegItemToe(databank, bak.id, { naam: 'Snoeren' });
    assert.equal(db.zoekAlles(databank, 'ZOLDER').bakken.length, 1);
    assert.equal(db.zoekAlles(databank, 'snoeren').producten.length, 1);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('het overzicht telt en noemt de kasten en categorieen', () => {
  const { map, databank } = tijdelijkeDb();
  try {
    const a = db.voegBakToe(databank, { naam: 'Een', kast: 'Garage', categorie: 'Kerst' });
    const b = db.voegBakToe(databank, { naam: 'Twee', kast: 'Garage', categorie: 'Werk' });
    db.voegBakToe(databank, { naam: 'Drie' });
    db.voegItemToe(databank, a.id, { naam: 'Lamp', aantal: 3 });
    db.voegItemToe(databank, b.id, { naam: 'Tang', aantal: 2 });

    const uit = db.overzicht(databank);
    assert.equal(uit.totalen.bakken, 3);
    assert.equal(uit.totalen.producten, 2);
    assert.equal(uit.totalen.stuks, 5);
    assert.deepEqual(uit.kasten, ['Garage'], 'elke kast maar één keer, lege weggelaten');
    assert.deepEqual(uit.categorieen, ['Kerst', 'Werk']);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('het logboek bewaart wie wat deed, nieuwste eerst', () => {
  const { map, databank } = tijdelijkeDb();
  try {
    db.schrijfLog(databank, { gebruiker: 'Tom', actie: 'bak toegevoegd', onderwerp: 'Kerstspullen' });
    db.schrijfLog(databank, { gebruiker: 'Anna', actie: 'product verwijderd', onderwerp: 'Lamp' });
    const regels = db.lijstLog(databank, 10);
    assert.equal(regels.length, 2);
    assert.equal(regels[0].gebruiker, 'Anna', 'de nieuwste staat bovenaan');
    assert.equal(regels[1].actie, 'bak toegevoegd');
    assert.ok(regels[0].wanneer, 'elk logregel heeft een tijdstip');
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('de routes: zoeken, overzicht en het logboek alleen voor de beheerder', async () => {
  const omgeving = await hulp.start();
  try {
    const { klant: baas } = await hulp.stelIn(omgeving.basis, 'Tom', hulp.WACHTWOORD);

    const bak = await baas.post('/api/bakken', {
      naam: 'Kerstspullen', kast: 'Garage', plank: '2', categorie: 'Kerst'
    });
    assert.equal(bak.status, 201);
    assert.equal(bak.gegevens.bak.kast, 'Garage');
    const bakId = bak.gegevens.bak.id;
    await baas.post('/api/bakken/' + bakId + '/items', { naam: 'Kerstverlichting', aantal: 4 });

    const gezocht = await baas.haal('/api/zoeken?q=kerstverlichting');
    assert.equal(gezocht.status, 200);
    assert.equal(gezocht.gegevens.producten.length, 1);
    assert.equal(gezocht.gegevens.producten[0].bak.naam, 'Kerstspullen');

    const overzicht = await baas.haal('/api/overzicht');
    assert.equal(overzicht.status, 200);
    assert.equal(overzicht.gegevens.totalen.bakken, 1);
    assert.equal(overzicht.gegevens.totalen.producten, 1);
    assert.deepEqual(overzicht.gegevens.kasten, ['Garage']);

    const logboek = await baas.haal('/api/logboek');
    assert.equal(logboek.status, 200);
    const acties = logboek.gegevens.regels.map((r) => r.actie);
    assert.ok(acties.includes('bak toegevoegd'), 'het maken van een bak staat erin');
    assert.ok(acties.includes('product toegevoegd'), 'en het toevoegen van een product');

    // Een gewone gebruiker mag kijken en zoeken, maar het logboek niet zien.
    const nieuw = await baas.post('/api/gebruikers', {
      naam: 'Anna', wachtwoord: 'nog-een-lang-wachtwoord', rol: 'gebruiker'
    });
    assert.equal(nieuw.status, 201);
    const inlog = await hulp.vraag(omgeving.basis, '/api/inloggen', {
      methode: 'POST', lichaam: { naam: 'Anna', wachtwoord: 'nog-een-lang-wachtwoord' }
    });
    const anna = hulp.klant(omgeving.basis, hulp.koekjeUit(inlog.setCookies));
    assert.equal((await anna.haal('/api/zoeken?q=lamp')).status, 200);
    assert.equal((await anna.haal('/api/overzicht')).status, 200);
    assert.equal((await anna.haal('/api/logboek')).status, 403, 'het logboek is van de beheerder');
  } finally {
    await omgeving.stop();
  }
});

test('zonder inloggen geeft zoeken geen gegevens', async () => {
  const omgeving = await hulp.start();
  try {
    await hulp.stelIn(omgeving.basis);
    const zonder = await hulp.vraag(omgeving.basis, '/api/zoeken?q=kerst');
    assert.equal(zonder.status, 401);
    const logboek = await hulp.vraag(omgeving.basis, '/api/logboek');
    assert.equal(logboek.status, 401);
  } finally {
    await omgeving.stop();
  }
});
