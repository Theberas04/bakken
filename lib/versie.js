'use strict';
// Versies vergelijken. Twee dingen die op elkaar lijken maar niet hetzelfde zijn:
// een versienummer (0.2.0) en de commit waar een installatie op staat. De app
// meldt alleen iets als hij het zeker weet.

// Een korte commit tegen een lange: alleen als ze duidelijk verschillen is het
// iets anders. Prefix vergelijken, zodat 7 tekens tegen 40 tekens niet als
// "nieuw" telt.
function isNieuwereVersie(vanGitHub, vanHier) {
  const a = String(vanGitHub || '').toLowerCase();
  const b = String(vanHier || '').toLowerCase();
  if (!a || !b) return false; // niet weten = niets beweren
  return !(a.startsWith(b) || b.startsWith(a));
}

// -1 als a ouder is, 0 gelijk, 1 als a nieuwer is. Onbekende stukken tellen als 0.
function vergelijkVersie(a, b) {
  const delen = (waarde) => String(waarde || '').trim().replace(/^v/i, '').split('.').map((stuk) => {
    const n = parseInt(String(stuk).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  });
  const links = delen(a);
  const rechts = delen(b);
  const lengte = Math.max(links.length, rechts.length);
  for (let i = 0; i < lengte; i += 1) {
    const x = links[i] || 0;
    const y = rechts[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

module.exports = { isNieuwereVersie, vergelijkVersie };
