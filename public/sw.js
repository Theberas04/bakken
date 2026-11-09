/* eslint-disable */
// De schil van de app in de cache. Hierdoor opent een gescande sticker
// (/b/<CODE>) ook zonder internet, en blijft de app zelf werken.
//
// Let op: bij elke wijziging van de pagina's moet de cachenaam hieronder omhoog,
// anders houdt de telefoon de oude versie vast.
var CACHE = 'bakken-schil-v11';

var SCHIL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/lib/qrcode.js',
  '/lib/qr.js',
  '/icon.svg',
  '/manifest.webmanifest'
];

// De schil ophalen met cache: 'reload'. Zonder dat pakt de service worker bij
// een nieuwe versie het bestand uit de HTTP-cache van de telefoon, en dan blijft
// de oude app staan ook al is de cachenaam opgehoogd (de server stuurt
// max-age=300 mee). Zo krijgt elke nieuwe versie echt nieuwe bestanden.
function haalVers(pad) {
  return fetch(new Request(pad, { cache: 'reload' }));
}

self.addEventListener('install', function (gebeurtenis) {
  self.skipWaiting();
  gebeurtenis.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SCHIL.map(function (pad) {
        return haalVers(pad).then(function (antwoord) {
          if (antwoord && antwoord.ok) return cache.put(pad, antwoord);
        }).catch(function () {
          // Eén ontbrekend bestand mag de hele installatie niet laten mislukken.
        });
      }));
    })
  );
});

self.addEventListener('activate', function (gebeurtenis) {
  gebeurtenis.waitUntil(
    caches.keys().then(function (namen) {
      return Promise.all(namen.map(function (naam) {
        if (naam !== CACHE) return caches.delete(naam);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (gebeurtenis) {
  var verzoek = gebeurtenis.request;

  // Alleen lezen; wat de app stuurt gaat altijd rechtstreeks naar de server.
  if (verzoek.method !== 'GET') return;

  var adres = new URL(verzoek.url);
  // Een andere site of een foto: niet aanraken.
  if (adres.origin !== self.location.origin) return;
  // Gegevens komen nooit uit de cache: de app houdt zelf bij wat hij offline heeft.
  if (adres.pathname.indexOf('/api/') === 0) return;
  if (adres.pathname.indexOf('/media/') === 0) return;

  // Een link die je opent (ook /b/<CODE>): eerst het net, anders de schil.
  if (verzoek.mode === 'navigate') {
    gebeurtenis.respondWith(
      fetch(verzoek).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // De rest: uit de cache, en ondertussen stil bijwerken.
  gebeurtenis.respondWith(
    caches.match(verzoek).then(function (uitCache) {
      var vanHetNet = fetch(verzoek).then(function (antwoord) {
        if (antwoord && antwoord.ok) {
          var kopie = antwoord.clone();
          caches.open(CACHE).then(function (cache) { cache.put(verzoek, kopie); });
        }
        return antwoord;
      }).catch(function () { return uitCache; });
      return uitCache || vanHetNet;
    })
  );
});
