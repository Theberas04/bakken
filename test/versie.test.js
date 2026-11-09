'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const hulp = require('./hulp');
const { isNieuwereVersie, vergelijkVersie } = require('../lib/versie');

test('versienummers vergelijken', () => {
  assert.equal(vergelijkVersie('0.2.0', '0.1.9'), 1);
  assert.equal(vergelijkVersie('0.2.0', '0.2.0'), 0);
  assert.equal(vergelijkVersie('0.2.0', '0.10.0'), -1);
  assert.equal(vergelijkVersie('1.0.0', '1.0.0'), 0);
  assert.equal(vergelijkVersie('v1.2.3', '1.2.3'), 0, 'een v ervoor mag');
  assert.equal(vergelijkVersie('1.2.3', '1.2'), 1, 'een ontbrekend stuk telt als 0');
  assert.equal(vergelijkVersie('', '1.0.0'), -1, 'onbekend is niet nieuwer');
  assert.equal(vergelijkVersie('onzin', 'onzin'), 0);
});

test('een korte commit tegen een lange telt niet als nieuw', () => {
  const lang = 'bcb8d4f1234567890abcdef1234567890abcdef12';
  assert.equal(isNieuwereVersie('bcb8d4f', 'bcb8d4f1234567'), false);
  assert.equal(isNieuwereVersie(lang, 'bcb8d4f'), false);
  assert.equal(isNieuwereVersie('aaa1111', 'bcb8d4f'), true);
});

test('zonder commit of versie wordt er niets beweerd', () => {
  assert.equal(isNieuwereVersie('', 'bcb8d4f'), false);
  assert.equal(isNieuwereVersie('abc1234', ''), false);
  assert.equal(isNieuwereVersie(null, null), false);
});

// Een nagemaakt GitHub dat één VERSIE.json serveert, zodat de versiecontrole
// echt van begin tot eind getoetst wordt (en de proeven toch geen internet op gaan).
function nepGitHub(lichaam, status) {
  const server = http.createServer((req, res) => {
    if (status) {
      res.writeHead(status, { 'content-type': 'text/plain' });
      return res.end('nee');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(typeof lichaam === 'string' ? lichaam : JSON.stringify(lichaam));
  });
  return new Promise((klaar) => server.listen(0, '127.0.0.1', () => {
    klaar({ server, url: 'http://127.0.0.1:' + server.address().port + '/VERSIE.json' });
  }));
}

test('de versiecontrole meldt iets nieuws als GitHub verder is', async (t) => {
  const github = await nepGitHub({ versie: '9.9.9', commit: 'aaaaaaa', boodschap: 'Iets heel nieuws' });
  t.after(() => new Promise((klaar) => github.server.close(klaar)));
  const omgeving = await hulp.start({ versieBron: github.url });
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis)).klant;

  const controle = await tom.haal('/api/versie/controle');
  assert.equal(controle.status, 200);
  assert.equal(controle.gegevens.nieuwer, true);
  assert.equal(controle.gegevens.laatste.versie, '9.9.9');
  assert.equal(controle.gegevens.laatste.boodschap, 'Iets heel nieuws');
  assert.equal(controle.gegevens.versie, '0.2.0', 'de eigen versie komt mee');
});

test('de versiecontrole meldt niets nieuws als de app bij is', async (t) => {
  const github = await nepGitHub({ versie: '0.0.1', commit: '', boodschap: 'Oud' });
  t.after(() => new Promise((klaar) => github.server.close(klaar)));
  const app = await hulp.start({ versieBron: github.url });
  t.after(() => app.stop());
  const tom = (await hulp.stelIn(app.basis)).klant;

  const controle = await tom.haal('/api/versie/controle');
  assert.equal(controle.status, 200);
  assert.equal(controle.gegevens.nieuwer, false, 'de app draait een nieuwere versie dan op GitHub');
});

test('een GitHub dat niet meewerkt geeft een eerlijke melding, geen valse update', async (t) => {
  const github = await nepGitHub('', 500);
  t.after(() => new Promise((klaar) => github.server.close(klaar)));
  const omgeving = await hulp.start({ versieBron: github.url });
  t.after(() => omgeving.stop());
  const tom = (await hulp.stelIn(omgeving.basis)).klant;

  const controle = await tom.haal('/api/versie/controle');
  assert.equal(controle.status, 200);
  assert.equal(controle.gegevens.nieuwer, false);
  assert.match(controle.gegevens.laatste.fout, /GitHub antwoordde 500/);

  const kapotte = await hulp.start({ versieBron: 'http://127.0.0.1:9/VERSIE.json' });
  t.after(() => kapotte.stop());
  const tom2 = (await hulp.stelIn(kapotte.basis)).klant;
  const onbereikbaar = await tom2.haal('/api/versie/controle');
  assert.equal(onbereikbaar.gegevens.nieuwer, false);
  assert.match(onbereikbaar.gegevens.laatste.fout, /Geen verbinding met GitHub/);
});
