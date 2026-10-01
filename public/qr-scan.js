/*
 * qr-scan.js — camera-based QR scanner for entering recipient addresses.
 *
 * Uses the browser's native BarcodeDetector API (Chrome, Edge, most modern
 * mobile browsers). No external library, so it stays compatible with the
 * project's proprietary license. If the API or camera isn't available, it
 * shows a friendly message instead of failing.
 *
 * Usage:
 *   SPNScan.open(function (text) { ... });   // callback gets the decoded text
 */
(function () {
  'use strict';
  if (window.SPNScan) return;

  function lang() { try { return localStorage.getItem('spn_lang') || 'en'; } catch (e) { return 'en'; } }
  var isFa = lang() === 'fa';
  var T = {
    title:      isFa ? 'اسکن کد QR' : 'Scan QR code',
    hint:       isFa ? 'کد QR آدرس را جلوی دوربین بگیرید' : 'Point your camera at the address QR code',
    noCam:      isFa ? 'دسترسی به دوربین ممکن نشد. لطفاً اجازه دهید یا آدرس را دستی وارد کنید.'
                     : 'Could not access the camera. Please allow it or enter the address manually.',
    noSupport:  isFa ? 'مرورگر شما اسکن QR را پشتیبانی نمی‌کند. آدرس را دستی وارد کنید یا از کروم/موبایل استفاده کنید.'
                     : 'Your browser does not support QR scanning. Please enter the address manually or use Chrome/mobile.',
    cancel:     isFa ? 'انصراف' : 'Cancel',
    close:      isFa ? 'بستن' : 'Close'
  };

  var overlay, video, stream, rafId, detector, onResult;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'spn-scan-overlay';
    overlay.setAttribute('dir', isFa ? 'rtl' : 'ltr');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100001;background:rgba(6,10,16,.92);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:Sora,sans-serif;padding:20px;gap:14px';
    overlay.innerHTML =
      '<div style="color:#f0a500;font-weight:700;font-size:16px">' + T.title + '</div>' +
      '<div style="position:relative;width:min(320px,80vw);aspect-ratio:1;border-radius:16px;overflow:hidden;' +
        'border:3px solid #f0a500;box-shadow:0 0 40px rgba(240,165,0,.3)">' +
        '<video id="spn-scan-video" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
        '<div style="position:absolute;inset:0;box-shadow:inset 0 0 0 2px rgba(255,255,255,.15)"></div>' +
      '</div>' +
      '<div id="spn-scan-msg" style="color:#cbd5e1;font-size:13px;text-align:center;max-width:320px;line-height:1.6">' + T.hint + '</div>' +
      '<button id="spn-scan-cancel" style="background:#1a2340;border:1px solid rgba(255,255,255,.15);' +
        'color:#e2e8f0;border-radius:10px;padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">' +
        T.cancel + '</button>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('#spn-scan-video');
    overlay.querySelector('#spn-scan-cancel').onclick = close;
  }

  function setMsg(text, isError) {
    var el = overlay && overlay.querySelector('#spn-scan-msg');
    if (el) { el.textContent = text; el.style.color = isError ? '#ff6a85' : '#cbd5e1'; }
  }

  async function start() {
    // 1. Check BarcodeDetector support
    if (!('BarcodeDetector' in window)) {
      setMsg(T.noSupport, true);
      return;
    }
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      setMsg(T.noSupport, true);
      return;
    }

    // 2. Open camera (prefer rear camera on phones)
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      setMsg(T.noCam, true);
      return;
    }

    // 3. Scan loop
    scanLoop();
  }

  async function scanLoop() {
    if (!detector || !video || video.readyState < 2) {
      rafId = requestAnimationFrame(scanLoop);
      return;
    }
    try {
      var codes = await detector.detect(video);
      if (codes && codes.length) {
        var raw = (codes[0].rawValue || '').trim();
        if (raw) {
          var addr = cleanAddress(raw);
          finish(addr);
          return;
        }
      }
    } catch (e) { /* ignore a failed frame, keep scanning */ }
    rafId = requestAnimationFrame(scanLoop);
  }

  // Accept plain addresses or URI forms like "spn:SPN1abc?amount=1"
  function cleanAddress(raw) {
    var s = raw;
    // strip a scheme prefix if present
    s = s.replace(/^[a-z]+:/i, '');
    // cut at the first query separator
    s = s.split('?')[0].split('&')[0].trim();
    return s;
  }

  function finish(text) {
    var cb = onResult;
    close();
    if (cb) cb(text);
  }

  function close() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; video = null; detector = null;
  }

  window.SPNScan = {
    open: function (callback) {
      onResult = callback;
      buildOverlay();
      start();
    },
    close: close
  };
})();
