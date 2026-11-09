'use strict';
// De opslag. Alles wat de app bewaart staat hier: gebruikers, sessies, bakken,
// producten per bak, codes en foto's.
//
// Eén bestand, geen losse server: node:sqlite (DatabaseSync) zit in Node zelf.
// Geen npm-afhankelijkheden.

const { DatabaseSync } = require('node:sqlite');
const { maakCode, isCode, normaliseer } = require('./codes');
const rechten = require('./rechten');

const CODE_STATUS = ['vrij', 'gedrukt', 'geplakt'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS instellingen (
  sleutel TEXT PRIMARY KEY,
  waarde TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS gebruikers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL UNIQUE,
  rol TEXT NOT NULL DEFAULT 'gebruiker',
  rechten TEXT NOT NULL DEFAULT '{}',
  afdruk TEXT NOT NULL DEFAULT '',
  aangemaakt TEXT NOT NULL DEFAULT '',
  gewijzigd TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessies (
  token TEXT PRIMARY KEY,
  gebruiker_id INTEGER NOT NULL,
  tot INTEGER NOT NULL DEFAULT 0,
  wanneer TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bakken (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL,
  locatie TEXT NOT NULL DEFAULT '',
  omschrijving TEXT NOT NULL DEFAULT '',
  aangemaakt TEXT NOT NULL DEFAULT '',
  gewijzigd TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bak_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bak_id INTEGER NOT NULL,
  naam TEXT NOT NULL,
  aantal REAL NOT NULL DEFAULT 1,
  eenheid TEXT NOT NULL DEFAULT '',
  notitie TEXT NOT NULL DEFAULT '',
  gewijzigd TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS bak_items_bak ON bak_items (bak_id);
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  naam TEXT NOT NULL DEFAULT '',
  bak_id INTEGER,
  status TEXT NOT NULL DEFAULT 'vrij',
  gedrukt_op TEXT NOT NULL DEFAULT '',
  aangemaakt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS codes_bak ON codes (bak_id);
CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bak_id INTEGER NOT NULL,
  bestand TEXT NOT NULL DEFAULT '',
  soort TEXT NOT NULL DEFAULT 'image/jpeg',
  breedte INTEGER NOT NULL DEFAULT 0,
  hoogte INTEGER NOT NULL DEFAULT 0,
  op_server INTEGER NOT NULL DEFAULT 0,
  gemaakt_op TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS fotos_bak ON fotos (bak_id);
`;

function nu() {
  return new Date().toISOString();
}

function openDatabase(pad) {
  const db = new DatabaseSync(pad);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// ----------------------------------------------------------- instellingen ---
// Waar het adres van de app hoort te staan: niet in het repo, wel hier. Zonder
// eigen instelling gebruikt de app het adres van het verzoek zelf.
function leesInstelling(db, sleutel, standaard) {
  const rij = db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(String(sleutel));
  if (!rij || rij.waarde === '') return standaard === undefined ? '' : standaard;
  return String(rij.waarde);
}

function zetInstelling(db, sleutel, waarde) {
  db.prepare('INSERT INTO instellingen (sleutel, waarde) VALUES (?, ?) ' +
    'ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde').run(String(sleutel), String(waarde == null ? '' : waarde));
  return leesInstelling(db, sleutel, '');
}

// ------------------------------------------------------------- gebruikers ---
function schoonNaam(naam) {
  return String(naam == null ? '' : naam).trim();
}

function rijNaarGebruiker(rij) {
  if (!rij) return null;
  let gestopt = {};
  try {
    gestopt = JSON.parse(rij.rechten || '{}');
  } catch (e) {
    gestopt = {};
  }
  return {
    id: rij.id,
    naam: rij.naam,
    rol: rij.rol,
    rechten: rechten.schoonRechten(rij.rol, gestopt),
    afdruk: rij.afdruk,
    aangemaakt: rij.aangemaakt,
    gewijzigd: rij.gewijzigd
  };
}

function zonderAfdruk(gebruiker) {
  if (!gebruiker) return null;
  const { afdruk, ...rest } = gebruiker;
  return rest;
}

function voegGebruikerToe(db, gegevens) {
  const g = gegevens || {};
  const naam = schoonNaam(g.naam);
  if (!naam) throw new Error('Een gebruikersnaam is verplicht');
  const rol = rechten.isRol(g.rol) ? g.rol : 'gebruiker';
  const bestaand = zoekGebruikerOpNaam(db, naam);
  if (bestaand) throw new Error('Die gebruikersnaam bestaat al');
  const afdruk = g.afdruk || '';
  const tijd = nu();
  const uitkomst = db.prepare(
    'INSERT INTO gebruikers (naam, rol, rechten, afdruk, aangemaakt, gewijzigd) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(naam, rol, JSON.stringify(rechten.schoonRechten(rol, g.rechten)), afdruk, tijd, tijd);
  return haalGebruiker(db, Number(uitkomst.lastInsertRowid));
}

function haalGebruiker(db, id) {
  return rijNaarGebruiker(db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(Number(id)));
}

function zoekGebruikerOpNaam(db, naam) {
  const schoon = schoonNaam(naam);
  if (!schoon) return null;
  // Bewust niet hoofdlettergevoelig: "tom" en "Tom" zijn dezelfde persoon.
  return rijNaarGebruiker(
    db.prepare('SELECT * FROM gebruikers WHERE lower(naam) = lower(?)').get(schoon)
  );
}

function lijstGebruikers(db) {
  return db.prepare('SELECT * FROM gebruikers ORDER BY naam COLLATE NOCASE').all().map(rijNaarGebruiker);
}

function telBeheerders(db) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM gebruikers WHERE rol = 'beheerder'").get().n);
}

function zetRolEnRechten(db, id, rol, nieuweRechten) {
  const gebruiker = haalGebruiker(db, id);
  if (!gebruiker) throw new Error('Deze gebruiker bestaat niet');
  const nieuweRol = rechten.isRol(rol) ? rol : gebruiker.rol;
  if (gebruiker.rol === 'beheerder' && nieuweRol !== 'beheerder' && laatsteBeheerder(db, id)) {
    throw new Error('De laatste beheerder kan zijn beheerdersrol niet kwijtraken');
  }
  db.prepare('UPDATE gebruikers SET rol = ?, rechten = ?, gewijzigd = ? WHERE id = ?')
    .run(nieuweRol, JSON.stringify(rechten.schoonRechten(nieuweRol, nieuweRechten)), nu(), Number(id));
  return haalGebruiker(db, id);
}

function zetWachtwoord(db, id, afdruk) {
  if (!afdruk) throw new Error('Een wachtwoordafdruk is verplicht');
  const uitkomst = db.prepare('UPDATE gebruikers SET afdruk = ?, gewijzigd = ? WHERE id = ?')
    .run(afdruk, nu(), Number(id));
  if (!uitkomst.changes) throw new Error('Deze gebruiker bestaat niet');
  // Wie zijn wachtwoord wijzigt, gooit de openstaande sessies van die gebruiker dicht.
  db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(Number(id));
  return haalGebruiker(db, id);
}

function laatsteBeheerder(db, id) {
  const gebruiker = haalGebruiker(db, id);
  if (!gebruiker || gebruiker.rol !== 'beheerder') return false;
  return rechten.laatsteBeheerder(lijstGebruikers(db), id);
}

function verwijderGebruiker(db, id) {
  const gebruiker = haalGebruiker(db, id);
  if (!gebruiker) throw new Error('Deze gebruiker bestaat niet');
  if (laatsteBeheerder(db, id)) throw new Error('De laatste beheerder kan niet verwijderd worden');
  db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(Number(id));
  db.prepare('DELETE FROM gebruikers WHERE id = ?').run(Number(id));
  return true;
}

// ---------------------------------------------------------------- sessies ---
function bewaarSessie(db, token, gebruikerId, dagen) {
  const tot = Date.now() + Math.round((dagen || 30) * 86400000);
  db.prepare('INSERT OR REPLACE INTO sessies (token, gebruiker_id, tot, wanneer) VALUES (?, ?, ?, ?)')
    .run(String(token), Number(gebruikerId), tot, nu());
  db.prepare('DELETE FROM sessies WHERE tot < ?').run(Date.now());
  return tot;
}

function gebruikerBijToken(db, token) {
  if (!token) return null;
  const rij = db.prepare('SELECT * FROM sessies WHERE token = ?').get(String(token));
  if (!rij) return null;
  if (Number(rij.tot) < Date.now()) {
    db.prepare('DELETE FROM sessies WHERE token = ?').run(String(token));
    return null;
  }
  return haalGebruiker(db, rij.gebruiker_id);
}

function verwijderSessie(db, token) {
  if (!token) return false;
  return db.prepare('DELETE FROM sessies WHERE token = ?').run(String(token)).changes > 0;
}

// ----------------------------------------------------------------- bakken ---
function rijNaarBak(rij) {
  if (!rij) return null;
  return {
    id: rij.id,
    naam: rij.naam,
    locatie: rij.locatie,
    omschrijving: rij.omschrijving,
    aangemaakt: rij.aangemaakt,
    gewijzigd: rij.gewijzigd,
    producten: rij.producten == null ? 0 : Number(rij.producten),
    stuks: rij.stuks == null ? 0 : Number(rij.stuks),
    fotos: rij.fotos == null ? 0 : Number(rij.fotos),
    codes: rij.codes == null ? 0 : Number(rij.codes)
  };
}

const BAK_QUERY = `
  SELECT b.*,
         (SELECT COUNT(*) FROM bak_items i WHERE i.bak_id = b.id) AS producten,
         (SELECT COALESCE(SUM(i.aantal), 0) FROM bak_items i WHERE i.bak_id = b.id) AS stuks,
         (SELECT COUNT(*) FROM fotos f WHERE f.bak_id = b.id) AS fotos,
         (SELECT COUNT(*) FROM codes c WHERE c.bak_id = b.id) AS codes
    FROM bakken b
`;

function voegBakToe(db, gegevens) {
  const g = gegevens || {};
  const naam = schoonNaam(g.naam);
  if (!naam) throw new Error('Een naam voor de bak is verplicht');
  const tijd = nu();
  const uitkomst = db.prepare(
    'INSERT INTO bakken (naam, locatie, omschrijving, aangemaakt, gewijzigd) VALUES (?, ?, ?, ?, ?)'
  ).run(naam, schoonNaam(g.locatie), String(g.omschrijving || ''), tijd, tijd);
  return haalBak(db, Number(uitkomst.lastInsertRowid));
}

function haalBak(db, id) {
  return rijNaarBak(db.prepare(BAK_QUERY + ' WHERE b.id = ?').get(Number(id)));
}

function lijstBakken(db) {
  return db.prepare(BAK_QUERY + ' ORDER BY b.naam COLLATE NOCASE').all().map(rijNaarBak);
}

function wijzigBak(db, id, gegevens) {
  const bak = haalBak(db, id);
  if (!bak) throw new Error('Deze bak bestaat niet');
  const g = gegevens || {};
  const naam = g.naam == null ? bak.naam : schoonNaam(g.naam);
  if (!naam) throw new Error('Een naam voor de bak is verplicht');
  db.prepare('UPDATE bakken SET naam = ?, locatie = ?, omschrijving = ?, gewijzigd = ? WHERE id = ?')
    .run(naam,
      g.locatie == null ? bak.locatie : schoonNaam(g.locatie),
      g.omschrijving == null ? bak.omschrijving : String(g.omschrijving),
      nu(), Number(id));
  return haalBak(db, id);
}

function verwijderBak(db, id) {
  const bak = haalBak(db, id);
  if (!bak) throw new Error('Deze bak bestaat niet');
  db.prepare('DELETE FROM bak_items WHERE bak_id = ?').run(Number(id));
  db.prepare('DELETE FROM fotos WHERE bak_id = ?').run(Number(id));
  // De codes blijven bestaan, maar raken los: je kunt ze opnieuw opplakken.
  db.prepare('UPDATE codes SET bak_id = NULL WHERE bak_id = ?').run(Number(id));
  db.prepare('DELETE FROM bakken WHERE id = ?').run(Number(id));
  return true;
}

function voorraadVanBak(db, bakId) {
  const rij = db.prepare(
    'SELECT COUNT(*) AS producten, COALESCE(SUM(aantal), 0) AS stuks FROM bak_items WHERE bak_id = ?'
  ).get(Number(bakId));
  return { producten: Number(rij.producten), stuks: Number(rij.stuks) };
}

// --------------------------------------------------------------- producten ---
function schoonAantal(aantal) {
  if (aantal == null || aantal === '') return 1;
  const n = Number(String(aantal).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('Een aantal moet een getal van 0 of hoger zijn');
  return n;
}

function rijNaarItem(rij) {
  if (!rij) return null;
  return {
    id: rij.id,
    bakId: rij.bak_id,
    naam: rij.naam,
    aantal: Number(rij.aantal),
    eenheid: rij.eenheid,
    notitie: rij.notitie,
    gewijzigd: rij.gewijzigd
  };
}

function voegItemToe(db, bakId, gegevens) {
  const bak = haalBak(db, bakId);
  if (!bak) throw new Error('Deze bak bestaat niet');
  const g = gegevens || {};
  const naam = schoonNaam(g.naam);
  if (!naam) throw new Error('Een naam voor het product is verplicht');
  const uitkomst = db.prepare(
    'INSERT INTO bak_items (bak_id, naam, aantal, eenheid, notitie, gewijzigd) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(Number(bakId), naam, schoonAantal(g.aantal), schoonNaam(g.eenheid), String(g.notitie || ''), nu());
  return rijNaarItem(db.prepare('SELECT * FROM bak_items WHERE id = ?').get(Number(uitkomst.lastInsertRowid)));
}

function wijzigItem(db, id, gegevens) {
  const item = rijNaarItem(db.prepare('SELECT * FROM bak_items WHERE id = ?').get(Number(id)));
  if (!item) throw new Error('Dit product bestaat niet');
  const g = gegevens || {};
  const naam = g.naam == null ? item.naam : schoonNaam(g.naam);
  if (!naam) throw new Error('Een naam voor het product is verplicht');
  db.prepare('UPDATE bak_items SET naam = ?, aantal = ?, eenheid = ?, notitie = ?, gewijzigd = ? WHERE id = ?')
    .run(naam,
      g.aantal == null ? item.aantal : schoonAantal(g.aantal),
      g.eenheid == null ? item.eenheid : schoonNaam(g.eenheid),
      g.notitie == null ? item.notitie : String(g.notitie),
      nu(), Number(id));
  db.prepare('UPDATE bakken SET gewijzigd = ? WHERE id = ?').run(nu(), item.bakId);
  return rijNaarItem(db.prepare('SELECT * FROM bak_items WHERE id = ?').get(Number(id)));
}

// Voor de + en - op het scherm en voor "er is één pak rijst uit de bak gegaan".
function telItemBij(db, id, verschil) {
  const item = rijNaarItem(db.prepare('SELECT * FROM bak_items WHERE id = ?').get(Number(id)));
  if (!item) throw new Error('Dit product bestaat niet');
  return wijzigItem(db, id, { aantal: Math.max(0, item.aantal + Number(verschil || 0)) });
}

function verwijderItem(db, id) {
  const item = rijNaarItem(db.prepare('SELECT * FROM bak_items WHERE id = ?').get(Number(id)));
  if (!item) throw new Error('Dit product bestaat niet');
  db.prepare('DELETE FROM bak_items WHERE id = ?').run(Number(id));
  return true;
}

function lijstItems(db, bakId) {
  return db.prepare('SELECT * FROM bak_items WHERE bak_id = ? ORDER BY naam COLLATE NOCASE')
    .all(Number(bakId)).map(rijNaarItem);
}

// ------------------------------------------------------------------ codes ---
function rijNaarCode(rij) {
  if (!rij) return null;
  return {
    code: rij.code,
    naam: rij.naam,
    bakId: rij.bak_id == null ? null : Number(rij.bak_id),
    status: rij.status,
    gedruktOp: rij.gedrukt_op,
    aangemaakt: rij.aangemaakt
  };
}

// Een code krijgt meteen de naam die de gebruiker hem geeft, zodat hij in het
// register terug te vinden is ("Garage - kerstspullen").
function registreerCode(db, gegevens) {
  const g = typeof gegevens === 'string' ? { code: gegevens } : (gegevens || {});
  const code = normaliseer(g.code);
  if (!isCode(code)) throw new Error('Geen geldige code: ' + g.code);
  const bestaat = db.prepare('SELECT code FROM codes WHERE code = ?').get(code);
  if (bestaat) throw new Error('Deze code bestaat al');
  db.prepare('INSERT INTO codes (code, naam, bak_id, status, gedrukt_op, aangemaakt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(code, schoonNaam(g.naam), g.bakId == null ? null : Number(g.bakId), 'vrij', '', nu());
  return haalCode(db, code);
}

function haalCode(db, code) {
  return rijNaarCode(db.prepare('SELECT * FROM codes WHERE code = ?').get(normaliseer(code)));
}

function lijstCodes(db) {
  return db.prepare(`SELECT c.*, b.naam AS bak_naam FROM codes c
                     LEFT JOIN bakken b ON b.id = c.bak_id
                     ORDER BY c.naam COLLATE NOCASE, c.code`).all().map((rij) => {
    const uit = rijNaarCode(rij);
    uit.bakNaam = rij.bak_naam || '';
    return uit;
  });
}

// Nieuwe codes in één keer, met een naam vooraf (bijvoorbeeld het printvel).
function maakCodes(db, aantal, naam) {
  const n = Math.max(1, Math.min(500, Number(aantal) || 1));
  const bestaande = db.prepare('SELECT code FROM codes').all().map((rij) => rij.code);
  const uit = [];
  for (let i = 0; i < n; i += 1) {
    const code = maakCode(bestaande.concat(uit.map((c) => c.code)));
    uit.push(registreerCode(db, { code, naam }));
  }
  return uit;
}

function wijzigCode(db, code, gegevens) {
  const c = haalCode(db, code);
  if (!c) throw new Error('Deze code bestaat niet');
  const g = gegevens || {};
  const naam = g.naam == null ? c.naam : schoonNaam(g.naam);
  let status = g.status == null ? c.status : String(g.status);
  if (!CODE_STATUS.includes(status)) throw new Error('Onbekende status: ' + g.status);
  let bakId = c.bakId;
  if (g.bakId !== undefined) bakId = g.bakId == null || g.bakId === '' ? null : Number(g.bakId);
  let gedruktOp = g.gedruktOp == null ? c.gedruktOp : String(g.gedruktOp);
  if (status === 'gedrukt' && !gedruktOp) gedruktOp = nu();
  if (status === 'vrij') gedruktOp = '';
  db.prepare('UPDATE codes SET naam = ?, bak_id = ?, status = ?, gedrukt_op = ? WHERE code = ?')
    .run(naam, bakId, status, gedruktOp, c.code);
  return haalCode(db, c.code);
}

function koppelCode(db, code, bakId) {
  if (bakId != null && bakId !== '' && !haalBak(db, bakId)) throw new Error('Die bak bestaat niet');
  return wijzigCode(db, code, { bakId: bakId == null || bakId === '' ? null : Number(bakId) });
}

function verwijderCode(db, code) {
  const c = haalCode(db, code);
  if (!c) throw new Error('Deze code bestaat niet');
  db.prepare('DELETE FROM codes WHERE code = ?').run(c.code);
  return true;
}

// Wat de scanner opzoekt: de code uit de QR, en welke bak eraan hangt.
function bakBijCode(db, code) {
  const c = haalCode(db, code);
  if (!c) return null;
  return { code: c, bak: c.bakId == null ? null : haalBak(db, c.bakId) };
}

// ------------------------------------------------------------------ foto's ---
function rijNaarFoto(rij) {
  if (!rij) return null;
  return {
    id: rij.id,
    bakId: rij.bak_id,
    bestand: rij.bestand,
    soort: rij.soort,
    breedte: Number(rij.breedte),
    hoogte: Number(rij.hoogte),
    opServer: Number(rij.op_server) === 1,
    gemaaktOp: rij.gemaakt_op
  };
}

function voegFotoToe(db, bakId, gegevens) {
  const bak = haalBak(db, bakId);
  if (!bak) throw new Error('Deze bak bestaat niet');
  const g = gegevens || {};
  if (!schoonNaam(g.bestand)) throw new Error('Een bestandsnaam is verplicht');
  const uitkomst = db.prepare(
    `INSERT INTO fotos (bak_id, bestand, soort, breedte, hoogte, op_server, gemaakt_op)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(bakId), schoonNaam(g.bestand), schoonNaam(g.soort) || 'image/jpeg',
    Number(g.breedte) || 0, Number(g.hoogte) || 0, g.opServer ? 1 : 0, nu());
  return rijNaarFoto(db.prepare('SELECT * FROM fotos WHERE id = ?').get(Number(uitkomst.lastInsertRowid)));
}

function markeerFotoOpServer(db, id) {
  const uitkomst = db.prepare('UPDATE fotos SET op_server = 1 WHERE id = ?').run(Number(id));
  if (!uitkomst.changes) throw new Error('Deze foto bestaat niet');
  return rijNaarFoto(db.prepare('SELECT * FROM fotos WHERE id = ?').get(Number(id)));
}

function lijstFotos(db, bakId) {
  return db.prepare('SELECT * FROM fotos WHERE bak_id = ? ORDER BY id').all(Number(bakId)).map(rijNaarFoto);
}

function verwijderFoto(db, id) {
  const foto = rijNaarFoto(db.prepare('SELECT * FROM fotos WHERE id = ?').get(Number(id)));
  if (!foto) throw new Error('Deze foto bestaat niet');
  db.prepare('DELETE FROM fotos WHERE id = ?').run(Number(id));
  return foto;
}

module.exports = {
  CODE_STATUS,
  openDatabase,
  nu,
  zonderAfdruk,
  // instellingen
  leesInstelling,
  zetInstelling,
  // gebruikers
  voegGebruikerToe,
  haalGebruiker,
  zoekGebruikerOpNaam,
  lijstGebruikers,
  telBeheerders,
  zetRolEnRechten,
  zetWachtwoord,
  verwijderGebruiker,
  // sessies
  bewaarSessie,
  gebruikerBijToken,
  verwijderSessie,
  // bakken
  voegBakToe,
  haalBak,
  lijstBakken,
  wijzigBak,
  verwijderBak,
  voorraadVanBak,
  // producten
  voegItemToe,
  wijzigItem,
  telItemBij,
  verwijderItem,
  lijstItems,
  // codes
  registreerCode,
  haalCode,
  lijstCodes,
  maakCodes,
  wijzigCode,
  koppelCode,
  verwijderCode,
  bakBijCode,
  // foto's
  voegFotoToe,
  markeerFotoOpServer,
  lijstFotos,
  verwijderFoto
};
