/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * qr.js — QR code generator wrapper.
 *
 * Uses the proven `qrcode-generator` library (qrcode-lib.js) under the hood so
 * the codes are always spec-correct and scannable by real camera apps. Keeps
 * the existing SPNQR.render(container, text, opts) API so callers are unchanged.
 *
 * Requires qrcode-lib.js to be loaded first (it defines window.qrcode).
 */
(function () {
  'use strict';

  function render(container, text, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#ffffff';

    if (!container) return;
    if (typeof window.qrcode !== 'function') {
      container.innerHTML = '<div style="padding:10px;color:#900;font-size:12px">QR library not loaded</div>';
      return;
    }

    // type 0 = auto-pick the smallest version that fits; 'M' = ~15% error correction
    var qr = window.qrcode(0, 'M');
    qr.addData(text || '');
    qr.make();

    var count = qr.getModuleCount();
    var margin = 4;                       // quiet zone (spec requires >= 4)
    var total = count + margin * 2;
    var cell = size / total;

    // Build a single-path SVG (crisp, small, fast)
    var path = '';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          var x = (c + margin) * cell;
          var y = (r + margin) * cell;
          path += 'M' + x.toFixed(2) + ' ' + y.toFixed(2) +
                  'h' + cell.toFixed(2) + 'v' + cell.toFixed(2) +
                  'h-' + cell.toFixed(2) + 'z';
        }
      }
    }

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" ' +
      'viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + light + '"/>' +
      '<path d="' + path + '" fill="' + dark + '"/>' +
      '</svg>';

    container.innerHTML = svg;
  }

  window.SPNQR = { render: render };
})();
