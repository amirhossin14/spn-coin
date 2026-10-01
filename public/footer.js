/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * footer.js — shared site footer, injected on every page (like nav.js).
 * Includes quick links, About / Contact, and a language switcher (EN / FA).
 */
(function () {
  var LANG_KEY = 'spn_lang';
  var lang = 'en';
  try { lang = localStorage.getItem(LANG_KEY) || 'en'; } catch (e) {}

  var T = {
    en: {
      tagline: 'An educational Bitcoin-inspired blockchain. No monetary value.',
      explore: 'Explore', company: 'Company', resources: 'Resources',
      dashboard: 'Dashboard', explorer: 'Explorer', wallet: 'Wallet', createCoin: 'Create Coin', myWallet: 'My Wallet',
      about: 'About', contact: 'Contact', docs: 'Docs', terms: 'Terms & Conditions',
      analytics: 'Analytics', radar: 'Threat Radar', faucet: 'Testnet Faucet', apidocs: 'API Docs',
      rights: 'All rights reserved.', built: 'Built for learning blockchain technology.',
      lang: 'Language', theme: 'Theme', toggleTheme: 'Toggle light / dark mode',
      lightMode: 'Light', darkMode: 'Dark',
    },
    fa: {
      tagline: 'یک بلاکچین آموزشی الهام‌گرفته از بیت‌کوین. بدون ارزش مالی.',
      explore: 'کاوش', company: 'شرکت', resources: 'منابع',
      dashboard: 'داشبورد', explorer: 'کاوشگر', wallet: 'کیف پول', createCoin: 'ساخت کوین', myWallet: 'کیف پول من',
      about: 'درباره ما', contact: 'تماس با ما', docs: 'مستندات', terms: 'قوانین و مقررات',
      analytics: 'تحلیل‌ها', radar: 'رادار تهدید', faucet: 'شیر تست‌نت', apidocs: 'مستندات API',
      rights: 'تمام حقوق محفوظ است.', built: 'ساخته‌شده برای یادگیری فناوری بلاکچین.',
      lang: 'زبان', theme: 'پوسته', toggleTheme: 'تغییر حالت روشن / تاریک',
      lightMode: 'روشن', darkMode: 'تاریک',
    },
  };

  function t(k) { return (T[lang] && T[lang][k]) || T.en[k] || k; }

  var css = '' +
    '#spn-footer{background:#0a0d14;border-top:1px solid rgba(0,255,136,.1);margin-top:60px;' +
      'font-family:Sora,system-ui,sans-serif;color:#6e7898}' +
    '#spn-footer{overflow-x:hidden}' +
    '#spn-footer .ft-in{max-width:1600px;margin:0 auto;padding:40px 14px 24px;' +
      'display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:32px}' +
    '#spn-footer .ft-in > *{min-width:0}' +
    '#spn-footer .ft-mail{overflow-wrap:anywhere;word-break:break-word}' +
    '@media(max-width:760px){#spn-footer .ft-in{grid-template-columns:1fr 1fr;gap:24px}}' +
    '@media(max-width:480px){#spn-footer .ft-in{grid-template-columns:1fr;gap:20px}}' +
    '#spn-footer .ft-brand .logo{display:flex;align-items:center;gap:9px;margin-bottom:12px}' +
    '#spn-footer .ft-brand .logo .ic{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#f0a500,#ffb820);' +
      'display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#000}' +
    '#spn-footer .ft-brand .logo .txt{font-size:16px;font-weight:900;color:#f0a500}' +
    '#spn-footer .ft-brand p{font-size:13px;line-height:1.6;max-width:280px}' +
    '#spn-footer .ft-social{display:flex;gap:10px;margin-top:16px}' +
    '#spn-footer .ft-mail{display:flex;align-items:center;gap:7px}' +
    '#spn-footer .ft-mail svg{flex:none;opacity:.7;width:14px !important;height:14px !important;max-width:14px;max-height:14px;display:inline-block;vertical-align:middle}' +
    '#spn-footer .ft-social a{display:flex;align-items:center;justify-content:center;width:36px;height:36px;' +
      'border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);' +
      'color:#8fa9c4;transition:.2s;text-decoration:none}' +
    '#spn-footer .ft-social a:hover{background:rgba(240,165,0,.12);border-color:rgba(240,165,0,.4);' +
      'color:#f0a500;transform:translateY(-2px)}' +
    '#spn-footer h4{color:#dce1f2;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px;font-weight:700}' +
    '#spn-footer a{display:block;color:#6e7898;text-decoration:none;font-size:13.5px;margin-bottom:10px;transition:color .15s}' +
    '#spn-footer a:hover{color:#f0a500}' +
    '#spn-footer .ft-bottom{max-width:1600px;margin:0 auto;padding:18px 14px;border-top:1px solid rgba(255,255,255,.05);' +
      'display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}' +
    '#spn-footer .ft-copy{font-size:12px;color:#404766}' +
    '#spn-footer .ft-lang{display:flex;align-items:center;gap:6px}' +
    '#spn-footer .ft-lang .lbl{font-size:12px;color:#404766;margin-right:4px}' +
    '#spn-footer .ft-lang button{background:#141726;border:1px solid rgba(255,255,255,.08);color:#6e7898;' +
      'border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;transition:.15s}' +
    '#spn-footer .ft-lang button.on{background:rgba(240,165,0,.14);border-color:#f0a500;color:#f0a500;font-weight:700}' +
    '#spn-footer .ft-lang button:hover{color:#dce1f2}' +
    '#spn-footer .ft-theme-btn{margin-left:10px;padding-left:10px;border-left:1px solid rgba(255,255,255,.1);' +
      'display:inline-flex;align-items:center;gap:6px}' +
    '#spn-footer #ft-theme{background:#141726;border:1px solid rgba(255,255,255,.08);border-radius:7px;' +
      'padding:5px 12px;font-size:13px;cursor:pointer;color:#f0a500;font-family:inherit;transition:.15s;' +
      'display:inline-flex;align-items:center;gap:6px}' +
    '#spn-footer #ft-theme:hover{border-color:#f0a500;background:rgba(240,165,0,.1)}' +
    '#spn-footer[dir="rtl"]{direction:rtl;text-align:right}' +
    '#spn-footer[dir="rtl"] .ft-brand p{max-width:none}';

  function build() {
    if (document.getElementById('spn-footer')) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var f = document.createElement('footer');
    f.id = 'spn-footer';
    if (lang === 'fa') f.setAttribute('dir', 'rtl');

    f.innerHTML =
      '<div class="ft-in">' +
        '<div class="ft-brand">' +
          '<div class="logo"><span class="ic">S</span><span class="txt">SPN Coin</span></div>' +
          '<p>' + t('tagline') + '</p>' +
          '<div class="ft-social">' +
            '<a href="https://www.sepantatoken.com" target="_blank" rel="noopener" aria-label="Website" title="Website">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.3a17.6 17.6 0 0 0 0 4H4.3zm.8 2h2.9a15.7 15.7 0 0 0 1.3 3.4A8 8 0 0 1 5.1 16zm2.9-8H5.1a8 8 0 0 1 4.2-3.4A15.7 15.7 0 0 0 8 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a15.5 15.5 0 0 1 0-4h4.6a15.5 15.5 0 0 1 0 4zm.4 5.4a15.7 15.7 0 0 0 1.3-3.4h2.9a8 8 0 0 1-4.2 3.4zM16.4 14a17.6 17.6 0 0 0 0-4h3.3a8 8 0 0 1 0 4h-3.3z"/></svg>' +
            '</a>' +
            '<a href="https://x.com/SEPANTA_SPN" target="_blank" rel="noopener" aria-label="X" title="X (Twitter)">' +
              '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M18.9 1.2h3.7l-8 9.1 9.4 12.5h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L.1 1.2h7.6l5.2 6.9 5.9-6.9zm-1.3 19.5h2L7.1 3.3H5l12.6 17.4z"/></svg>' +
            '</a>' +
            '<a href="https://t.me/SPNToken_Sepanta" target="_blank" rel="noopener" aria-label="Telegram" title="Telegram">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.9 4.3l-3.3 15.6c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18 5.7c.4-.4-.1-.6-.6-.2L6.2 12.8l-4.9-1.5c-1.1-.3-1.1-1 .2-1.5l19.2-7.4c.9-.3 1.7.2 1.2 1.9z"/></svg>' +
            '</a>' +
            '<a href="https://www.facebook.com/token.Sepanta" target="_blank" rel="noopener" aria-label="Facebook" title="Facebook">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>' +
            '</a>' +
            '<a href="https://www.instagram.com/token_sepanta" target="_blank" rel="noopener" aria-label="Instagram" title="Instagram">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.1-1.1.1-1.7.2-2.1.4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2.1C2.6 9.7 2.6 10.1 2.6 12s0 2.3.1 3.5c.1 1.1.2 1.7.4 2.1.2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2.1.4 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1.1-.1 1.7-.2 2.1-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2.1.1-1.2.1-1.6.1-3.5s0-2.3-.1-3.5c-.1-1.1-.2-1.7-.4-2.1-.2-.5-.4-.9-.8-1.3-.4-.4-.8-.6-1.3-.8-.4-.2-1-.3-2.1-.4-1.2-.1-1.6-.1-4.7-.1zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8zm0 8a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm6.2-8.2a1.1 1.1 0 1 1-2.3 0 1.1 1.1 0 0 1 2.3 0z"/></svg>' +
            '</a>' +
            '<a href="https://sepantatoken.com/whitepaper/" target="_blank" rel="noopener" aria-label="Whitepaper" title="Whitepaper">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2 4 4h-4V4zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zm0-6h4v1.5H8V9z"/></svg>' +
            '</a>' +
            '<a href="mailto:Info@sepantatoken.com" aria-label="Email" title="Info@sepantatoken.com">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>' +
            '</a>' +
          '</div>' +
        '</div>' +
        '<div><h4>' + t('explore') + '</h4>' +
          '<a href="dashboard">' + t('dashboard') + '</a>' +
          '<a href="explorer">' + t('explorer') + '</a>' +
          '<a href="mywallet">' + t('myWallet') + '</a>' +
          '<a href="wallet">' + t('wallet') + '</a>' +
          '<a href="token-factory">' + t('createCoin') + '</a>' +
        '</div>' +
        '<div><h4>' + t('resources') + '</h4>' +
          '<a href="analytics">' + t('analytics') + '</a>' +
          '<a href="radar">' + t('radar') + '</a>' +
          '<a href="/apidocs">' + t('apidocs') + '</a>' +
          '<a href="/faucet">' + t('faucet') + '</a>' +
        '</div>' +
        '<div><h4>' + t('company') + '</h4>' +
          '<a href="about">' + t('about') + '</a>' +
          '<a href="contact">' + t('contact') + '</a>' +
          '<a href="terms">' + t('terms') + '</a>' +
          '<a href="mailto:Info@sepantatoken.com" class="ft-mail"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="width:14px;height:14px;flex:none"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>Info@sepantatoken.com</a>' +
          '<a href="mailto:Mng@sepantatoken.com" class="ft-mail"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="width:14px;height:14px;flex:none"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>Mng@sepantatoken.com</a>' +
          '<a href="mailto:Support@sepantatoken.com" class="ft-mail"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="width:14px;height:14px;flex:none"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>Support@sepantatoken.com</a>' +
        '</div>' +
      '</div>' +
      '<div class="ft-bottom">' +
        '<div class="ft-copy">© 2026 SPN Coin Project. ' + t('rights') + ' ' + t('built') + '</div>' +
        '<div class="ft-lang"><span class="lbl">' + t('lang') + ':</span>' +
          '<button data-lang="en"' + (lang === 'en' ? ' class="on"' : '') + '>English</button>' +
          '<button data-lang="fa"' + (lang === 'fa' ? ' class="on"' : '') + '>فارسی</button>' +
          '<span class="ft-theme-btn"><button id="ft-theme" title="' + t('toggleTheme') + '"><span id="ft-theme-ic">☀️</span><span id="ft-theme-lbl">' + t('theme') + '</span></button></span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(f);

    // ── Scroll-to-top button (appears on every page after scrolling down) ──
    if (!document.getElementById('spn-totop')) {
      var btn = document.createElement('button');
      btn.id = 'spn-totop';
      btn.setAttribute('aria-label', 'Back to top');
      btn.innerHTML = '↑';
      btn.style.cssText = 'position:fixed;bottom:22px;inset-inline-end:92px;width:46px;height:46px;' +
        'border-radius:50%;border:1px solid rgba(240,165,0,.3);background:rgba(14,20,27,.9);' +
        'backdrop-filter:blur(8px);color:#f0a500;font-size:20px;font-weight:700;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;line-height:0;' +
        'opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:9997;transform:translateY(10px)';
      btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(240,165,0,.15)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'rgba(14,20,27,.9)'; });
      btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      document.body.appendChild(btn);
      window.addEventListener('scroll', function () {
        var show = window.scrollY > 400;
        btn.style.opacity = show ? '1' : '0';
        btn.style.pointerEvents = show ? 'auto' : 'none';
        btn.style.transform = show ? 'translateY(0)' : 'translateY(10px)';
      }, { passive: true });
    }

    // ── Live node connection indicator (bottom-start corner, all pages) ──
    if (!document.getElementById('spn-nodestat')) {
      var ns = document.createElement('div');
      ns.id = 'spn-nodestat';
      ns.style.cssText = 'position:fixed;bottom:22px;inset-inline-start:22px;display:flex;align-items:center;' +
        'gap:7px;background:rgba(14,20,27,.9);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.08);' +
        'border-radius:100px;padding:7px 13px;font-size:12px;font-weight:600;color:#8a97a8;z-index:9997;' +
        'font-family:inherit;opacity:0;transition:opacity .3s';
      ns.innerHTML = '<span id="spn-nsdot" style="width:8px;height:8px;border-radius:50%;background:#5a6675"></span>' +
        '<span id="spn-nstext">' + (lang === 'fa' ? 'بررسی نود…' : 'Checking node…') + '</span>';
      document.body.appendChild(ns);

      var api = window.SPN_COIN_API ||
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3000' : location.origin);
      var checkNode = function () {
        fetch(api + '/api/health', { signal: (window.AbortSignal && AbortSignal.timeout) ? AbortSignal.timeout(5000) : undefined })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (h) {
            var dot = document.getElementById('spn-nsdot');
            var txt = document.getElementById('spn-nstext');
            ns.style.opacity = '1';
            if (h && h.status === 'ok') {
              dot.style.background = '#00e676';
              dot.style.boxShadow = '0 0 6px rgba(0,230,118,.6)';
              txt.textContent = lang === 'fa' ? ('نود آنلاین · #' + (h.height != null ? h.height : '?')) : ('Node online · #' + (h.height != null ? h.height : '?'));
            } else {
              dot.style.background = '#ff5470'; dot.style.boxShadow = 'none';
              txt.textContent = lang === 'fa' ? 'نود آفلاین' : 'Node offline';
            }
          })
          .catch(function () {
            var dot = document.getElementById('spn-nsdot');
            var txt = document.getElementById('spn-nstext');
            ns.style.opacity = '1';
            dot.style.background = '#ff5470'; dot.style.boxShadow = 'none';
            txt.textContent = lang === 'fa' ? 'نود آفلاین' : 'Node offline';
          });
      };
      checkNode();
      setInterval(checkNode, 30000);
    }

    // Theme toggle (light / dark) — logic lives in ui-prefs.js.
    var themeBtn = f.querySelector('#ft-theme');
    if (themeBtn) {
      var setIcon = function () {
        var cur = (window.SPNPrefs && window.SPNPrefs.getTheme) ? window.SPNPrefs.getTheme() : 'dark';
        var ic = f.querySelector('#ft-theme-ic');
        var lbl = f.querySelector('#ft-theme-lbl');
        // Show the mode you'll switch TO, so the action is obvious.
        if (cur === 'light') { if (ic) ic.textContent = '🌙'; if (lbl) lbl.textContent = t('darkMode'); }
        else { if (ic) ic.textContent = '☀️'; if (lbl) lbl.textContent = t('lightMode'); }
      };
      setIcon();
      themeBtn.addEventListener('click', function () {
        if (window.SPNPrefs && window.SPNPrefs.toggleTheme) window.SPNPrefs.toggleTheme();
        setIcon();
      });
    }

    f.querySelectorAll('.ft-lang button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nl = btn.getAttribute('data-lang');
        try { localStorage.setItem(LANG_KEY, nl); } catch (e) {}
        lang = nl;
        // Prefer the shared i18n engine so the WHOLE page translates, not just the footer.
        if (window.SPNi18n) {
          window.SPNi18n.set(nl);
          // rebuild footer in the new language
          f.parentNode.removeChild(f);
          build();
        } else {
          f.parentNode.removeChild(f);
          build();
          document.dispatchEvent(new CustomEvent('spn-lang-change', { detail: { lang: nl } }));
        }
      });
    });
  }

  window.SPNLang = { get: function () { return lang; }, t: t };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
