'use strict';
// De server van Bakken: één Node-service die de API, de web-app en de PWA-bestanden
// uit `public/` levert. Geen npm-afhankelijkheden, geen losse webserver ervoor.
//
// Het adres van de app staat nergens in de code: het komt uit het verzoek zelf
// (Cloudflare geeft het oorspronkelijke adres door) of uit de instelling
// `basis_adres` in de database. Zo kan dit repo publiek staan.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const db = require('./lib/db');
const accounts = require('./lib/accounts');
const rechten = require('./lib/rechten');
const versie = require('./lib/versie');
const codes = require('./lib/codes');

const VERSIE = '0.5.1';
const REPO = 'Theberas04/bakken';
const VERSIE_BRON = 'https://raw.githubusercontent.com/' + REPO + '/main/VERSIE.json';
const UPDATE_SCRIPT_STANDAARD = 'deploy/proxmox/bijwerken-in-de-app.sh';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
};

const MAX_LOGINPOGINGEN = 8;
// Foto's: hoeveel per bak en hoe groot het bestand mag zijn. De app verkleint
// eerst op het toestel, dus dit is een bovengrens, geen richtlijn.
const MAX_FOTOS_PER_BAK = 12;
const MAX_FOTO_BYTES = 8 * 1024 * 1024;
const LOGINVENSTER_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- helpers ---

function stuurJson(res, code, gegevens, koppen) {
  const lichaam = JSON.stringify(gegevens);
  res.writeHead(code, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(lichaam)
  }, koppen || {}));
  res.end(res.req && res.req.method === 'HEAD' ? undefined : lichaam);
}

function stuurTekst(res, code, tekst) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : tekst);
}

function leesJson(req, limiet) {
  const grens = limiet || 1024 * 1024;
  return new Promise((klaar, mis) => {
    const stukken = [];
    let lengte = 0;
    req.on('data', (stuk) => {
      lengte += stuk.length;
      if (lengte > grens) {
        mis(new Error('Het verzoek is te groot'));
        req.destroy();
        return;
      }
      stukken.push(stuk);
    });
    req.on('end', () => {
      const tekst = Buffer.concat(stukken).toString('utf8').trim();
      if (!tekst) return klaar({});
      try {
        klaar(JSON.parse(tekst));
      } catch (e) {
        mis(new Error('Onleesbare gegevens in het verzoek'));
      }
    });
    req.on('error', mis);
  });
}

function eersteKop(waarde) {
  return String(waarde || '').split(',')[0].trim();
}

// Achter Cloudflare staat het echte adres in de doorgestuurde koppen.
function verzoekIsHttps(req) {
  const proto = eersteKop(req.headers['x-forwarded-proto']);
  if (proto) return proto === 'https';
  return Boolean(req.socket && req.socket.encrypted);
}

function adresVanVerzoek(req) {
  const proto = eersteKop(req.headers['x-forwarded-proto']) ||
    (req.socket && req.socket.encrypted ? 'https' : 'http');
  const gastheer = eersteKop(req.headers['x-forwarded-host']) || eersteKop(req.headers.host);
  if (!gastheer) return '';
  return proto + '://' + gastheer;
}

// ------------------------------------------------------------- de app ------

