'use strict';
const test = require('node:test');
const assert = require('node:assert');

const db = require('../lib/db');
const { maakAfdruk, nieuwToken } = require('../lib/accounts');

function verseDb() {
  return db.openDatabase(':memory:');
}

test('een gebruiker toevoegen, met een dubbele naam geweigerd', () => {
  const d = verseDb();
  const tom = db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder', afdruk: maakAfdruk('wachtwoord-1') });
  assert.equal(tom.id > 0, true);
  assert.equal(tom.rol, 'beheerder');
  assert.equal(tom.rechten.bijwerken, true, 'een beheerder heeft alles');
  assert.throws(() => db.voegGebruikerToe(d, { naam: '  tom  ' }), /bestaat al/);
  assert.throws(() => db.voegGebruikerToe(d, { naam: '   ' }), /verplicht/);
});

test('de afdruk gaat nooit naar buiten, ook niet via zonderAfdruk', () => {
  const d = verseDb();
  db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder', afdruk: maakAfdruk('wachtwoord-1') });
  const tom = db.zoekGebruikerOpNaam(d, 'tom');
  assert.equal(typeof tom.afdruk, 'string');
  assert.equal('afdruk' in db.zonderAfdruk(tom), false);
  assert.equal(db.zonderAfdruk(tom).naam, 'Tom');
});

test('rechten toekennen en intrekken', () => {
  const d = verseDb();
  const tom = db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder' });
  const lisa = db.voegGebruikerToe(d, { naam: 'Lisa' });
  const na = db.zetRolEnRechten(d, lisa.id, 'gebruiker', { bakken_wijzigen: true, codes_beheren: true });
  assert.equal(na.rechten.bakken_wijzigen, true);
  assert.equal(na.rechten.codes_beheren, true);
  assert.equal(na.rechten.bakken_verwijderen, false);
  const terug = db.zetRolEnRechten(d, lisa.id, 'gebruiker', { bakken_wijzigen: true });
  assert.equal(terug.rechten.codes_beheren, false, 'een recht intrekken werkt');
  assert.equal(db.telBeheerders(d), 1);
  assert.equal(tom.rol, 'beheerder');
});

test('een gewone gebruiker kan beheerder gemaakt worden en weer terug', () => {
  const d = verseDb();
  db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder' });
  const lisa = db.voegGebruikerToe(d, { naam: 'Lisa' });
  assert.equal(db.zetRolEnRechten(d, lisa.id, 'beheerder', {}).rol, 'beheerder');
  assert.equal(db.telBeheerders(d), 2);
  assert.equal(db.zetRolEnRechten(d, lisa.id, 'gebruiker', {}).rol, 'gebruiker');
  assert.equal(db.telBeheerders(d), 1);
});

test('de laatste beheerder kan niet gedegradeerd of verwijderd worden', () => {
  const d = verseDb();
  const tom = db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder' });
  assert.throws(() => db.zetRolEnRechten(d, tom.id, 'gebruiker', {}), /laatste beheerder/);
  assert.throws(() => db.verwijderGebruiker(d, tom.id), /laatste beheerder/);
  const lisa = db.voegGebruikerToe(d, { naam: 'Lisa', rol: 'beheerder' });
  // Met twee beheerders mag Tom zichzelf terugzetten naar gewone gebruiker...
  assert.equal(db.zetRolEnRechten(d, tom.id, 'gebruiker', {}).rol, 'gebruiker');
  // ...en is Lisa nu de laatste: die mag er niet meer uit.
  assert.equal(db.telBeheerders(d), 1);
  assert.throws(() => db.verwijderGebruiker(d, lisa.id), /laatste beheerder/);
  assert.throws(() => db.zetRolEnRechten(d, lisa.id, 'gebruiker', {}), /laatste beheerder/);
  // Een gewone gebruiker verwijderen kan wel.
  assert.equal(db.verwijderGebruiker(d, tom.id), true);
  assert.equal(db.haalGebruiker(d, tom.id), null);
});

test('een nieuw wachtwoord gooit de openstaande sessies van die gebruiker dicht', () => {
  const d = verseDb();
  const tom = db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder', afdruk: maakAfdruk('wachtwoord-1') });
  const token = nieuwToken();
  db.bewaarSessie(d, token, tom.id, 30);
  assert.equal(db.gebruikerBijToken(d, token).id, tom.id);
  db.zetWachtwoord(d, tom.id, maakAfdruk('ander-wachtwoord-2'));
  assert.equal(db.gebruikerBijToken(d, token), null);
});

