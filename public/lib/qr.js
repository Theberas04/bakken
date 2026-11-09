/* eslint-disable */
// QR-codes maken voor de stickers, in de browser en in de proeven.
//
// Het rekenwerk komt van qrcode.js (MIT, Kazuhiko Arase) dat ernaast staat als
// `qrcode.js`. Dit bestand maakt daar een matrix en een SVG van, zodat de app
// zelf een sticker kan tekenen en een printvel kan maken zonder internet.
//
// De sticker bevat altijd een gewone link (zie lib/codes.js): dan werkt hij ook
// met de camera-app van een telefoon, niet alleen in deze app.

(function (fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./qrcode.js'));
  else window.bakkenQr = fabriek(window.qrcode);
}(function (qrcode) {
  'use strict';

  // Vierkantjes per module in de SVG. Ruim genoeg voor een scherpe printer.
  var STANDARD = 8;
  // Stille rand rond de code; de lezer heeft die nodig. Vier modules is de norm.
  var STIL = 4;

  // De inhoud is een link; die is altijd ASCII, dus de standaard-omzetting volstaat.
  function maakMatrix(inhoud, correctie) {
    var tekst = String(inhoud == null ? '' : inhoud);
    if (!tekst) throw new Error('Een QR-code heeft inhoud nodig.');
    var qr = qrcode(0, correctie || 'M');
    qr.addData(tekst);
    qr.make();
    var aantal = qr.getModuleCount();
    var rijen = [];
    for (var r = 0; r < aantal; r += 1) {
      var rij = [];
      for (var k = 0; k < aantal; k += 1) rij.push(qr.isDark(r, k) ? 1 : 0);
      rijen.push(rij);
    }
    return { aantal: aantal, rijen: rijen };
  }

  // Eén pad met alle zwarte vakjes: klein bestand, scherpe randen, en het schaalt
  // mee met de breedte die de pagina opgeeft.
  function maakSvg(inhoud, opties) {
    var o = opties || {};
    var maat = o.maat || STANDARD;
    var stil = o.stil == null ? STIL : o.stil;
    var matrix = maakMatrix(inhoud, o.correctie);
    var zijde = (matrix.aantal + stil * 2) * maat;
    var delen = [];
    for (var r = 0; r < matrix.aantal; r += 1) {
      for (var k = 0; k < matrix.aantal; k += 1) {
        if (matrix.rijen[r][k]) {
          delen.push('M' + ((k + stil) * maat) + ' ' + ((r + stil) * maat) + 'h' + maat + 'v' + maat + 'h-' + maat + 'z');
        }
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + zijde + ' ' + zijde +
      '" width="' + zijde + '" height="' + zijde + '" shape-rendering="crispEdges" role="img"' +
      ' aria-label="QR-code met de sticker">' +
      '<rect width="' + zijde + '" height="' + zijde + '" fill="#ffffff"/>' +
      '<path d="' + delen.join('') + '" fill="#111111"/>' +
      '</svg>';
    return { svg: svg, matrix: matrix, zijde: zijde, maat: maat, stil: stil };
  }

  // Voor het printvel: dezelfde code, maar zonder vaste breedte, zodat de CSS
  // het vak bepaalt en de printer het scherp houdt.
  function maakPrintSvg(inhoud, opties) {
    var uit = maakSvg(inhoud, Object.assign({}, opties, { maat: 1 }));
    return uit.svg
      .replace(' width="' + uit.zijde + '"', '')
      .replace(' height="' + uit.zijde + '"', '');
  }

  var api = { maakMatrix: maakMatrix, maakSvg: maakSvg, maakPrintSvg: maakPrintSvg, STIL: STIL };
  return api;
}));