function maakApp(opties) {
  const o = opties || {};
  const dataDir = o.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPad = o.dbPath || process.env.DB_PATH || path.join(dataDir, 'bakken.db');
  const mediaDir = o.mediaDir || process.env.MEDIA_DIR || path.join(dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const publiek = o.publiek || path.join(__dirname, 'public');
  const versieBron = o.versieBron || process.env.VERSIE_BRON || VERSIE_BRON;
  const updateScript = o.updateScript !== undefined ? o.updateScript : (process.env.UPDATE_SCRIPT || '');
  const appVersie = o.versie || process.env.VERSIE || VERSIE;
  const databank = db.openDatabase(dbPad);
  const pogingen = new Map();
  const gestartOp = new Date().toISOString();

  function basisAdres(req) {
    const ingesteld = String(db.leesInstelling(databank, 'basis_adres', '') || '').trim();
    return (ingesteld || adresVanVerzoek(req)).replace(/\/+$/, '');
  }

  function korteCommit() {
    const schoon = (waarde) => {
      const uit = String(waarde || '').trim().split(/\s+/)[0].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
      return uit.length >= 7 ? uit.slice(0, 7) : '';
    };
    const uitOmgeving = schoon(process.env.GIT_COMMIT || process.env.VERSIE_COMMIT || '');
    if (uitOmgeving) return uitOmgeving;
    for (const bestand of [path.join(dataDir, 'commit.txt'), path.join(__dirname, 'commit.txt')]) {
      try {
        if (fs.existsSync(bestand)) {
          const uitBestand = schoon(fs.readFileSync(bestand, 'utf8'));
          if (uitBestand) return uitBestand;
        }
      } catch (e) { /* niet te lezen: dan weten we het niet */ }
    }
    return '';
  }

  function updateMogelijk() {
    if (!updateScript) return false;
    try {
      return fs.existsSync(updateScript) && Boolean(fs.statSync(updateScript).mode & 0o111);
    } catch (e) {
      return false;
    }
  }

  function updateCommando() {
    return 'bash -c "$(curl -fsSL https://raw.githubusercontent.com/' + REPO +
      '/main/deploy/proxmox/update-from-github.sh)"';
  }

  // Wat staat er op GitHub? Alleen om te melden dat er iets nieuws is. Lukt het
  // niet (geen internet), dan zeggen we dat en beweren we niets.
  async function laatsteVersieOpGitHub() {
    const afbreker = new AbortController();
    const stop = setTimeout(() => afbreker.abort(), 6000);
    try {
      const antwoord = await fetch(versieBron, {
        headers: { 'accept': 'application/json', 'user-agent': 'bakken' },
        signal: afbreker.signal
      });
      if (!antwoord.ok) return { fout: 'GitHub antwoordde ' + antwoord.status + '. Probeer het later opnieuw.' };
      const gegevens = await antwoord.json();
      return {
        versie: String(gegevens.versie || ''),
        commit: String(gegevens.commit || '').slice(0, 7),
        boodschap: String(gegevens.boodschap || '').split('\n')[0].slice(0, 120),
        datum: String(gegevens.datum || '')
      };
    } catch (e) {
      return { fout: 'Geen verbinding met GitHub. Controleer je internet en probeer het opnieuw.' };
    } finally {
      clearTimeout(stop);
    }
  }

  // Een foto komt binnen als base64 (de app verkleint hem eerst op het toestel).
  // We kijken zelf naar de eerste bytes: een bestand dat geen foto is, gaat niet
  // naar de schijf, ook niet als de naam of het soort iets anders zegt.
  function fotoSoort(buffer) {
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
    if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { ext: 'png', mime: 'image/png' };
    }
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { ext: 'webp', mime: 'image/webp' };
    }
    return null;
  }

  function bewaarFoto(bakId, lichaam) {
    const bak = db.haalBak(databank, bakId);
    if (!bak) throw new Error('Deze bak bestaat niet.');
    const bestaand = db.lijstFotos(databank, bakId);
    if (bestaand.length >= MAX_FOTOS_PER_BAK) {
      throw new Error('Deze bak heeft al ' + MAX_FOTOS_PER_BAK + " foto's. Verwijder er eerst een.");
    }
    const gegevens = String((lichaam && lichaam.data) || '');
    const ruw = gegevens.replace(/^data:[^;]*;base64,/, '');
    if (!ruw) throw new Error('Er zit geen foto in dit verzoek.');
    const buffer = Buffer.from(ruw, 'base64');
    if (!buffer.length) throw new Error('De foto is leeg.');
    if (buffer.length > MAX_FOTO_BYTES) {
      throw new Error('De foto is te groot (maximaal ' + Math.round(MAX_FOTO_BYTES / 1024 / 1024) + ' MB).');
    }
    const soort = fotoSoort(buffer);
    if (!soort) throw new Error('Dit bestand is geen JPEG-, PNG- of WebP-foto.');
    const naam = bakId + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + soort.ext;
    fs.writeFileSync(path.join(mediaDir, naam), buffer);
    return db.voegFotoToe(databank, bakId, {
      bestand: naam,
      soort: soort.mime,
      breedte: Number(lichaam && lichaam.breedte) || 0,
      hoogte: Number(lichaam && lichaam.hoogte) || 0,
      opServer: true
    });
  }

  function versieOverzicht() {
    return {
      versie: appVersie,
      commit: korteCommit(),
      gestartOp,
      updateMogelijk: updateMogelijk(),
      updateScript: updateMogelijk() ? updateScript : '',
      updateCommando: updateCommando()
    };
  }

  // ------------------------------------------------------------ inloggen ---
  function adresVan(req) {
    return eersteKop(req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'onbekend';
  }

  function teVeelPogingen(req) {
    const staat = pogingen.get(adresVan(req));
    if (!staat) return false;
    if (Date.now() - staat.sinds > LOGINVENSTER_MS) return false;
    return staat.aantal >= MAX_LOGINPOGINGEN;
  }

  function misluktePoging(req) {
    const adres = adresVan(req);
    const staat = pogingen.get(adres) || { aantal: 0, sinds: Date.now() };
    if (Date.now() - staat.sinds > LOGINVENSTER_MS) {
      staat.aantal = 0;
      staat.sinds = Date.now();
    }
    staat.aantal += 1;
    pogingen.set(adres, staat);
  }

  function beginSessie(req, res, gebruiker) {
    const token = accounts.nieuwToken();
    db.bewaarSessie(databank, token, gebruiker.id, accounts.SESSIE_DAGEN);
    const koekje = accounts.sessieKoekje(token, { secure: verzoekIsHttps(req) || o.koekjeSecure === true });
    stuurJson(res, 200, { gebruiker: db.zonderAfdruk(gebruiker) }, { 'set-cookie': koekje });
  }

  function eisRecht(res, gebruiker, recht) {
    if (rechten.heeftRecht(gebruiker, recht)) return true;
    stuurJson(res, 403, { fout: 'Dit hoort bij een recht dat jouw account niet heeft: ' + recht + '.' });
    return false;
  }

  // ------------------------------------------------------------- statisch ---
  function stuurBestand(res, pad, kop) {
    try {
      const staat = fs.statSync(pad);
      if (!staat.isFile()) return false;
      const soort = MIME[path.extname(pad).toLowerCase()] || 'application/octet-stream';
      res.writeHead(kop || 200, {
        'content-type': soort,
        'content-length': staat.size,
        // De service worker regelt de cache; de server houdt het kort.
        'cache-control': path.basename(pad) === 'sw.js' ? 'no-store' : 'public, max-age=300'
      });
      fs.createReadStream(pad).pipe(res);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stuurStatisch(req, res, pad) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    // Een gescande sticker is een link naar /b/<CODE>; die hoort de app te openen.
    if (/^\/b\/[0-9A-Za-z]{1,12}$/.test(pad)) {
      return stuurBestand(res, path.join(publiek, 'index.html'));
    }

    const gevraagd = pad === '/' ? '/index.html' : pad;
    const schoon = path.normalize(decodeURIComponent(gevraagd)).replace(/^(\.\.[/\\])+/, '');
    const volledig = path.join(publiek, schoon);
    if (!volledig.startsWith(publiek + path.sep)) return false;
    if (stuurBestand(res, volledig)) return true;
    // Een route van de app (zonder bestand) valt terug op de pagina zelf.
    if (!path.extname(volledig)) return stuurBestand(res, path.join(publiek, 'index.html'));
    return false;
  }

  // --------------------------------------------------------------- routes ---
  async function verwerk(req, res) {
    res.req = req;
    const gastheer = eersteKop(req.headers.host) || 'localhost';
    let pad;
    try {
      pad = new URL(req.url, 'http://' + gastheer).pathname;
    } catch (e) {
      return stuurJson(res, 400, { fout: 'Onbegrijpelijk adres' });
    }
    const methode = String(req.method || 'GET').toUpperCase();

    try {
      // Openbaar: geen sessie nodig, en niets dat iets prijsgeeft.
      if (pad === '/healthz') return stuurTekst(res, 200, 'ok bakken ' + appVersie);
      if (pad === '/api/status' && (methode === 'GET' || methode === 'HEAD')) {
        return stuurJson(res, 200, {
          ingesteld: db.lijstGebruikers(databank).length > 0,
          versie: appVersie
        });
      }
      if (pad === '/api/instellen' && methode === 'POST') {
        if (db.lijstGebruikers(databank).length > 0) {
          return stuurJson(res, 403, { fout: 'De app is al ingesteld.' });
        }
        if (teVeelPogingen(req)) return stuurJson(res, 429, { fout: 'Te veel pogingen. Probeer het straks opnieuw.' });
        const lichaam = await leesJson(req);
        try {
          const afdruk = accounts.maakAfdruk(lichaam.wachtwoord);
          const gebruiker = db.voegGebruikerToe(databank, {
            naam: lichaam.naam || 'Tom',
            rol: 'beheerder',
            afdruk
          });
          return beginSessie(req, res, gebruiker);
        } catch (e) {
          misluktePoging(req);
          return stuurJson(res, 400, { fout: e.message });
        }
      }
      if (pad === '/api/inloggen' && methode === 'POST') {
        if (teVeelPogingen(req)) return stuurJson(res, 429, { fout: 'Te veel pogingen. Probeer het straks opnieuw.' });
        const lichaam = await leesJson(req);
        const gebruiker = db.zoekGebruikerOpNaam(databank, lichaam.naam);
        if (!gebruiker || !accounts.controleerAfdruk(lichaam.wachtwoord, gebruiker.afdruk)) {
          misluktePoging(req);
          return stuurJson(res, 401, { fout: 'Onbekende gebruikersnaam of verkeerd wachtwoord.' });
        }
        pogingen.delete(adresVan(req));
        return beginSessie(req, res, gebruiker);
      }
      if (pad === '/api/uitloggen' && methode === 'POST') {
        db.verwijderSessie(databank, accounts.tokenUitVerzoek(req));
        return stuurJson(res, 200, { uitgelogd: true }, { 'set-cookie': accounts.wisKoekje() });
      }

      // De app zelf (en de PWA-bestanden) laden zonder sessie; de gegevens erin
      // komen pas met een sessie.
      if (!pad.startsWith('/api/') && stuurStatisch(req, res, pad)) return;
      if (pad.startsWith('/api/') === false) return stuurJson(res, 404, { fout: 'Niet gevonden' });

      const gebruiker = db.gebruikerBijToken(databank, accounts.tokenUitVerzoek(req));
      if (!gebruiker) return stuurJson(res, 401, { fout: 'Log eerst in.' });
      return await api(req, res, gebruiker, pad, methode);
    } catch (e) {
      return stuurJson(res, 400, { fout: e.message || 'Er ging iets mis' });
    }
  }

  async function api(req, res, gebruiker, pad, methode) {
    // Wie ben ik / uitloggen
    if (pad === '/api/ik' && methode === 'GET') {
      return stuurJson(res, 200, { gebruiker: db.zonderAfdruk(gebruiker) });
    }

    // Versie
    if (pad === '/api/versie' && methode === 'GET') {
      return stuurJson(res, 200, versieOverzicht());
    }
    if (pad === '/api/versie/controle' && methode === 'GET') {
      if (!eisRecht(res, gebruiker, 'bijwerken')) return;
      const laatste = await laatsteVersieOpGitHub();
      if (laatste.fout) return stuurJson(res, 200, { laatste, nieuwer: false, hier: korteCommit(), versie: appVersie, updateMogelijk: updateMogelijk() });
      const hier = korteCommit();
      const nieuwer = versie.vergelijkVersie(laatste.versie, appVersie) > 0 ||
        versie.isNieuwereVersie(laatste.commit, hier);
      return stuurJson(res, 200, {
        laatste,
        hier,
        versie: appVersie,
        nieuwer,
        updateMogelijk: updateMogelijk(),
        updateCommando: updateCommando()
      });
    }
    // Bijwerken vanuit de app: hetzelfde als bij AkkoordKast. Het script haalt de nieuwste
    // bestanden van GitHub, legt ze op hun plek en laat de dienst opnieuw starten. Daarna stopt
    // dit proces; systemd (Restart=always) start hem op met de nieuwe code.
    if (pad === '/api/update' && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'bijwerken')) return;
      if (!updateMogelijk()) {
        return stuurJson(res, 400, {
          fout: 'Bijwerken vanuit de app staat niet aan op deze machine. Draai het bijwerkcommando op je Proxmox-host.',
          commando: updateCommando()
        });
      }
      const uitkomst = spawnSync('bash', [updateScript], {
        cwd: __dirname, encoding: 'utf8', timeout: 180000
      });
      const uitvoer = ((uitkomst.stdout || '') + (uitkomst.stderr || '')).slice(-4000);
      if (uitkomst.status === 0) {
        stuurJson(res, 200, { ok: true, uitvoer, commando: updateScript, herstart: true });
        console.log('bijgewerkt; de dienst start opnieuw op met de nieuwe versie');
        setTimeout(() => { try { process.exit(0); } catch (e) { /* al weg */ } }, 1200);
      } else {
        stuurJson(res, 500, {
          fout: 'Het bijwerken stopte met code ' + uitkomst.status + '. De oude versie blijft draaien.',
          uitvoer, commando: updateScript
        });
      }
      return;
    }

    // Instellingen (het adres van de app, voor de QR-links)
    if (pad === '/api/instellingen' && methode === 'GET') {
      return stuurJson(res, 200, {
        basisAdres: String(db.leesInstelling(databank, 'basis_adres', '')),
        effectief: basisAdres(req),
        voorstel: adresVanVerzoek(req)
      });
    }
    if (pad === '/api/instellingen' && methode === 'PATCH') {
      if (!eisRecht(res, gebruiker, 'bijwerken')) return;
      const lichaam = await leesJson(req);
      const waarde = String(lichaam.basisAdres || '').trim().replace(/\/+$/, '');
      if (waarde && !/^https?:\/\/[^\s]+$/.test(waarde)) {
        return stuurJson(res, 400, { fout: 'Een adres begint met http:// of https://' });
      }
      db.zetInstelling(databank, 'basis_adres', waarde);
      return stuurJson(res, 200, { basisAdres: waarde, effectief: basisAdres(req) });
    }

    // Bakken
    if (pad === '/api/bakken' && methode === 'GET') {
      if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
      return stuurJson(res, 200, { bakken: db.lijstBakken(databank) });
    }
    if (pad === '/api/bakken' && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
      return stuurJson(res, 201, { bak: db.voegBakToe(databank, await leesJson(req)) });
    }

    let m = /^\/api\/bakken\/(\d+)$/.exec(pad);
    if (m) {
      const id = Number(m[1]);
      if (methode === 'GET') {
        if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
        const bak = db.haalBak(databank, id);
        if (!bak) return stuurJson(res, 404, { fout: 'Deze bak bestaat niet.' });
        // De sticker hoort bij de bak: de app toont hem meteen, zonder extra ronde.
        const sticker = db.codeVanBak(databank, id);
        return stuurJson(res, 200, {
          bak: Object.assign({}, bak, {
            code: sticker ? sticker.code : null,
            codeNaam: sticker ? sticker.naam : ''
          }),
          producten: db.lijstItems(databank, id),
          fotos: db.lijstFotos(databank, id)
        });
      }
      if (methode === 'PATCH' || methode === 'PUT') {
        if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
        return stuurJson(res, 200, { bak: db.wijzigBak(databank, id, await leesJson(req)) });
      }
      if (methode === 'DELETE') {
        if (!eisRecht(res, gebruiker, 'bakken_verwijderen')) return;
        db.verwijderBak(databank, id);
        return stuurJson(res, 200, { verwijderd: true });
      }
    }

    m = /^\/api\/bakken\/(\d+)\/items$/.exec(pad);
    if (m) {
      const bakId = Number(m[1]);
      if (methode === 'GET') {
        if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
        return stuurJson(res, 200, { producten: db.lijstItems(databank, bakId) });
      }
      if (methode === 'POST') {
        if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
        return stuurJson(res, 201, { product: db.voegItemToe(databank, bakId, await leesJson(req)) });
      }
    }

    m = /^\/api\/items\/(\d+)$/.exec(pad);
    if (m) {
      const id = Number(m[1]);
      if (methode === 'PATCH' || methode === 'PUT') {
        if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
        return stuurJson(res, 200, { product: db.wijzigItem(databank, id, await leesJson(req)) });
      }
      if (methode === 'DELETE') {
        if (!eisRecht(res, gebruiker, 'bakken_verwijderen')) return;
        db.verwijderItem(databank, id);
        return stuurJson(res, 200, { verwijderd: true });
      }
    }

    m = /^\/api\/items\/(\d+)\/tel$/.exec(pad);
    if (m && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
      const lichaam = await leesJson(req);
      return stuurJson(res, 200, { product: db.telItemBij(databank, Number(m[1]), lichaam.verschil) });
    }

    // Codes
    if (pad === '/api/codes' && methode === 'GET') {
      if (!eisRecht(res, gebruiker, 'codes_beheren')) return;
      return stuurJson(res, 200, { codes: db.lijstCodes(databank) });
    }
    if (pad === '/api/codes' && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'codes_beheren')) return;
      const lichaam = await leesJson(req);
      const nieuw = db.maakCodes(databank, lichaam.aantal || 1, lichaam.naam || '');
      return stuurJson(res, 201, {
        codes: nieuw.map((c) => Object.assign({}, c, { inhoud: codes.qrInhoud(c.code, basisAdres(req)) }))
      });
    }

    m = /^\/api\/codes\/([0-9A-Za-z]{1,12})$/.exec(pad);
    if (m) {
      const code = m[1];
      if (methode === 'GET') {
        if (!eisRecht(res, gebruiker, 'codes_beheren')) return;
        const gevonden = db.haalCode(databank, code);
        if (!gevonden) return stuurJson(res, 404, { fout: 'Deze code bestaat niet.' });
        return stuurJson(res, 200, {
          code: gevonden,
          inhoud: codes.qrInhoud(gevonden.code, basisAdres(req)),
          bak: gevonden.bakId == null ? null : db.haalBak(databank, gevonden.bakId)
        });
      }
      if (methode === 'PATCH' || methode === 'PUT') {
        if (!eisRecht(res, gebruiker, 'codes_beheren')) return;
        return stuurJson(res, 200, { code: db.wijzigCode(databank, code, await leesJson(req)) });
      }
      if (methode === 'DELETE') {
        if (!eisRecht(res, gebruiker, 'codes_beheren')) return;
        db.verwijderCode(databank, code);
        return stuurJson(res, 200, { verwijderd: true });
      }
    }

    // Foto's van de inhoud van een bak. De app verkleint ze op het toestel en
    // stuurt ze hier als base64; wij bewaren het bestand en geven het terug via
    // /api/fotos/<id>. Zo staat er niets van de foto zelf in de databank.
    m = /^\/api\/bakken\/(\d+)\/fotos$/.exec(pad);
    if (m) {
      const bakId = Number(m[1]);
      if (methode === 'GET') {
        if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
        return stuurJson(res, 200, { fotos: db.lijstFotos(databank, bakId) });
      }
      if (methode === 'POST') {
        if (!eisRecht(res, gebruiker, 'bakken_wijzigen')) return;
        const lichaam = await leesJson(req, MAX_FOTO_BYTES + 1024 * 1024);
        return stuurJson(res, 201, { foto: bewaarFoto(bakId, lichaam) });
      }
    }

    m = /^\/api\/fotos\/(\d+)$/.exec(pad);
    if (m) {
      const fotoId = Number(m[1]);
      if (methode === 'GET') {
        if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
        const rij = databank.prepare('SELECT * FROM fotos WHERE id = ?').get(fotoId);
        if (!rij) return stuurJson(res, 404, { fout: 'Deze foto bestaat niet.' });
        if (!stuurBestand(res, path.join(mediaDir, path.basename(rij.bestand)))) {
          return stuurJson(res, 404, { fout: 'Het bestand van deze foto ontbreekt.' });
        }
        return;
      }
      if (methode === 'DELETE') {
        if (!eisRecht(res, gebruiker, 'bakken_verwijderen')) return;
        const weg = db.verwijderFoto(databank, fotoId);
        try {
          fs.unlinkSync(path.join(mediaDir, path.basename(weg.bestand)));
        } catch (e) { /* het bestand was er al niet meer */ }
        return stuurJson(res, 200, { verwijderd: true });
      }
    }

    // Scannen: wat de camera of de handmatige invoer oplevert
    if (pad === '/api/scan' && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'bakken_bekijken')) return;
      const lichaam = await leesJson(req);
      const code = codes.codeUitInhoud(lichaam.inhoud);
      if (!code) return stuurJson(res, 400, { fout: 'In deze code zit geen sticker van Bakken.' });
      const gevonden = db.bakBijCode(databank, code);
      if (!gevonden) return stuurJson(res, 404, { fout: 'Deze code is hier niet bekend.', code });
      return stuurJson(res, 200, {
        code: gevonden.code,
        bak: gevonden.bak,
        producten: gevonden.bak ? db.lijstItems(databank, gevonden.bak.id) : []
      });
    }

    // Gebruikers (alleen met het recht gebruikers_beheren)
    if (pad === '/api/gebruikers' && methode === 'GET') {
      if (!eisRecht(res, gebruiker, 'gebruikers_beheren')) return;
      return stuurJson(res, 200, {
        gebruikers: db.lijstGebruikers(databank).map((g) => db.zonderAfdruk(g)),
        rechten: rechten.RECHTEN.map((r) => ({ recht: r, uitleg: rechten.OMSCHRIJVING[r] }))
      });
    }
    if (pad === '/api/gebruikers' && methode === 'POST') {
      if (!eisRecht(res, gebruiker, 'gebruikers_beheren')) return;
      const lichaam = await leesJson(req);
      const afdruk = accounts.maakAfdruk(lichaam.wachtwoord);
      const nieuw = db.voegGebruikerToe(databank, {
        naam: lichaam.naam,
        rol: rechten.isRol(lichaam.rol) ? lichaam.rol : 'gebruiker',
        rechten: lichaam.rechten,
        afdruk
      });
      return stuurJson(res, 201, { gebruiker: db.zonderAfdruk(nieuw) });
    }

    m = /^\/api\/gebruikers\/(\d+)$/.exec(pad);
    if (m) {
      const id = Number(m[1]);
      if (methode === 'PATCH' || methode === 'PUT') {
        if (!eisRecht(res, gebruiker, 'gebruikers_beheren')) return;
        const lichaam = await leesJson(req);
        let uit = db.haalGebruiker(databank, id);
        if (!uit) return stuurJson(res, 404, { fout: 'Deze gebruiker bestaat niet.' });
        if (lichaam.rol !== undefined || lichaam.rechten !== undefined) {
          uit = db.zetRolEnRechten(databank, id, lichaam.rol === undefined ? uit.rol : lichaam.rol,
            lichaam.rechten === undefined ? uit.rechten : lichaam.rechten);
        }
        if (lichaam.wachtwoord) uit = db.zetWachtwoord(databank, id, accounts.maakAfdruk(lichaam.wachtwoord));
        return stuurJson(res, 200, { gebruiker: db.zonderAfdruk(uit) });
      }
      if (methode === 'DELETE') {
        if (!eisRecht(res, gebruiker, 'gebruikers_beheren')) return;
        db.verwijderGebruiker(databank, id);
        return stuurJson(res, 200, { verwijderd: true });
      }
    }

    return stuurJson(res, 404, { fout: 'Deze route bestaat niet.' });
  }

  return {
    server: http.createServer(verwerk),
    db: databank,
    dataDir,
    mediaDir,
    publiek,
    versie: appVersie,
    basisAdres,
    laatsteVersieOpGitHub,
    stop() {
      try {
        databank.close();
      } catch (e) { /* al dicht */ }
    }
  };
}

if (require.main === module) {
  const app = maakApp({});
  const poort = Number(process.env.PORT || 8110);
  app.server.listen(poort, () => {
    process.stdout.write('Bakken ' + app.versie + ' luistert op poort ' + poort + '\n');
  });
}

module.exports = { maakApp, VERSIE, REPO };
