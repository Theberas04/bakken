'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  ROLLEN, RECHTEN, OMSCHRIJVING, isRol, standaardRechten, schoonRechten, heeftRecht, laatsteBeheerder
} = require('../lib/rechten');

test('elke recht heeft een uitleg in het Nederlands', () => {
  for (const recht of RECHTEN) {
    assert.equal(typeof OMSCHRIJVING[recht], 'string');
    assert.equal(OMSCHRIJVING[recht].length > 5, true, recht + ' mist uitleg');
  }
});

test('een beheerder heeft alles, een gewone gebruiker begint met alleen kijken', () => {
  const beheerder = standaardRechten('beheerder');
  for (const recht of RECHTEN) assert.equal(beheerder[recht], true, recht);
  const gebruiker = standaardRechten('gebruiker');
  assert.equal(gebruiker.bakken_bekijken, true);
  assert.equal(gebruiker.bakken_wijzigen, false);
  assert.equal(gebruiker.gebruikers_beheren, false);
});

test('rollen zijn begrensd', () => {
  assert.deepEqual(ROLLEN, ['beheerder', 'gebruiker']);
  assert.equal(isRol('beheerder'), true);
  assert.equal(isRol('gebruiker'), true);
  assert.equal(isRol('baas'), false);
  assert.equal(isRol(null), false);
});

test('rechten van buitenaf worden begrensd tot bekende sleutels en echte vinkjes', () => {
  const uit = schoonRechten('gebruiker', {
    bakken_wijzigen: 'aan',
    bakken_verwijderen: true,
    gebruikers_beheren: 'ja hoor',
    onbekend_recht: true,
    codes_beheren: 1
  });
  assert.equal(uit.bakken_wijzigen, true);
  assert.equal(uit.bakken_verwijderen, true);
  assert.equal(uit.gebruikers_beheren, false, 'alleen true of "aan" telt');
  assert.equal(uit.codes_beheren, false, '1 is geen vinkje');
  assert.equal('onbekend_recht' in uit, false, 'onbekende sleutels verdwijnen');
  assert.deepEqual(Object.keys(uit).sort(), [...RECHTEN].sort());
});

test('een beheerder houdt alles, ook als het formulier leeg is', () => {
  const uit = schoonRechten('beheerder', { bakken_bekijken: false });
  for (const recht of RECHTEN) assert.equal(uit[recht], true, recht);
});

test('heeftRecht kijkt naar de rol en naar de vinkjes', () => {
  assert.equal(heeftRecht({ rol: 'beheerder', rechten: {} }, 'bijwerken'), true);
  assert.equal(heeftRecht({ rol: 'gebruiker', rechten: { bakken_wijzigen: true } }, 'bakken_wijzigen'), true);
  assert.equal(heeftRecht({ rol: 'gebruiker', rechten: { bakken_wijzigen: true } }, 'bakken_verwijderen'), false);
  assert.equal(heeftRecht({ rol: 'gebruiker', rechten: {} }, 'onbekend'), false);
  assert.equal(heeftRecht(null, 'bakken_bekijken'), false);
});

test('de laatste beheerder wordt herkend', () => {
  const gebruikers = [
    { id: 1, rol: 'beheerder' },
    { id: 2, rol: 'gebruiker' }
  ];
  assert.equal(laatsteBeheerder(gebruikers, 1), true);
  assert.equal(laatsteBeheerder(gebruikers, 2), false);
  assert.equal(laatsteBeheerder(gebruikers.concat([{ id: 3, rol: 'beheerder' }]), 1), false);
  assert.equal(laatsteBeheerder([], 1), false);
});
