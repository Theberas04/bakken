/* eslint-disable */
// De app zelf. Eén pagina, vier schermen en een beheerscherm.
//
// Alles wat je ziet is Nederlands. De app praat met de server onder /api/ en
// bewaart wat hij ophaalt ook op het toestel, zodat de bakken en hun voorraad
// zonder internet te zien zijn. Wat je offline wijzigt, gaat later naar de
// server (zie de wachtrij hieronder).

(function () {
  'use strict';

  // ------------------------------------------------------------- hulpjes ---
  var $ = function (sel, wortel) { return (wortel || document).querySelector(sel); };
  var $$ = function (sel, wortel) { return Array.prototype.slice.call((wortel || document).querySelectorAll(sel)); };

  function esc(tekst) {
    return String(tekst == null ? '' : tekst)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // "1 product" en niet "1 producten": kleine dingen vallen op in een lijst.
  function meervoud(aantal, enkel, meer) {
    return Number(aantal) === 1 ? enkel : meer;
  }

  function datum(waarde) {
    if (!waarde) return '';
    var d = new Date(waarde);
    if (isNaN(d.getTime())) return String(waarde);
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var SLEUTEL_CACHE = 'bakken.cache.v1';
  var SLEUTEL_WACHTRIJ = 'bakken.wachtrij.v1';
  var SLEUTEL_GEBRUIKER = 'bakken.gebruiker.v1';

  function lees(sleutel, standaard) {
    try {
      var ruw = localStorage.getItem(sleutel);
      return ruw ? JSON.parse(ruw) : standaard;
    } catch (e) { return standaard; }
  }

  function schrijf(sleutel, waarde) {
    try { localStorage.setItem(sleutel, JSON.stringify(waarde)); } catch (e) { /* vol of geweigerd */ }
  }

  function api(pad, opties) {
    var o = opties || {};
    return fetch(pad, {
      method: o.methode || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: o.lichaam ? { 'content-type': 'application/json' } : {},
      body: o.lichaam ? JSON.stringify(o.lichaam) : undefined
    }).then(function (antwoord) {
      return antwoord.json().catch(function () { return {}; }).then(function (gegevens) {
        if (!antwoord.ok) {
          var fout = new Error(gegevens.fout || ('De server antwoordde met ' + antwoord.status + '.'));
          fout.status = antwoord.status;
          throw fout;
        }
        return gegevens;
      });
    });
  }

  // ---------------------------------------------------------------- staat ---
  var staat = {
    gebruiker: null,
    bakken: [],
    codes: [],
    bak: null,
    filter: '',
    offline: false,
    ingesteld: false,
    recht: function (naam) {
      var g = staat.gebruiker;
      if (!g) return false;
      if (g.rol === 'beheerder') return true;
      return Boolean(g.rechten && g.rechten[naam]);
    }
  };

  // Wie er het laatst ingelogd was. Zonder dit kan de app offline niets doen:
  // de server kan dan niet bevestigen wie je bent. Alleen de naam en de rechten
  // worden bewaard, nooit het wachtwoord of het sessietoken.
  function bewaarGebruiker(gebruiker) {
    if (!gebruiker) {
      try { localStorage.removeItem(SLEUTEL_GEBRUIKER); } catch (e) { /* niets */ }
      return;
    }
    schrijf(SLEUTEL_GEBRUIKER, { gebruiker: gebruiker, op: new Date().toISOString() });
  }

  function leesGebruiker() {
    var bewaard = lees(SLEUTEL_GEBRUIKER, null);
    return bewaard && bewaard.gebruiker ? bewaard.gebruiker : null;
  }

  function bewaarBakken(bakken) {
    staat.bakken = bakken;
    var c = lees(SLEUTEL_CACHE, {});
    c.bakken = bakken;
    c.bijgewerkt = new Date().toISOString();
    schrijf(SLEUTEL_CACHE, c);
  }

  function bewaarCodes(codes) {
    staat.codes = codes;
    var c = lees(SLEUTEL_CACHE, {});
    c.codes = codes;
    c.bijgewerkt = new Date().toISOString();
    schrijf(SLEUTEL_CACHE, c);
  }

  function bewaarBak(bak, producten, fotos) {
    staat.bak = { bak: bak, producten: producten, fotos: fotos || [] };
    var c = lees(SLEUTEL_CACHE, {});
    c.bakkenDetail = c.bakkenDetail || {};
    c.bakkenDetail[bak.id] = staat.bak;
    schrijf(SLEUTEL_CACHE, c);
  }

  // ------------------------------------------------------------- wachtrij ---
  // Wat je offline doet, verdwijnt niet: het gaat in een wachtrij en probeert
  // het opnieuw zodra er weer verbinding is.
  function zetInWachtrij(actie) {
    var rij = lees(SLEUTEL_WACHTRIJ, []);
    rij.push(Object.assign({ op: new Date().toISOString() }, actie));
    schrijf(SLEUTEL_WACHTRIJ, rij);
  }

  function wachtrijLengte() {
    return lees(SLEUTEL_WACHTRIJ, []).length;
  }

  async function verwerkWachtrij() {
    var rij = lees(SLEUTEL_WACHTRIJ, []);
    if (!rij.length) return 0;
    var over = [];
    for (var i = 0; i < rij.length; i += 1) {
      var actie = rij[i];
      try {
        await api(actie.pad, { methode: actie.methode, lichaam: actie.lichaam });
      } catch (e) {
        // Alleen netwerkfouten bewaren; een echte weigering (403/404) heeft geen
        // zin om te herhalen.
        if (e.status) continue;
        over.push(actie);
      }
    }
    schrijf(SLEUTEL_WACHTRIJ, over);
    return rij.length - over.length;
  }

  // ---------------------------------------------------------------- scherm ---
  var app = $('#app');
  var kop = $('#kop');
  var balk = $('#balk');
  var zweef = $('#zweef');

  function meld(tekst, soort) {
    var vak = $('.melding[data-vast]') || document.createElement('div');
    vak.className = 'melding' + (soort ? ' ' + soort : '');
    vak.setAttribute('data-vast', '1');
    vak.textContent = tekst;
    var doel = $('.kaart') || app;
    if (!vak.parentNode) doel.insertBefore(vak, doel.firstChild);
  }

  function wisMelding() {
    $$('.melding[data-vast]').forEach(function (v) { v.remove(); });
  }

  function tekenKop(titel, ondertitel, metTerug) {
    kop.hidden = false;
    kop.innerHTML =
      (metTerug ? '<button class="terug" data-ga="bakken" aria-label="Terug naar de bakken">←</button>'
        : '<span class="merk" aria-hidden="true">B</span>') +
      '<div><h1>' + esc(titel) + '</h1><p>' + esc(ondertitel || '') + '</p></div>';
  }

  function tekenBalk(actief) {
    var items = [
      { naam: 'bakken', titel: 'Bakken' },
      { naam: 'scan', titel: 'Scannen' },
      { naam: 'codes', titel: 'Codes', recht: 'codes_beheren' }
    ];
    var zichtbaar = items.filter(function (i) { return !i.recht || staat.recht(i.recht); });
    if (staat.gebruiker) zichtbaar.push({ naam: 'beheer', titel: 'Beheer' });
    balk.hidden = false;
    balk.innerHTML = zichtbaar.map(function (i) {
      return '<a href="#/' + i.naam + '"' + (actief === i.naam ? ' aria-current="page"' : '') + '>' + i.titel + '</a>';
    }).join('');
  }

  function tekenOffline() {
    if (!staat.offline) return '';
    return '<p class="offline">Geen verbinding met de server. Je ziet de gegevens die op dit toestel staan' +
      (wachtrijLengte() ? '; ' + wachtrijLengte() + ' wijziging(en) wachten op verzenden' : '') + '.</p>';
  }

  // ------------------------------------------------------------ inloggen ---
  function schermInloggen() {
    kop.hidden = true;
    balk.hidden = true;
    zweef.hidden = true;
    app.innerHTML =
      '<div class="kaart">' +
      '  <h2>Inloggen</h2>' +
      '  <p>Met een account van deze app.</p>' +
      '  <label for="naam">Gebruikersnaam</label>' +
      '  <input id="naam" autocomplete="username" autocapitalize="none">' +
      '  <label for="wachtwoord">Wachtwoord</label>' +
      '  <input id="wachtwoord" type="password" autocomplete="current-password">' +
      '  <div class="knoppen"><button class="hoofd" id="doe-inloggen">Inloggen</button></div>' +
      '  <div id="inlog-melding"></div>' +
      '</div>';
    $('#doe-inloggen').addEventListener('click', inloggen);
    $('#wachtwoord').addEventListener('keydown', function (e) { if (e.key === 'Enter') inloggen(); });
  }

  function schermInstellen() {
    kop.hidden = true;
    balk.hidden = true;
    zweef.hidden = true;
    app.innerHTML =
      '<div class="kaart">' +
      '  <h2>Eerste keer: je account instellen</h2>' +
      '  <p>Er is nog geen account. Kies de naam en het wachtwoord van de beheerder. Daarna kun je\n' +
      '     andere gebruikers aanmaken en rechten geven.</p>' +
      '  <label for="naam">Gebruikersnaam</label>' +
      '  <input id="naam" autocomplete="username" autocapitalize="none" value="Tom">' +
      '  <label for="wachtwoord">Wachtwoord (minstens 10 tekens)</label>' +
      '  <input id="wachtwoord" type="password" autocomplete="new-password">' +
      '  <div class="knoppen"><button class="hoofd" id="doe-instellen">Account instellen</button></div>' +
      '  <div id="inlog-melding"></div>' +
      '</div>';
    $('#doe-instellen').addEventListener('click', instellen);
    $('#wachtwoord').addEventListener('keydown', function (e) { if (e.key === 'Enter') instellen(); });
  }

  function toonInlogFout(tekst) {
    var vak = $('#inlog-melding');
    if (vak) vak.innerHTML = '<div class="melding fout">' + esc(tekst) + '</div>';
  }

  async function inloggen() {
    try {
      var uit = await api('/api/inloggen', {
        methode: 'POST',
        lichaam: { naam: $('#naam').value.trim(), wachtwoord: $('#wachtwoord').value }
      });
      staat.gebruiker = uit.gebruiker;
      staat.offline = false;
      bewaarGebruiker(uit.gebruiker);
      await laadBakken();
      ga('bakken');
    } catch (e) {
      toonInlogFout(e.message);
    }
  }

  async function instellen() {
    try {
      var uit = await api('/api/instellen', {
        methode: 'POST',
        lichaam: { naam: $('#naam').value.trim(), wachtwoord: $('#wachtwoord').value }
      });
      staat.gebruiker = uit.gebruiker;
      staat.ingesteld = true;
      bewaarGebruiker(uit.gebruiker);
      await laadBakken();
      ga('bakken');
    } catch (e) {
      toonInlogFout(e.message);
    }
  }

  // Alles wat je nodig hebt om offline te scannen, meteen op het toestel zetten:
  // de codes en de inhoud van elke bak. Lukt een onderdeel niet, dan gaat de rest
  // gewoon door — offline werken is beter dan niets hebben.
  async function vulOfflineAan() {
    try {
      var c = await api('/api/codes');
      bewaarCodes(c.codes || []);
    } catch (e) { /* geen recht of offline */ }
    for (var i = 0; i < staat.bakken.length; i += 1) {
      try {
        var g = await api('/api/bakken/' + staat.bakken[i].id);
        bewaarBak(g.bak, g.producten, g.fotos);
      } catch (e) { /* sla deze bak over */ }
    }
  }

  // -------------------------------------------------------------- bakken ---
  async function laadBakken() {
    try {
      var uit = await api('/api/bakken');
      bewaarBakken(uit.bakken || []);
      staat.offline = false;
      vulOfflineAan();
      return staat.bakken;
    } catch (e) {
      if (e.status === 401) { staat.gebruiker = null; schermInloggen(); throw e; }
      staat.offline = true;
      var c = lees(SLEUTEL_CACHE, {});
      staat.bakken = c.bakken || [];
      return staat.bakken;
    }
  }

  function schermBakken() {
    tekenKop('Bakken', staat.gebruiker ? staat.gebruiker.naam : '');
    tekenBalk('bakken');
    zweef.hidden = !staat.recht('bakken_wijzigen');
    zweef.innerHTML = staat.recht('bakken_wijzigen')
      ? '<button type="button" data-nieuw="bak" aria-label="Nieuwe bak">+</button>' : '';

    var zichtbaar = staat.bakken.filter(function (b) {
      if (!staat.filter) return true;
      var hooi = (b.naam + ' ' + (b.locatie || '') + ' ' + (b.omschrijving || '')).toLowerCase();
      return hooi.indexOf(staat.filter.toLowerCase()) !== -1;
    });

    app.innerHTML = tekenOffline() +
      '<input class="zoek" id="zoek" type="search" placeholder="Zoek op naam of locatie" value="' + esc(staat.filter) + '">' +
      (zichtbaar.length ? zichtbaar.map(function (b) {
        var aantal = b.producten || 0;
        var stuks = b.stuks || 0;
        return '<button class="rij-knop" data-bak="' + b.id + '">' +
          '<span class="groot"><strong>' + esc(b.naam) + '</strong>' +
          '<small>' + esc(b.locatie || 'geen locatie') + '</small></span>' +
          '<span class="telling">' + aantal + ' ' + meervoud(aantal, 'product', 'producten') + '<br>' +
          stuks + ' ' + meervoud(stuks, 'stuk', 'stuks') + '</span>' +
          '</button>';
      }).join('') : '<p class="leeg">Nog geen bakken. Maak er een met de knop rechtsonder.</p>') +
      '<p class="klein" style="margin-top:14px">' +
      (staat.bakken.length ? staat.bakken.length + ' bakken op dit toestel' : '') + '</p>';

    var zoek = $('#zoek');
    zoek.addEventListener('input', function () {
      staat.filter = zoek.value;
      var hier = document.activeElement === zoek;
      schermBakken();
      if (hier) { var opnieuw = $('#zoek'); opnieuw.focus(); opnieuw.setSelectionRange(zoek.value.length, zoek.value.length); }
    });
  }

  function schermNieuweBak() {
    tekenKop('Nieuwe bak', 'naam en locatie', true);
    tekenBalk('bakken');
    zweef.hidden = true;
    app.innerHTML =
      '<div class="kaart">' +
      '  <h2>Nieuwe bak</h2>' +
      '  <label for="naam">Naam</label>' +
      '  <input id="naam" placeholder="Bijvoorbeeld: Garage - kerstspullen">' +
      '  <label for="locatie">Locatie</label>' +
      '  <input id="locatie" placeholder="Bijvoorbeeld: garage, stelling 2">' +
      '  <label for="omschrijving">Omschrijving (mag leeg blijven)</label>' +
      '  <textarea id="omschrijving"></textarea>' +
      '  <div class="knoppen">' +
      '    <button class="hoofd" id="bewaar">Bak bewaren</button>' +
      '    <button type="button" data-ga="bakken">Annuleren</button>' +
      '  </div>' +
      '  <div id="vorm-melding"></div>' +
      '</div>';
    $('#bewaar').addEventListener('click', async function () {
      var lichaam = {
        naam: $('#naam').value.trim(),
        locatie: $('#locatie').value.trim(),
        omschrijving: $('#omschrijving').value.trim()
      };
      if (!lichaam.naam) return toonVorm('Geef de bak een naam.');
      try {
        var uit = await api('/api/bakken', { methode: 'POST', lichaam: lichaam });
        await laadBakken();
        ga('bak/' + uit.bak.id);
      } catch (e) { toonVorm(e.message); }
    });
  }

  function toonVorm(tekst, soort) {
    var vak = $('#vorm-melding');
    if (vak) vak.innerHTML = '<div class="melding ' + (soort || 'fout') + '">' + esc(tekst) + '</div>';
  }

  // ---------------------------------------------------------- één bak ------
  async function schermBak(id) {
    zweef.hidden = true;
    var gegevens = null;
    try {
      gegevens = await api('/api/bakken/' + id);
      bewaarBak(gegevens.bak, gegevens.producten, gegevens.fotos);
      staat.offline = false;
    } catch (e) {
      if (e.status === 401) { staat.gebruiker = null; schermInloggen(); return; }
      staat.offline = true;
      var c = lees(SLEUTEL_CACHE, {});
      gegevens = (c.bakkenDetail || {})[id] || null;
      if (!gegevens) {
        tekenKop('Bak', '', true);
        tekenBalk('bakken');
        app.innerHTML = tekenOffline() +
          '<p class="leeg">Deze bak staat niet op dit toestel. Open hem één keer met internet, dan werkt hij ook offline.</p>';
        return;
      }
    }
    var bak = gegevens.bak;
    var producten = gegevens.producten || [];
    var fotos = gegevens.fotos || [];
    var stuks = producten.reduce(function (som, p) { return som + Number(p.aantal || 0); }, 0);

    tekenKop(bak.naam, (bak.locatie || 'geen locatie') + ' · ' + producten.length + ' ' +
      meervoud(producten.length, 'product', 'producten') + ' · ' + stuks + ' ' + meervoud(stuks, 'stuk', 'stuks'), true);
    tekenBalk('bakken');

    var sticker = '';
    if (bak.code) {
      sticker = '<div class="sticker">' + qrSvg(bak.code) + '<div>' +
        '<div class="code-tekst">' + esc(bak.code) + '</div>' +
        '<p class="klein">' + esc(bak.codeNaam || 'zonder naam') + '</p></div></div>';
    }

    app.innerHTML = tekenOffline() +
      '<div class="kaart">' +
      (bak.omschrijving ? '<p>' + esc(bak.omschrijving) + '</p>' : '') +
      (sticker || '<p class="klein">Nog geen sticker aan deze bak gekoppeld.</p>') +
      '<div class="knoppen">' +
      (staat.recht('bakken_wijzigen') ? '<button type="button" data-wijzig="' + bak.id + '">Bak wijzigen</button>' : '') +
      (staat.recht('codes_beheren') ? '<button type="button" data-sticker="' + bak.id + '">Sticker maken</button>' : '') +
      (staat.recht('bakken_verwijderen') ? '<button class="weg" type="button" data-verwijder="' + bak.id + '">Verwijderen</button>' : '') +
      '</div>' +
      '</div>' +

      '<div class="kaart">' +
      '<h2>Voorraad</h2>' +
      (producten.length ? producten.map(function (p) {
        return '<div class="product" data-product="' + p.id + '">' +
          '<div class="naam"><strong>' + esc(p.naam) + '</strong>' +
          '<small>' + esc([p.eenheid, p.notitie].filter(Boolean).join(' · ')) + '</small></div>' +
          '<div class="teller">' +
          (staat.recht('bakken_wijzigen')
            ? '<button type="button" data-tel="' + p.id + '" data-verschil="-1" aria-label="Eén minder">−</button>' : '') +
          '<b>' + Number(p.aantal || 0) + '</b>' +
          (staat.recht('bakken_wijzigen')
            ? '<button type="button" data-tel="' + p.id + '" data-verschil="1" aria-label="Eén meer">+</button>' : '') +
          '</div></div>';
      }).join('') : '<p class="leeg">Nog geen producten in deze bak.</p>') +
      (staat.recht('bakken_wijzigen')
        ? '<div class="knoppen"><button type="button" data-product-nieuw="' + bak.id + '">Product toevoegen</button></div>' : '') +
      '</div>' +

      '<div class="kaart">' +
      '<h2>Foto\'s van de inhoud</h2>' +
      (fotos.length ? '<div class="fotos">' + fotos.map(function (f) {
        return '<figure><img src="/api/fotos/' + f.id + '" alt="Foto van de inhoud" loading="lazy">' +
          (staat.recht('bakken_verwijderen')
            ? '<button class="weg" type="button" data-foto-weg="' + f.id + '" aria-label="Foto verwijderen">×</button>' : '') +
          '<figcaption>' + esc(datum(f.gemaaktOp)) + (f.opServer ? '' : ' · nog niet op de server') + '</figcaption></figure>';
      }).join('') + '</div>' : '<p class="leeg">Nog geen foto\'s van deze bak.</p>') +
      (staat.recht('bakken_wijzigen')
        ? '<div class="knoppen">' +
          '<label class="knop" style="margin:0">Foto maken<input type="file" id="foto" accept="image/*" capture="environment" hidden></label>' +
          '<label class="knop" style="margin:0">Foto kiezen<input type="file" id="foto-kies" accept="image/*" hidden></label>' +
          '</div>' : '') +
      '<div id="foto-melding"></div>' +
      '</div>';
  }

  // Een sticker tekenen: de inhoud is een gewone link, zodat hij ook met de
  // camera-app van een telefoon werkt.
  function qrSvg(code) {
    var adres = location.origin + '/b/' + encodeURIComponent(code);
    try {
      return window.bakkenQr.maakSvg(adres, { maat: 6 }).svg;
    } catch (e) {
      return '<span class="klein">De QR-code kon niet getekend worden.</span>';
    }
  }

  // ------------------------------------------------------------- scannen ---
  function schermScannen(voorgevuldeCode) {
    tekenKop('Scannen', 'richt de camera op de sticker');
    tekenBalk('scan');
    zweef.hidden = true;
    app.innerHTML =
      '<div id="scan-uitkomst"></div>' +
      '<div class="kaart">' +
      '  <h2>Code intoetsen</h2>' +
      '  <p>Staat er geen camera of werkt de sticker niet? Typ de code over die onder de QR staat.</p>' +
      '  <label for="code">Code</label>' +
      '  <input id="code" autocapitalize="characters" autocomplete="off" placeholder="Bijvoorbeeld 3TCBT" value="' + esc(voorgevuldeCode || '') + '">' +
      '  <div class="knoppen"><button class="hoofd" id="doe-scan">Opzoeken</button></div>' +
      '</div>' +
      '<div class="kaart" id="camera-kaart">' +
      '  <h2>Met de camera</h2>' +
      '  <p id="camera-uitleg">De camera opent pas als je erop tikt; dan zie je hier het beeld.</p>' +
      '  <div class="knoppen"><button type="button" id="start-camera">Camera aanzetten</button></div>' +
      '</div>';

    $('#doe-scan').addEventListener('click', function () { zoekCode($('#code').value); });
    $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') zoekCode($('#code').value); });
    $('#start-camera').addEventListener('click', startCamera);
    if (voorgevuldeCode) zoekCode(voorgevuldeCode);
  }

  // De code uit een sticker of een link halen. Werkt ook offline: de app hoeft
  // dan niet bij de server te vragen wat er in de link staat.
  function codeUitInhoud(inhoud) {
    var groepen = String(inhoud || '').trim().split(/[^0-9A-Za-z]+/).filter(Boolean);
    for (var i = groepen.length - 1; i >= 0; i -= 1) {
      var g = groepen[i].toUpperCase();
      if (/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(g)) return g;
    }
    return String(inhoud || '').trim().toUpperCase();
  }

  async function zoekCode(waarde) {
    var schoon = String(waarde || '').trim();
    if (!schoon) return;
    try {
      var uit = await api('/api/scan', { methode: 'POST', lichaam: { inhoud: schoon } });
      if (uit.bak) { ga('bak/' + uit.bak.id); return; }
      toonScanUitkomst('Deze code hoort nog niet bij een bak. Maak eerst een bak aan, of koppel de code.', 'let-op');
    } catch (e) {
      if (e.status === 404) {
        toonScanUitkomst('Deze code is hier niet bekend. Misschien hoort hij bij een andere installatie.', 'let-op');
        return;
      }
      // Offline: zoek de code in wat er op dit toestel staat. Zo werkt een
      // gescande sticker ook zonder internet.
      var code = codeUitInhoud(schoon);
      var c = lees(SLEUTEL_CACHE, {});
      var gevonden = (c.codes || []).filter(function (x) { return x.code === code; })[0];
      if (gevonden && gevonden.bakId) { ga('bak/' + gevonden.bakId); return; }
      if (gevonden) {
        toonScanUitkomst('Deze code hangt nog niet aan een bak.', 'let-op');
        return;
      }
      toonScanUitkomst('Geen verbinding en deze code staat niet op dit toestel. Open hem één keer met internet, dan werkt hij daarna ook offline.', 'let-op');
    }
  }

  function toonScanUitkomst(tekst, soort) {
    var vak = $('#scan-uitkomst');
    if (!vak) return;
    vak.innerHTML = '<div class="melding ' + (soort || 'fout') + '">' + esc(tekst) + '</div>';
  }

  // De camera is optioneel: zonder toestemming of zonder https blijft de rest werken.
  async function startCamera() {
    var kaart = $('#camera-kaart');
    var uitleg = $('#camera-uitleg');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      uitleg.textContent = 'Deze browser geeft hier geen camera. Open de app via het https-adres.';
      return;
    }
    try {
      var stroom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      var vlak = document.createElement('div');
      vlak.className = 'scanvlak';
      vlak.innerHTML = '<video playsinline muted autoplay></video><span class="kader"></span>';
      var video = $('video', vlak);
      video.srcObject = stroom;
      kaart.innerHTML = '';
      kaart.appendChild(vlak);
      kaart.insertAdjacentHTML('beforeend',
        '<div class="knoppen"><button type="button" id="stop-camera">Camera uitzetten</button></div>' +
        '<div id="camera-melding" class="klein"></div>');
      $('#stop-camera').addEventListener('click', function () {
        stroom.getTracks().forEach(function (t) { t.stop(); });
        schermScannen();
      });
      await video.play().catch(function () {});
      leesBeeld(video, stroom);
    } catch (e) {
      uitleg.textContent = 'De camera kon niet aan: ' + e.message;
    }
  }

  // Zolang er beeld is, kijken we of er een code in zit. Lukt het niet, dan zegt
  // de app dat en blijft het intypen werken.
  async function leesBeeld(video, stroom) {
    var meldingVak = $('#camera-melding');
    if (!('BarcodeDetector' in window)) {
      if (meldingVak) meldingVak.textContent = 'Deze browser kan zelf geen codes lezen. Typ de code hieronder over, of gebruik de app op een telefoon met camera.';
      return;
    }
    var lezer;
    try {
      lezer = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      if (meldingVak) meldingVak.textContent = 'De camera-lezer kon niet starten.';
      return;
    }
    var bezig = false;
    var stop = false;
    var kijk = async function () {
      if (stop) return;
      if (bezig) { requestAnimationFrame(kijk); return; }
      bezig = true;
      try {
        var gevonden = await lezer.detect(video);
        if (gevonden && gevonden.length) {
          stop = true;
          stroom.getTracks().forEach(function (t) { t.stop(); });
          zoekCode(gevonden[0].rawValue);
          return;
        }
      } catch (e) { /* geen beeld of geen code: gewoon door */ }
      bezig = false;
      if (!stop) setTimeout(kijk, 250);
    };
    kijk();
  }

  // --------------------------------------------------------------- codes ---
  async function laadCodes() {
    try {
      var uit = await api('/api/codes');
      bewaarCodes(uit.codes || []);
      staat.offline = false;
      return staat.codes;
    } catch (e) {
      if (e.status === 401) { staat.gebruiker = null; schermInloggen(); throw e; }
      staat.offline = true;
      var c = lees(SLEUTEL_CACHE, {});
      staat.codes = c.codes || [];
      return staat.codes;
    }
  }

  async function schermCodes() {
    if (!staat.codes.length) {
      try { await laadCodes(); } catch (e) { /* offline: dan blijft de lijst leeg */ }
    }
    tekenKop('Codes', 'de stickers en waar ze zitten');
    tekenBalk('codes');
    zweef.hidden = true;
    var vrij = staat.codes.filter(function (c) { return !c.bakId; }).length;
    var geplakt = staat.codes.filter(function (c) { return c.bakId; }).length;

    app.innerHTML = tekenOffline() +
      '<div class="kaart">' +
      '<h2>Stickers</h2>' +
      '<p>' + staat.codes.length + ' codes · ' + geplakt + ' op een bak · ' + vrij + ' nog vrij.</p>' +
      '<div class="knoppen">' +
      '<button class="hoofd" type="button" data-nieuwe-codes="1">Nieuwe codes maken</button>' +
      (staat.codes.length ? '<button type="button" data-print="1">Printvel maken</button>' : '') +
      '</div>' +
      '<div id="codes-melding"></div>' +
      '</div>' +
      (staat.codes.length ? staat.codes.map(function (c) {
        return '<div class="kaart" data-code="' + esc(c.code) + '">' +
          '<div class="sticker">' + qrSvg(c.code) +
          '<div style="flex:1;min-width:0">' +
          '<div class="code-tekst">' + esc(c.naam || '(zonder naam)') + '</div>' +
          '<p class="klein">' + esc(c.code) + ' · ' + esc(c.status) +
          (c.bakId ? ' · in bak ' + esc(bakNaam(c.bakId)) : ' · nog niet geplakt') +
          (c.printOp ? ' · gedrukt ' + esc(datum(c.printOp)) : '') + '</p>' +
          '<div class="knoppen">' +
          '<button class="klein" type="button" data-hernoem="' + esc(c.code) + '">Naam wijzigen</button>' +
          (c.bakId ? '<button class="klein" type="button" data-open-bak="' + c.bakId + '">Naar de bak</button>'
            : '<button class="klein" type="button" data-koppel="' + esc(c.code) + '">Aan een bak koppelen</button>') +
          '<button class="klein weg" type="button" data-code-weg="' + esc(c.code) + '">Verwijderen</button>' +
          '</div></div></div></div>';
      }).join('') : '<p class="leeg">Nog geen codes. Maak er een vel van 48 in één keer.</p>');
  }

  function bakNaam(id) {
    var gevonden = staat.bakken.filter(function (b) { return String(b.id) === String(id); })[0];
    return gevonden ? gevonden.naam : 'onbekend';
  }

  function schermNieuweCodes() {
    tekenKop('Nieuwe codes', 'een vel in één keer', true);
    tekenBalk('codes');
    zweef.hidden = true;
    app.innerHTML =
      '<div class="kaart">' +
      '  <h2>Nieuwe codes maken</h2>' +
      '  <p>Elke code krijgt de naam die je hier opgeeft, met een nummer erachter. Die naam komt\n' +
      '     ook onder de QR op het printvel te staan.</p>' +
      '  <label for="naam">Naam</label>' +
      '  <input id="naam" placeholder="Bijvoorbeeld: Garage - kerstspullen">' +
      '  <label for="aantal">Aantal (maximaal 48)</label>' +
      '  <input id="aantal" type="number" min="1" max="48" value="48" inputmode="numeric">' +
      '  <div class="knoppen">' +
      '    <button class="hoofd" id="maak">Codes maken</button>' +
      '    <button type="button" data-ga="codes">Annuleren</button>' +
      '  </div>' +
      '  <div id="vorm-melding"></div>' +
      '</div>';
    $('#maak').addEventListener('click', async function () {
      var naam = $('#naam').value.trim();
      var aantal = Math.max(1, Math.min(48, Number($('#aantal').value) || 1));
      if (!naam) return toonVorm('Geef de codes een naam, dan weet je later waar ze horen.');
      try {
        var uit = await api('/api/codes', { methode: 'POST', lichaam: { aantal: aantal, naam: naam } });
        await laadCodes();
        ga('print?codes=' + uit.codes.map(function (c) { return c.code; }).join(','));
      } catch (e) { toonVorm(e.message); }
    });
  }

  // -------------------------------------------------------------- printen ---
  async function schermPrint(welke) {
    var codes = staat.codes;
    if (!codes.length) {
      try { codes = await laadCodes(); } catch (e) { codes = []; }
    }
    var gevraagd = String(welke || '').split(',').filter(Boolean);
    var teTonen = gevraagd.length
      ? codes.filter(function (c) { return gevraagd.indexOf(c.code) !== -1; })
      : codes.filter(function (c) { return !c.bakId; });

    tekenKop('Printvel', teTonen.length + ' stickers', true);
    balk.hidden = true;
    zweef.hidden = true;

    app.innerHTML = teTonen.length
      ? '<div class="niet-printen kaart">' +
        '<p>Dit vel is ' + teTonen.length + ' stickers. Kies "Afdrukken" en laat de printer op\n' +
        '   "achtergrondafbeeldingen" staan; dan blijven de codes scherp.</p>' +
        '<div class="knoppen">' +
        '<button class="hoofd" type="button" id="doe-print">Afdrukken</button>' +
        '<button type="button" data-ga="codes">Terug</button>' +
        '</div></div>' +
        '<div class="printvel">' + teTonen.map(function (c) {
          var adres = location.origin + '/b/' + encodeURIComponent(c.code);
          var svg = window.bakkenQr.maakPrintSvg(adres);
          return '<div class="sticker-vak">' + svg +
            '<div class="naam">' + esc(c.naam || 'Bakken') + '</div>' +
            '<div class="code">' + esc(c.code) + '</div></div>';
        }).join('') + '</div>'
      : '<p class="leeg">Er zijn geen vrije codes om te printen. Maak eerst nieuwe codes.</p>';

    var knop = $('#doe-print');
    if (knop) knop.addEventListener('click', function () { window.print(); });
  }

  // -------------------------------------------------------------- beheer ---
  async function schermBeheer() {
    tekenKop('Beheer', 'gebruikers, instellingen en versie');
    tekenBalk('beheer');
    zweef.hidden = true;
    app.innerHTML = '<p class="laden">Beheer wordt geladen…</p>';

    var versie = null;
    try { versie = await api('/api/versie'); } catch (e) { versie = null; }

    var gebruikers = [];
    var rechtLijst = [];
    if (staat.recht('gebruikers_beheren')) {
      try {
        var uit = await api('/api/gebruikers');
        gebruikers = uit.gebruikers || [];
        rechtLijst = uit.rechten || [];
      } catch (e) { /* geen recht of offline */ }
    }

    var instellingen = null;
    if (staat.recht('bijwerken')) {
      try { instellingen = await api('/api/instellingen'); } catch (e) { instellingen = null; }
    }

    app.innerHTML = tekenOffline() +
      '<div class="kaart">' +
      '<h2>Versie</h2>' +
      '<p id="versie-tekst">' + (versie ? 'Bakken ' + esc(versie.versie) + (versie.commit ? ' (' + esc(versie.commit) + ')' : '') : 'Onbekend') + '</p>' +
      (staat.recht('bijwerken')
        ? '<div class="knoppen"><button type="button" id="controleer">Controleer op een nieuwe versie</button>' +
          (versie && versie.updateMogelijk ? '<button type="button" id="bijwerken">Bijwerken</button>' : '') + '</div>' : '') +
      '<div id="versie-melding"></div>' +
      '</div>' +

      (staat.recht('gebruikers_beheren') ? '<div class="kaart">' +
        '<h2>Gebruikers</h2>' +
        '<p>Rechten geef je per gebruiker; je kunt ze ook weer intrekken.</p>' +
        gebruikers.map(function (g) {
          return '<div class="product" data-gebruiker="' + g.id + '">' +
            '<div class="naam"><strong>' + esc(g.naam) + '</strong>' +
            '<small>' + esc(g.rol) + ' · ' + Object.keys(g.rechten || {}).filter(function (r) { return g.rechten[r]; }).length + ' rechten</small></div>' +
            '<button class="klein" type="button" data-gebruiker-wijzig="' + g.id + '">Wijzigen</button>' +
            '</div>';
        }).join('') +
        '<div class="knoppen"><button type="button" data-gebruiker-nieuw="1">Gebruiker toevoegen</button></div>' +
        '</div>' : '') +

      (staat.recht('bijwerken') ? '<div class="kaart">' +
        '<h2>Adres van de app</h2>' +
        '<p>Hier staan de QR-links naar. Laat leeg om het adres van het verzoek te gebruiken.</p>' +
        '<label for="basis">Vast adres</label>' +
        '<input id="basis" placeholder="https://…" value="' + esc(instellingen ? (instellingen.basisAdres || '') : '') + '">' +
        '<p class="klein" style="margin-top:8px">Nu in gebruik: ' + esc(instellingen ? instellingen.effectief : 'onbekend') + '</p>' +
        '<div class="knoppen"><button type="button" id="bewaar-basis">Bewaren</button></div>' +
        '<div id="basis-melding"></div>' +
        '</div>' : '') +

      '<div class="kaart">' +
      '<h2>Uitloggen</h2>' +
      '<div class="knoppen"><button type="button" id="uitloggen">Uitloggen</button></div>' +
      '</div>';

    var controleer = $('#controleer');
    if (controleer) controleer.addEventListener('click', async function () {
      toonMelding('#versie-melding', 'Even kijken wat er op GitHub staat…');
      try {
        var u = await api('/api/versie/controle');
        if (u.laatste && u.laatste.fout) return toonMelding('#versie-melding', u.laatste.fout, 'fout');
        if (u.nieuwer) {
          toonMelding('#versie-melding', 'Er staat iets nieuws klaar: "' + (u.laatste.boodschap || 'nieuwe versie') + '". ' +
            (u.updateMogelijk ? 'Gebruik de knop Bijwerken.' : 'Draai het bijwerkcommando op je host.'), 'let-op');
        } else {
          toonMelding('#versie-melding', 'Je draait de nieuwste versie.', 'goed');
        }
      } catch (e) { toonMelding('#versie-melding', e.message, 'fout'); }
    });

    var bijwerken = $('#bijwerken');
    if (bijwerken) bijwerken.addEventListener('click', function () {
      toonMelding('#versie-melding', 'Bijwerken gebeurt op de host, niet hier. Het commando staat in de README. ' +
        'De app is daarna even niet bereikbaar (Cloudflare 1033 of 502); wacht tien tellen en herlaad.', 'let-op');
    });

    var bewaarBasis = $('#bewaar-basis');
    if (bewaarBasis) bewaarBasis.addEventListener('click', async function () {
      try {
        await api('/api/instellingen', { methode: 'PATCH', lichaam: { basisAdres: $('#basis').value.trim() } });
        toonMelding('#basis-melding', 'Bewaard. Nieuwe stickers gebruiken dit adres.', 'goed');
      } catch (e) { toonMelding('#basis-melding', e.message, 'fout'); }
    });

    $('#uitloggen').addEventListener('click', async function () {
      try { await api('/api/uitloggen', { methode: 'POST' }); } catch (e) { /* toch doorgaan */ }
      staat.gebruiker = null;
      bewaarGebruiker(null);
      schermInloggen();
    });
  }

  function toonMelding(doel, tekst, soort) {
    var vak = $(doel);
    if (vak) vak.innerHTML = '<div class="melding ' + (soort || '') + '">' + esc(tekst) + '</div>';
  }

  // ------------------------------------------------------------- routeren ---
  function huidig() {
    var pad = String(location.hash || '').replace(/^#\/?/, '');
    var delen = pad.split('?');
    var naam = delen[0] || 'bakken';
    var vraag = new URLSearchParams(delen[1] || '');
    return { naam: naam, vraag: vraag };
  }

  function ga(nieuw) {
    location.hash = '#/' + nieuw;
  }

  async function teken() {
    wisMelding();
    if (!staat.gebruiker) { schermInloggen(); return; }
    var route = huidig();
    var delen = route.naam.split('/');
    try {
      if (delen[0] === 'bak' && delen[1]) return await schermBak(delen[1]);
      if (route.naam === 'scan') return schermScannen(route.vraag.get('code') || '');
      if (route.naam === 'codes') return await schermCodes();
      if (route.naam === 'codes/nieuw') return schermNieuweCodes();
      if (route.naam === 'print') return await schermPrint(route.vraag.get('codes') || '');
      if (route.naam === 'beheer') return await schermBeheer();
      if (route.naam === 'bak/nieuw') return schermNieuweBak();
      return schermBakken();
    } catch (e) {
      app.innerHTML = '<div class="melding fout">' + esc(e.message) + '</div>';
    }
  }

  // Klikken en tikken op één plek afhandelen: minder losse listeners.
  document.addEventListener('click', async function (e) {
    var knop = e.target.closest('[data-ga],[data-bak],[data-nieuw],[data-tel],[data-sticker],[data-verwijder],[data-wijzig],[data-hernoem],[data-code-weg],[data-koppel],[data-open-bak],[data-nieuwe-codes],[data-print],[data-product-nieuw],[data-gebruiker-nieuw],[data-gebruiker-wijzig],[data-foto-weg]');
    if (!knop) return;

    if (knop.dataset.ga) return ga(knop.dataset.ga);
    if (knop.dataset.bak) return ga('bak/' + knop.dataset.bak);
    if (knop.dataset.openBak) return ga('bak/' + knop.dataset.openBak);
    if (knop.dataset.nieuw) return ga('bak/nieuw');
    if (knop.dataset.nieuweCodes) return ga('codes/nieuw');
    if (knop.dataset.print) return ga('print');
    if (knop.dataset.wijzig) return wijzigBak(knop.dataset.wijzig);
    if (knop.dataset.sticker) return maakSticker(knop.dataset.sticker);
    if (knop.dataset.verwijder) return verwijderBak(knop.dataset.verwijder);
    if (knop.dataset.productNieuw) return voegProductToe(knop.dataset.productNieuw);
    if (knop.dataset.hernoem) return hernoemCode(knop.dataset.hernoem);
    if (knop.dataset.koppel) return koppelCodeAanBak(knop.dataset.koppel);
    if (knop.dataset.codeWeg) return verwijderCode(knop.dataset.codeWeg);
    if (knop.dataset.gebruikerNieuw) return nieuweGebruiker();
    if (knop.dataset.gebruikerWijzig) return wijzigGebruiker(knop.dataset.gebruikerWijzig);
    if (knop.dataset.fotoWeg) return verwijderFoto(knop.dataset.fotoWeg);

    if (knop.dataset.tel) {
      var verschil = Number(knop.dataset.verschil);
      return telProduct(knop.dataset.tel, verschil);
    }
  });

  // Foto's: eerst op het toestel verkleinen, dan pas versturen. Anders is één
  // foto groter dan de app zelf.
  document.addEventListener('change', function (e) {
    if (e.target && (e.target.id === 'foto' || e.target.id === 'foto-kies')) {
      var bestand = e.target.files && e.target.files[0];
      if (bestand) fotoToevoegen(bestand);
      e.target.value = '';
    }
  });

  async function fotoToevoegen(bestand) {
    var bakRoute = huidig().naam.split('/');
    var bakId = bakRoute[1];
    var vak = $('#foto-melding');
    if (vak) vak.innerHTML = '<div class="melding">Foto wordt verkleind…</div>';
    try {
      var beeld = await verklein(bestand, 1600);
      var uit = await api('/api/bakken/' + bakId + '/fotos', {
        methode: 'POST',
        lichaam: { data: beeld.dataUrl, breedte: beeld.breedte, hoogte: beeld.hoogte }
      });
      void uit;
      await schermBak(bakId);
      toonMelding('#foto-melding', 'De foto staat erbij.', 'goed');
    } catch (e) {
      if (vak) vak.innerHTML = '<div class="melding fout">' + esc(e.message) + '</div>';
    }
  }

  function verklein(bestand, langsteZijde) {
    return new Promise(function (klaar, mis) {
      var lezer = new FileReader();
      lezer.onerror = function () { mis(new Error('De foto kon niet gelezen worden.')); };
      lezer.onload = function () {
        var beeld = new Image();
        beeld.onerror = function () { mis(new Error('Dit bestand is geen leesbare foto.')); };
        beeld.onload = function () {
          var schaal = Math.min(1, langsteZijde / Math.max(beeld.width, beeld.height));
          var doek = document.createElement('canvas');
          doek.width = Math.round(beeld.width * schaal);
          doek.height = Math.round(beeld.height * schaal);
          var teken = doek.getContext('2d');
          teken.drawImage(beeld, 0, 0, doek.width, doek.height);
          klaar({
            dataUrl: doek.toDataURL('image/jpeg', 0.82),
            breedte: doek.width,
            hoogte: doek.height
          });
        };
        beeld.src = String(lezer.result);
      };
      lezer.readAsDataURL(bestand);
    });
  }

  async function verwijderFoto(id) {
    if (!confirm('Deze foto verwijderen?')) return;
    try {
      await api('/api/fotos/' + id, { methode: 'DELETE' });
      await schermBak(huidig().naam.split('/')[1]);
    } catch (e) { alert(e.message); }
  }

  async function telProduct(id, verschil) {
    var knop = document.querySelector('[data-tel="' + id + '"][data-verschil="' + verschil + '"]');
    if (knop) knop.disabled = true;
    try {
      await api('/api/items/' + id + '/tel', { methode: 'POST', lichaam: { verschil: verschil } });
      await schermBak(huidig().naam.split('/')[1]);
    } catch (e) {
      // Offline: de telling gaat de wachtrij in, de kaart laat het meteen zien.
      if (!e.status) {
        zetInWachtrij({ pad: '/api/items/' + id + '/tel', methode: 'POST', lichaam: { verschil: verschil } });
        toonMelding('#inhoud', 'Geen verbinding: de telling gaat naar de wachtrij en wordt later verstuurd.', 'let-op');
      } else {
        alert(e.message);
      }
      if (knop) knop.disabled = false;
    }
  }

  async function voegProductToe(bakId) {
    var naam = prompt('Welk product zit erin?');
    if (!naam) return;
    var aantalRuw = prompt('Hoeveel?', '1');
    if (aantalRuw === null) return;
    var eenheid = prompt('Eenheid (mag leeg blijven, bijvoorbeeld doos of stuk)', '');
    try {
      await api('/api/bakken/' + bakId + '/items', {
        methode: 'POST',
        lichaam: { naam: naam, aantal: Number(aantalRuw) || 0, eenheid: eenheid || '' }
      });
      await schermBak(bakId);
    } catch (e) { alert(e.message); }
  }

  async function wijzigBak(id) {
    var huidigeBak = staat.bak && String(staat.bak.bak.id) === String(id) ? staat.bak.bak : null;
    if (!huidigeBak) return;
    var naam = prompt('Naam van de bak', huidigeBak.naam);
    if (naam === null) return;
    var locatie = prompt('Locatie', huidigeBak.locatie || '');
    if (locatie === null) return;
    var omschrijving = prompt('Omschrijving', huidigeBak.omschrijving || '');
    if (omschrijving === null) return;
    try {
      await api('/api/bakken/' + id, { methode: 'PATCH', lichaam: { naam: naam, locatie: locatie, omschrijving: omschrijving } });
      await laadBakken();
      await schermBak(id);
    } catch (e) { alert(e.message); }
  }

  async function verwijderBak(id) {
    if (!confirm('Deze bak en zijn voorraad verwijderen? Dat kan niet terug.')) return;
    try {
      await api('/api/bakken/' + id, { methode: 'DELETE' });
      await laadBakken();
      ga('bakken');
    } catch (e) { alert(e.message); }
  }

  async function maakSticker(bakId) {
    var naam = prompt('Welke naam krijgt deze sticker?', (staat.bak && staat.bak.bak.naam) || '');
    if (naam === null) return;
    try {
      var uit = await api('/api/codes', { methode: 'POST', lichaam: { aantal: 1, naam: naam } });
      var code = uit.codes[0].code;
      await api('/api/codes/' + code, { methode: 'PATCH', lichaam: { bakId: Number(bakId), status: 'geplakt' } });
      await laadCodes();
      await schermBak(bakId);
    } catch (e) { alert(e.message); }
  }

  async function hernoemCode(code) {
    var gevonden = staat.codes.filter(function (c) { return c.code === code; })[0];
    var naam = prompt('Nieuwe naam voor deze code', gevonden ? (gevonden.naam || '') : '');
    if (naam === null) return;
    try {
      await api('/api/codes/' + code, { methode: 'PATCH', lichaam: { naam: naam } });
      await laadCodes();
      schermCodes();
    } catch (e) { alert(e.message); }
  }

  async function koppelCodeAanBak(code) {
    await laadBakken();
    var namen = staat.bakken.map(function (b, i) { return (i + 1) + '. ' + b.naam; }).join('\n');
    if (!namen) return alert('Maak eerst een bak aan.');
    var keuze = prompt('Aan welke bak hangt deze code?\n\n' + namen, '1');
    if (keuze === null) return;
    var bak = staat.bakken[Number(keuze) - 1];
    if (!bak) return alert('Dat nummer bestaat niet.');
    try {
      await api('/api/codes/' + code, { methode: 'PATCH', lichaam: { bakId: bak.id, status: 'geplakt' } });
      await laadCodes();
      schermCodes();
    } catch (e) { alert(e.message); }
  }

  async function verwijderCode(code) {
    if (!confirm('Deze code verwijderen? De sticker op de bak werkt daarna niet meer.')) return;
    try {
      await api('/api/codes/' + code, { methode: 'DELETE' });
      await laadCodes();
      schermCodes();
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------------------- accounts ---
  function nieuweGebruiker() {
    var naam = prompt('Gebruikersnaam');
    if (!naam) return;
    var wachtwoord = prompt('Wachtwoord (minstens 10 tekens)');
    if (!wachtwoord) return;
    var rol = prompt('Rol: beheerder of gebruiker', 'gebruiker');
    if (rol === null) return;
    api('/api/gebruikers', { methode: 'POST', lichaam: { naam: naam, wachtwoord: wachtwoord, rol: rol } })
      .then(function () { schermBeheer(); })
      .catch(function (e) { alert(e.message); });
  }

  async function wijzigGebruiker(id) {
    var uit;
    try {
      uit = await api('/api/gebruikers');
    } catch (e) { return alert(e.message); }
    var gebruiker = (uit.gebruikers || []).filter(function (g) { return String(g.id) === String(id); })[0];
    if (!gebruiker) return;
    var rol = prompt('Rol: beheerder of gebruiker', gebruiker.rol);
    if (rol === null) return;
    var huidige = gebruiker.rechten || {};
    var antwoord = prompt('Rechten als lijst, met een komma ertussen. Laat weg wat iemand niet mag.\n\n' +
      (uit.rechten || []).map(function (r) { return r.recht + ' (' + r.uitleg + ')'; }).join('\n'),
      Object.keys(huidige).filter(function (r) { return huidige[r]; }).join(', '));
    if (antwoord === null) return;
    var nieuwe = {};
    antwoord.split(',').forEach(function (r) { if (r.trim()) nieuwe[r.trim()] = true; });
    try {
      await api('/api/gebruikers/' + id, { methode: 'PATCH', lichaam: { rol: rol.trim(), rechten: nieuwe } });
      schermBeheer();
    } catch (e) { alert(e.message); }
  }

  // ---------------------------------------------------------------- start ---
  async function start() {
    // Een sticker is een link naar /b/<CODE>; die opent meteen het scannen.
    var opPad = /^\/b\/([0-9A-Za-z]{1,12})\/?$/.exec(location.pathname);
    try {
      var status = await api('/api/status');
      staat.ingesteld = Boolean(status.ingesteld);
    } catch (e) {
      staat.offline = true;
      staat.ingesteld = true; // we proberen het gewoon met wat er op het toestel staat
    }

    if (!staat.ingesteld) return schermInstellen();

    try {
      var ik = await api('/api/ik');
      staat.gebruiker = ik.gebruiker;
      bewaarGebruiker(ik.gebruiker);
    } catch (e) {
      // Offline: de server kan niet bevestigen wie je bent. Ga door met de
      // gebruiker van de vorige keer, zodat scannen en kijken blijven werken.
      staat.gebruiker = staat.offline ? leesGebruiker() : null;
    }

    if (!staat.gebruiker) {
      schermInloggen();
      if (opPad) sessionStorage.setItem('bakken.na-het-inloggen', opPad[1]);
      return;
    }

    await laadBakken().catch(function () {});
    if (opPad) return ga('scan?code=' + encodeURIComponent(opPad[1]));
    teken();
  }

  window.addEventListener('hashchange', teken);
  window.addEventListener('online', async function () {
    staat.offline = false;
    var gedaan = await verwerkWachtrij().catch(function () { return 0; });
    if (gedaan) await laadBakken().catch(function () {});
    teken();
  });
  window.addEventListener('offline', function () { staat.offline = true; });

  // Na het inloggen alsnog de gescande sticker openen.
  var naInloggen = sessionStorage.getItem('bakken.na-het-inloggen');
  if (naInloggen) {
    sessionStorage.removeItem('bakken.na-het-inloggen');
    window.addEventListener('bakken-ingelogd', function () { ga('scan?code=' + encodeURIComponent(naInloggen)); });
  }

  start();
})();
