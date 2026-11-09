// Proeven op de installatie op de Proxmox-host. Ze kijken naar de bestanden zelf: het
// installatiescript moet een container kunnen aanmaken, en er mag nergens een adres of een
// vast container-nummer in de one-liner staan. Zo blijft de belofte "gewoon één commando"
// overeind zonder dat er per ongeluk iets van Tom's omgeving in het repo belandt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MAP = path.join(__dirname, '..', 'deploy', 'proxmox');
const lees = (naam) => fs.readFileSync(path.join(MAP, naam), 'utf8');

test('het installatiescript maakt zelf een container aan', () => {
  const install = lees('install.sh');
  assert.ok(fs.existsSync(path.join(MAP, 'create-bakken-lxc.sh')), 'create-bakken-lxc.sh hoort te bestaan');
  assert.match(install, /create-bakken-lxc\.sh/, 'install.sh hoort het aanmaakscript aan te roepen');
  const aanmaak = lees('create-bakken-lxc.sh');
  assert.match(aanmaak, /pct create/, 'het aanmaakscript hoort pct create te gebruiken');
  assert.match(aanmaak, /^\s*echo "\$CTID"\s*$/m, 'het aanmaakscript hoort alleen het nummer op stdout te zetten');
});

test('het aanmaakscript slaat nummers van gewone VM\'s over', () => {
  const aanmaak = lees('create-bakken-lxc.sh');
  assert.match(aanmaak, /qm status/, 'een nummer van een VM (qm) hoort ook als bezet te tellen');
  assert.match(aanmaak, /qemu-server/, 'het configuratiebestand van een VM hoort mee te tellen');
  assert.match(aanmaak, /Geen vrij nummer gevonden/, 'zonder vrij nummer hoort het script eerlijk te stoppen');
});

test('het aanmaakscript probeert het volgende nummer als Proxmox toch klaagt', () => {
  const aanmaak = lees('create-bakken-lxc.sh');
  assert.match(aanmaak, /already exists/, 'een klacht dat het nummer bezet is hoort opgevangen te worden');
  assert.match(aanmaak, /blijkt toch bezet/, 'en dan hoort het script het volgende nummer te proberen');
  assert.match(aanmaak, /^echo "\$CTID"$/m, 'alleen het gekozen nummer mag op stdout staan');
});

test('de dienst krijgt het recht om op een lage poort te luisteren', () => {
  const inricht = lees('provision-bakken.sh');
  assert.match(inricht, /AmbientCapabilities=CAP_NET_BIND_SERVICE/,
    'zonder dit recht stopt node met listen EACCES op poort 80');
  assert.match(inricht, /CapabilityBoundingSet=CAP_NET_BIND_SERVICE/);
  const bijwerken = lees('update-from-github.sh');
  assert.match(bijwerken, /AmbientCapabilities/,
    'een bestaande installatie hoort dit recht bij het bijwerken alsnog te krijgen');
});

test('elk script dat de installer uitvoert staat in de bestandenlijst', () => {
  const install = lees('install.sh');
  const lijst = install.slice(install.indexOf('FILES=('), install.indexOf(')\n', install.indexOf('FILES=(')));
  for (const script of ['create-bakken-lxc.sh', 'provision-bakken.sh']) {
    assert.ok(lijst.includes(`deploy/proxmox/${script}`), `${script} hoort in FILES te staan`);
  }
});

test('de one-liner vraagt geen container-nummer', () => {
  const install = lees('install.sh');
  const kop = install.slice(0, install.indexOf('set -euo pipefail'));
  assert.ok(!/CTID=[0-9]+\s+bash -c/.test(kop), 'de kop mag geen vast CTID in het voorbeeld hebben');
  assert.match(kop, /create-bakken-lxc\.sh/, 'de kop hoort te vertellen dat er een container wordt gemaakt');
});

test('nergens staat een vast container-nummer als voorbeeld', () => {
  for (const bestand of ['README.md', 'deploy/proxmox/README.md']) {
    const inhoud = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', bestand), 'utf8');
    assert.ok(!/CTID/.test(inhoud), `${bestand} hoort geen CTID te noemen`);
  }
  for (const script of ['install.sh', 'update-from-github.sh', 'provision-bakken.sh']) {
    const inhoud = lees(script);
    assert.ok(!/CTID=</.test(inhoud), `${script} hoort geen CTID=<nummer> als voorbeeld te tonen`);
  }
});

test('bijwerken zoekt de container zelf', () => {
  const bij = lees('update-from-github.sh');
  assert.match(bij, /pct list/, 'bijwerken hoort de containers te doorzoeken als er geen nummer is');
  assert.ok(!/Gebruik: CTID=<nummer>/.test(bij), 'bijwerken hoort niet meteen om een nummer te vragen');
});
