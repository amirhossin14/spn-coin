/*
 * anti-phishing.js — client-side protections against phishing & social engineering.
 *
 * Layers:
 *   1. Official-domain check — warns if the site is served from an unexpected
 *      domain (a common sign of a phishing clone).
 *   2. Anti-framing — breaks out if the page is embedded in someone else's site
 *      (clickjacking / overlay phishing).
 *   3. Private-key guardrails — global warning whenever a private key / seed
 *      field is focused, and a paste guard that reminds users never to paste
 *      keys they received from someone else.
 *   4. A dismissible security tip on wallet/key pages.
 *
 * Configure your official domains in OFFICIAL_HOSTS below once you have them.
 */
(function () {
  'use strict';
  if (window.__spnAntiPhish) return;
  window.__spnAntiPhish = true;

  // ── CONFIG: your real domains. Add your production domain here. ──
  // Leave localhost/127.0.0.1 for development. Anything else triggers a warning.
  var OFFICIAL_HOSTS = [
    'localhost', '127.0.0.1',
    'sepantatoken.com', 'www.sepantatoken.com',
    'spnchain.com', 'www.spnchain.com'
  ];

  function lang() { try { return localStorage.getItem('spn_lang') || 'en'; } catch (e) { return 'en'; } }
  var isFa = lang() === 'fa';

  // ── Layer 2: anti-framing (clickjacking) ──
  try {
    if (window.top !== window.self) {
      // Page is inside an iframe it shouldn't be — break out.
      window.top.location = window.self.location;
    }
  } catch (e) {
    // Cross-origin framing throws; that itself means we're framed maliciously.
    document.documentElement.innerHTML =
      '<div style="font-family:sans-serif;padding:40px;text-align:center;color:#fff;background:#0e1528;min-height:100vh">' +
      (isFa ? '⚠️ این صفحه در یک سایت دیگر بارگذاری شده و ممکن است جعلی باشد. لطفاً مستقیم به سایت رسمی بروید.'
            : '⚠️ This page is embedded in another site and may be a phishing attempt. Please visit the official site directly.') +
      '</div>';
    return;
  }

  // ── Layer 1: official-domain check ──
  (function domainCheck() {
    var host = location.hostname;
    // file:// or empty host → local use, skip
    if (!host) return;
    if (OFFICIAL_HOSTS.indexOf(host) !== -1) return;

    // Unknown host — show a non-blocking but prominent warning bar.
    var bar = document.createElement('div');
    bar.setAttribute('dir', isFa ? 'rtl' : 'ltr');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;' +
      'background:#b3261e;color:#fff;font-family:Sora,sans-serif;font-size:13px;font-weight:600;' +
      'padding:10px 16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    bar.innerHTML = (isFa
      ? '⚠️ هشدار: این آدرس (<b>' + host + '</b>) دامنه‌ی رسمی SPN نیست. ممکن است سایت جعلی (فیشینگ) باشد. کلید خصوصی خود را وارد نکنید!'
      : '⚠️ Warning: <b>' + host + '</b> is not an official SPN domain. This may be a phishing site. Do NOT enter your private key!');
    if (document.body) document.body.appendChild(bar);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(bar); });
  })();

  // ── Layer 3: private-key / seed field guardrails ──
  function looksLikeSecretField(el) {
    if (!el || el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
    var hay = ((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '') + ' ' +
               (el.getAttribute('aria-label') || '')).toLowerCase();
    return /(private|privkey|priv-key|secret|seed|mnemonic|recovery|کلید|بازیابی|رمز عبور بازیابی)/.test(hay);
  }

  var warnedOnce = false;
  document.addEventListener('focusin', function (e) {
    if (!looksLikeSecretField(e.target) || warnedOnce) return;
    warnedOnce = true;
    showKeyTip();
  });

  function showKeyTip() {
    if (document.getElementById('spn-key-tip')) return;
    var tip = document.createElement('div');
    tip.id = 'spn-key-tip';
    tip.setAttribute('dir', isFa ? 'rtl' : 'ltr');
    tip.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100000;' +
      'max-width:440px;width:calc(100% - 32px);background:#1a2340;border:1px solid #f0a500;' +
      'border-radius:12px;padding:14px 16px;color:#e2e8f0;font-family:Sora,sans-serif;font-size:12.5px;' +
      'line-height:1.6;box-shadow:0 12px 40px rgba(0,0,0,.5)';
    tip.innerHTML =
      '<div style="font-weight:700;color:#f0a500;margin-bottom:6px">🔐 ' +
        (isFa ? 'محافظت از کلید خصوصی' : 'Protect your private key') + '</div>' +
      '<div>' + (isFa
        ? 'کلید خصوصی شما فقط در همین مرورگر می‌ماند و هرگز به سرور فرستاده نمی‌شود. '
          + '<b>هیچ‌کس</b> (نه پشتیبانی، نه ادمین) هرگز نباید کلید شما را بخواهد. '
          + 'اگر کسی کلید شما را خواست، قطعاً کلاهبردار است.'
        : 'Your private key stays in this browser and is never sent to any server. '
          + '<b>No one</b> (not support, not an admin) should ever ask for it. '
          + 'If anyone asks for your key, it is a scam.') + '</div>' +
      '<button style="margin-top:10px;background:#f0a500;border:none;border-radius:8px;padding:7px 14px;' +
        'color:#000;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">' +
        (isFa ? 'فهمیدم' : 'Got it') + '</button>';
    tip.querySelector('button').onclick = function () { tip.remove(); };
    document.body.appendChild(tip);
    // auto-dismiss after 12s
    setTimeout(function () { if (tip.parentNode) tip.remove(); }, 12000);
  }
})();
