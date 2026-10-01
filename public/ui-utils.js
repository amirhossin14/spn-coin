/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * ui-utils.js — shared UI helpers usable on any page:
 *   • SPNUI.copy(text, btnEl)     — copy to clipboard with visual feedback
 *   • SPNUI.qr(text, size, cb)    — render a QR code into returned element
 *   • SPNUI.qrModal(text, label)  — pops a centered QR overlay for an address
 *   • SPNUI.attachCopyButtons()   — wires any [data-copy] element automatically
 *
 * QR uses the well-tested `qrcodejs` library, loaded on demand from cdnjs.
 * No private data ever leaves the page — QR is generated entirely client-side.
 */
(function () {
  // ── Clipboard ──────────────────────────────────────────────
  function copy(text, btnEl) {
    var done = function () {
      if (!btnEl) return;
      var old = btnEl.getAttribute('data-label') || btnEl.textContent;
      if (!btnEl.getAttribute('data-label')) btnEl.setAttribute('data-label', old);
      btnEl.textContent = '✓ Copied';
      btnEl.classList.add('copied');
      setTimeout(function () { btnEl.textContent = btnEl.getAttribute('data-label'); btnEl.classList.remove('copied'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); done();
      } catch (e) {}
    }
  }

  function attachCopyButtons(root) {
    (root || document).querySelectorAll('[data-copy]').forEach(function (el) {
      if (el._copyWired) return; el._copyWired = true;
      el.style.cursor = 'pointer';
      if (!el.getAttribute('title')) el.setAttribute('title', 'Click to copy');
      el.addEventListener('click', function (e) { e.stopPropagation(); copy(el.getAttribute('data-copy'), el); });
    });
  }

  // ── QR code (lazy-load qrcodejs from cdnjs) ────────────────
  var _qrLoading = null;
  function ensureQRLib() {
    if (window.QRCode) return Promise.resolve();
    if (_qrLoading) return _qrLoading;
    _qrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('QR library failed to load')); };
      document.head.appendChild(s);
    });
    return _qrLoading;
  }

  // Render QR into a container element. Returns the container.
  function qr(text, size, container) {
    size = size || 180;
    var el = container || document.createElement('div');
    el.innerHTML = '<span style="font-size:12px;color:#6e7898">QR…</span>';
    ensureQRLib().then(function () {
      el.innerHTML = '';
      new window.QRCode(el, {
        text: text, width: size, height: size,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M,
      });
      // style the generated img/canvas
      var img = el.querySelector('img, canvas');
      if (img) { img.style.borderRadius = '8px'; img.style.display = 'block'; }
    }).catch(function () { el.innerHTML = '<span style="font-size:12px;color:#ff5470">QR unavailable</span>'; });
    return el;
  }

  function qrModal(text, label) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;' +
      'align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)';
    var box = document.createElement('div');
    box.style.cssText = 'background:#12141f;border:1px solid rgba(255,255,255,.12);border-radius:16px;' +
      'padding:24px;max-width:320px;text-align:center;font-family:Sora,system-ui,sans-serif';
    box.innerHTML = '<div style="font-size:13px;color:#6e7898;margin-bottom:14px;text-transform:uppercase;' +
      'letter-spacing:.5px">' + (label || 'Scan address') + '</div>' +
      '<div id="_qrbox" style="display:flex;justify-content:center;background:#fff;padding:12px;border-radius:12px"></div>' +
      '<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#dce1f2;margin-top:14px;' +
      'word-break:break-all;line-height:1.5">' + text + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button id="_qrcopy" style="flex:1;background:#f0a500;color:#000;border:none;border-radius:8px;' +
        'padding:10px;font-weight:700;cursor:pointer;font-family:inherit">Copy</button>' +
        '<button id="_qrclose" style="flex:1;background:#1a1d2e;color:#6e7898;border:1px solid rgba(255,255,255,.1);' +
        'border-radius:8px;padding:10px;cursor:pointer;font-family:inherit">Close</button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    qr(text, 200, box.querySelector('#_qrbox'));
    ov.addEventListener('click', function (e) { if (e.target === ov) document.body.removeChild(ov); });
    box.querySelector('#_qrclose').addEventListener('click', function () { document.body.removeChild(ov); });
    box.querySelector('#_qrcopy').addEventListener('click', function (e) { copy(text, e.target); });
  }

  window.SPNUI = { copy: copy, qr: qr, qrModal: qrModal, attachCopyButtons: attachCopyButtons };
  if (document.readyState !== 'loading') attachCopyButtons();
  else document.addEventListener('DOMContentLoaded', function () { attachCopyButtons(); });
})();