test('sessies: bewaren, lezen, verlopen en wissen', () => {
  const d = verseDb();
  const tom = db.voegGebruikerToe(d, { naam: 'Tom', rol: 'beheerder' });
  const token = nieuwToken();
  db.bewaarSessie(d, token, tom.id, 30);
  assert.equal(db.gebruikerBijToken(d, token).naam, 'Tom');
  assert.equal(db.gebruikerBijToken(d, nieuwToken()), null);
  assert.equal(db.gebruikerBijToken(d, ''), null);
  const verlopen = nieuwToken();
  db.bewaarSessie(d, verlopen, tom.id, -1);
  assert.equal(db.gebruikerBijToken(d, verlopen), null, 'een verlopen sessie telt niet meer');
  assert.equal(db.verwijderSessie(d, token), true);
  assert.equal(db.gebruikerBijToken(d, token), null);
});

test('een bak met producten: de voorraad per bak wordt opgeteld', () => {
  const d = verseDb();
  const garage = db.voegBakToe(d, { naam: 'Garage - kerstspullen', locatie: 'Garage, rek 2' });
  db.voegItemToe(d, garage.id, { naam: 'Kerstballen', aantal: 24, eenheid: 'stuks' });
  db.voegItemToe(d, garage.id, { naam: 'Lichtsnoer', aantal: 3 });
  db.voegItemToe(d, garage.id, { naam: 'Boom', aantal: 1 });
  assert.deepEqual(db.voorraadVanBak(d, garage.id), { producten: 3, stuks: 28 });
  const uitLijst = db.lijstBakken(d)[0];
  assert.equal(uitLijst.naam, 'Garage - kerstspullen');
  assert.equal(uitLijst.producten, 3);
  assert.equal(uitLijst.stuks, 28);
  assert.equal(uitLijst.fotos, 0);
  assert.equal(uitLijst.codes, 0);
});

test('een bak zonder producten telt nul', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Zolder' });
  assert.deepEqual(db.voorraadVanBak(d, bak.id), { producten: 0, stuks: 0 });
});

test('aantallen: kommagetallen met een komma, en nooit onder nul', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Voorraadkast' });
  const rijst = db.voegItemToe(d, bak.id, { naam: 'Rijst', aantal: '2,5', eenheid: 'kg' });
  assert.equal(rijst.aantal, 2.5);
  assert.equal(db.telItemBij(d, rijst.id, -1).aantal, 1.5);
  assert.equal(db.telItemBij(d, rijst.id, -10).aantal, 0, 'onder nul gaat niet');
  assert.throws(() => db.voegItemToe(d, bak.id, { naam: 'Iets', aantal: 'veel' }), /getal/);
  assert.throws(() => db.voegItemToe(d, bak.id, { naam: '  ' }), /verplicht/);
});

test('een product wijzigen raakt de wijzigdatum van de bak', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Schuur' });
  const item = db.voegItemToe(d, bak.id, { naam: 'Schroeven', aantal: 100 });
  d.prepare("UPDATE bakken SET gewijzigd = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(bak.id);
  db.wijzigItem(d, item.id, { aantal: 80 });
  assert.notEqual(db.haalBak(d, bak.id).gewijzigd, '2000-01-01T00:00:00.000Z');
  assert.equal(db.lijstItems(d, bak.id).length, 1);
});

test('een product verwijderen', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Schuur' });
  const item = db.voegItemToe(d, bak.id, { naam: 'Schroeven' });
  assert.equal(db.verwijderItem(d, item.id), true);
  assert.equal(db.lijstItems(d, bak.id).length, 0);
  assert.throws(() => db.verwijderItem(d, item.id), /bestaat niet/);
});

test('producten toevoegen aan een bak die niet bestaat wordt geweigerd', () => {
  const d = verseDb();
  assert.throws(() => db.voegItemToe(d, 999, { naam: 'Iets' }), /bak bestaat niet/);
});

test('codes aanmaken met een naam erbij, uniek en geldig', () => {
  const d = verseDb();
  const nieuw = db.maakCodes(d, 48, 'Kerstspullen');
  assert.equal(nieuw.length, 48);
  assert.equal(new Set(nieuw.map((c) => c.code)).size, 48, 'alle codes zijn uniek');
  for (const c of nieuw) {
    assert.equal(c.naam, 'Kerstspullen');
    assert.equal(c.status, 'vrij');
    assert.equal(c.bakId, null);
    assert.equal(c.gedruktOp, '');
  }
  assert.equal(db.lijstCodes(d).length, 48);
});

