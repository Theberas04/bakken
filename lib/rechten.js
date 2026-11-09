'use strict';
// Wie mag wat. De beheerder deelt deze rechten uit en kan ze ook weer intrekken.

const ROLLEN = ['beheerder', 'gebruiker'];

const RECHTEN = [
  'bakken_bekijken',
  'bakken_wijzigen',
  'bakken_verwijderen',
  'codes_beheren',
  'gebruikers_beheren',
  'bijwerken'
];

const OMSCHRIJVING = {
  bakken_bekijken: 'Bakken en hun inhoud bekijken',
  bakken_wijzigen: 'Bakken en voorraad toevoegen en aanpassen',
  bakken_verwijderen: 'Bakken, producten en foto\u2019s verwijderen',
  codes_beheren: 'Codes aanmaken, benoemen, printen en koppelen',
  gebruikers_beheren: 'Gebruikers toevoegen, rechten geven en intrekken',
  bijwerken: 'Controleren op een nieuwe versie en bijwerken'
};

function isRol(rol) {
  return ROLLEN.includes(rol);
}

// Kijken kan iedereen met een account: een account dat niets mag zien heeft geen
// doel. Een beheerder heeft daarnaast alles; een gewone gebruiker begint met de
// vinkjes uit, waarna de beheerder ze stuk voor stuk aanzet.
const ALTIJD_AAN = ['bakken_bekijken'];

function standaardRechten(rol) {
  const uit = {};
  for (const recht of RECHTEN) uit[recht] = rol === 'beheerder' || ALTIJD_AAN.includes(recht);
  return uit;
}

// Rechten van buitenaf (formulier, API) begrenzen tot de bekende sleutels en
// tot echte booleans. Onbekende sleutels verdwijnen, niet-bestaande komen erbij.
function schoonRechten(rol, rechten) {
  const bron = rechten && typeof rechten === 'object' ? rechten : {};
  const uit = {};
  for (const recht of RECHTEN) {
    uit[recht] = rol === 'beheerder' || ALTIJD_AAN.includes(recht) ? true : bron[recht] === true || bron[recht] === 'aan';
  }
  return uit;
}

function heeftRecht(gebruiker, recht) {
  if (!gebruiker) return false;
  if (!RECHTEN.includes(recht)) return false;
  if (gebruiker.rol === 'beheerder') return true;
  const rechten = gebruiker.rechten || {};
  return rechten[recht] === true;
}

// De laatste beheerder mag niet weg of gedegradeerd worden, anders is er
// niemand meer die gebruikers of rechten kan beheren.
function laatsteBeheerder(gebruikers, id) {
  const beheerders = (gebruikers || []).filter((g) => g.rol === 'beheerder');
  return beheerders.length === 1 && String(beheerders[0].id) === String(id);
}

module.exports = {
  ROLLEN,
  RECHTEN,
  ALTIJD_AAN,
  OMSCHRIJVING,
  isRol,
  standaardRechten,
  schoonRechten,
  heeftRecht,
  laatsteBeheerder
};
