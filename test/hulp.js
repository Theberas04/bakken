'use strict';
// Hulpjes voor de proeven: een eigen server op een vrije poort, een eigen
// gegevensmap, en een klein klantje dat het sessiekoekje onthoudt.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { maakApp } = require('../server');

const WACHTWOORD = 'een-lang-wachtwoord';

async function start(opties) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'bakken-proef-'));
  const app = maakApp(Object.assign({
    dataDir: map,
    // Bewust niets bereikbaars: proeven mogen nooit het internet op.
    versieBron: 'http://127.0.0.1:9/VERSIE.json'
  }, opties || {}));
  await new Promise((klaar) => app.server.listen(0, '127.0.0.1', klaar));
  const basis = 'http://127.0.0.1:' + app.server.address().port;
  return {
    app,
    basis,
    map,
    async stop() {
      await new Promise((klaar) => app.server.close(klaar));
      app.stop();
      try {
        fs.rmSync(map, { recursive: true, force: true });
      } catch (e) { /* al weg */ }
    }
  };
}

async function vraag(basis, pad, opties) {
  const o = opties || {};
  const koppen = Object.assign({}, o.koppen || {});
  let lichaam;
  if (o.lichaam !== undefined) {
    koppen['content-type'] = 'application/json';
    lichaam = JSON.stringify(o.lichaam);
  }
  const antwoord = await fetch(basis + pad, { method: o.methode || 'GET', headers: koppen, body: lichaam });
  const tekst = await antwoord.text();
  let gegevens = null;
  try {
    gegevens = JSON.parse(tekst);
  } catch (e) { /* geen json: de tekst blijft beschikbaar */ }
  const alle = typeof antwoord.headers.getSetCookie === 'function'
    ? antwoord.headers.getSetCookie()
    : [antwoord.headers.get('set-cookie')].filter(Boolean);
  return { status: antwoord.status, gegevens, tekst, koppen: antwoord.headers, setCookies: alle };
}

// Uit "bakken=abc; HttpOnly; ..." alleen het stukje dat je terug moet sturen.
function koekjeUit(setCookies) {
  const eerste = (setCookies || [])[0] || '';
  const stuk = eerste.split(';')[0].trim();
  return stuk.includes('=') ? stuk : '';
}

function klant(basis, koekje) {
  const metKoekje = (extra) => Object.assign({}, extra || {}, koekje ? { cookie: koekje } : {});
  return {
    haal: (pad, extra) => vraag(basis, pad, { koppen: metKoekje(extra) }),
    post: (pad, lichaam, extra) => vraag(basis, pad, { methode: 'POST', lichaam, koppen: metKoekje(extra) }),
    patch: (pad, lichaam, extra) => vraag(basis, pad, { methode: 'PATCH', lichaam, koppen: metKoekje(extra) }),
    del: (pad, extra) => vraag(basis, pad, { methode: 'DELETE', koppen: metKoekje(extra) })
  };
}

// De app voor het eerst instellen en meteen de beheerder zijn.
async function stelIn(basis, naam, wachtwoord) {
  const antwoord = await vraag(basis, '/api/instellen', {
    methode: 'POST',
    lichaam: { naam: naam || 'Tom', wachtwoord: wachtwoord || WACHTWOORD }
  });
  return { antwoord, koekje: koekjeUit(antwoord.setCookies), klant: klant(basis, koekjeUit(antwoord.setCookies)) };
}

module.exports = { WACHTWOORD, start, vraag, klant, koekjeUit, stelIn };