test('een code krijgt de naam die de gebruiker hem geeft en kan van status wisselen', () => {
  const d = verseDb();
  const [code] = db.maakCodes(d, 1, 'Garage - kerstspullen');
  const gedrukt = db.wijzigCode(d, code.code, { status: 'gedrukt' });
  assert.equal(gedrukt.status, 'gedrukt');
  assert.equal(gedrukt.gedruktOp.length > 0, true, 'de printdatum wordt gezet');
  const geplakt = db.wijzigCode(d, code.code, { status: 'geplakt' });
  assert.equal(geplakt.status, 'geplakt');
  const vrij = db.wijzigCode(d, code.code, { status: 'vrij' });
  assert.equal(vrij.gedruktOp, '', 'een vrije code heeft geen printdatum');
  assert.throws(() => db.wijzigCode(d, code.code, { status: 'kwijt' }), /Onbekende status/);
  assert.throws(() => db.wijzigCode(d, 'ZZZZZ', { status: 'vrij' }), /bestaat niet/);
});

test('een dubbele code wordt geweigerd, ook in kleine letters', () => {
  const d = verseDb();
  const [code] = db.maakCodes(d, 1, 'Test');
  assert.throws(() => db.registreerCode(d, code.code.toLowerCase()), /bestaat al/);
  assert.throws(() => db.registreerCode(d, { code: 'ABC' }), /geldige code/);
});

test('een code aan een bak koppelen: de scanner vindt de bak erbij', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Garage - kerstspullen' });
  db.voegItemToe(d, bak.id, { naam: 'Kerstballen', aantal: 24 });
  const [code] = db.maakCodes(d, 1, 'Garage - kerstspullen');
  assert.equal(db.bakBijCode(d, code.code).bak, null, 'nog niet gekoppeld');
  db.koppelCode(d, code.code, bak.id);
  const gevonden = db.bakBijCode(d, code.code);
  assert.equal(gevonden.bak.id, bak.id);
  assert.equal(gevonden.bak.stuks, 24, 'de scanner ziet meteen de voorraad');
  assert.equal(db.lijstCodes(d)[0].bakNaam, 'Garage - kerstspullen');
  db.koppelCode(d, code.code, null);
  assert.equal(db.haalCode(d, code.code).bakId, null);
  assert.throws(() => db.koppelCode(d, code.code, 999), /bak bestaat niet/);
});

test('een code koppelen aan een onbekende bak wordt geweigerd', () => {
  const d = verseDb();
  const [code] = db.maakCodes(d, 1, 'Test');
  assert.throws(() => db.koppelCode(d, code.code, 42), /bestaat niet/);
});

test('een bak verwijderen laat de codes los maar wist de stickers niet', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Zolder' });
  db.voegItemToe(d, bak.id, { naam: 'Dozen', aantal: 6 });
  const [code] = db.maakCodes(d, 1, 'Zolder');
  db.koppelCode(d, code.code, bak.id);
  db.verwijderBak(d, bak.id);
  assert.equal(db.haalBak(d, bak.id), null);
  assert.equal(db.lijstItems(d, bak.id).length, 0);
  const over = db.haalCode(d, code.code);
  assert.notEqual(over, null, 'de code blijft bestaan');
  assert.equal(over.bakId, null, 'en raakt los');
  assert.equal(db.verwijderCode(d, code.code), true);
});

test("foto's van de inhoud: toevoegen, tellen en markeren als ze op de server staan", () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Garage' });
  const foto = db.voegFotoToe(d, bak.id, { bestand: 'garage-1.jpg', breedte: 1600, hoogte: 1200 });
  assert.equal(foto.opServer, false, 'nog niet geback-upt');
  assert.equal(db.lijstBakken(d)[0].fotos, 1);
  assert.equal(db.markeerFotoOpServer(d, foto.id).opServer, true);
  assert.equal(db.lijstFotos(d, bak.id).length, 1);
  assert.throws(() => db.voegFotoToe(d, bak.id, { bestand: '' }), /bestandsnaam/);
  assert.throws(() => db.voegFotoToe(d, 999, { bestand: 'x.jpg' }), /bak bestaat niet/);
  assert.equal(db.verwijderFoto(d, foto.id).bestand, 'garage-1.jpg');
  assert.equal(db.lijstFotos(d, bak.id).length, 0);
});

test('een bak verwijderen wist de foto-rijen mee', () => {
  const d = verseDb();
  const bak = db.voegBakToe(d, { naam: 'Garage' });
  db.voegFotoToe(d, bak.id, { bestand: 'a.jpg' });
  db.verwijderBak(d, bak.id);
  assert.equal(db.lijstFotos(d, bak.id).length, 0);
});
