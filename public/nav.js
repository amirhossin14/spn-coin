/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * Shared navigation bar. Included on every page via
 *   <script src="/nav.js?v=3" defer></script>
 * Renders one clean, consistent top bar linking every page.
 */
(function () {
  var LINKS = [
    { href: 'dashboard',     icon: '📊', label: 'Dashboard' },
    { href: 'explorer',      icon: '🔍', label: 'Explorer' },
    { href: 'block',         icon: '📦', label: 'Blocks' },
    { href: 'tx',            icon: '🔗', label: 'TX' },
    { href: 'analytics',     icon: '📈', label: 'Analytics' },
    { href: 'wallet',        icon: '👛', label: 'Wallet' },
    { href: 'send',          icon: '↑',  label: 'Send' },
    { href: 'miner',         icon: '⛏️', label: 'Mining' },
    { href: 'token-factory', icon: '🪙', label: 'Create Coin' },
    { href: 'token-manage',  icon: '🎛️', label: 'Assets' },
    { href: 'airdrop',       icon: '🪂', label: 'Airdrop' },
    { href: 'claim',         icon: '🎁', label: 'Claim' },
    { href: 'radar',         icon: '📡', label: 'Radar' },
    { href: 'monitor',       icon: '📉', label: 'Monitor' },
    { href: 'network',       icon: '🌐', label: 'Network' },
    { href: 'run-node',      icon: '🖥️', label: 'Run a Node' },
    { href: 'ai-widget',     icon: '🤖', label: 'AI' },
  ];

  // The Admin panel is NOT listed for the public. It is only added to the nav
  // when an admin session token is present in this browser (i.e. the user has
  // actually logged in as admin). NOTE: this is a UX convenience only — it hides
  // the link, not the page. The real protection is server-side authentication on
  // /admin and every /api/admin/* route; hiding the link is not a security control.
  var ADMIN_LINK = { href: '/admin', icon: '🔐', label: 'Admin' };
  function isAdminSession() {
    try { return !!sessionStorage.getItem('adm_tok'); } catch (e) { return false; }
  }

  // Extract just the filename so matching works under both http:// and file://
  var path = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  // Clean URLs: '' (root) → explorer. Otherwise the segment IS the page name.
  if (path === '') path = 'explorer';

  var css = '' +
    '#spn-topbar{background:rgba(6,10,14,.94);border-bottom:1px solid rgba(0,255,136,.14);' +
      'position:sticky;top:0;z-index:9999;backdrop-filter:blur(14px);font-family:Sora,system-ui,sans-serif}' +
    '#spn-topbar .tb-in{max-width:1600px;margin:0 auto;padding:0 14px;display:flex;align-items:center;' +
      'gap:8px;height:62px}' +
    '#spn-topbar .tb-logo{display:flex;align-items:center;gap:7px;text-decoration:none;flex-shrink:0;margin-inline-end:6px}' +
    '#spn-topbar .tb-logo .ic{width:36px;height:36px;border-radius:9px;' +
      'background:linear-gradient(135deg,#f0a500,#ffb820);display:flex;align-items:center;' +
      'justify-content:center;font-size:15px;font-weight:900;color:#000;box-shadow:0 0 14px rgba(240,165,0,.28)}' +
    '#spn-topbar .tb-logo .txt{font-size:15px;font-weight:900;color:#f0a500;white-space:nowrap}' +
    '#spn-topbar .tb-nav{display:flex;gap:0;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;flex:1;align-items:center}' +
    '#spn-topbar .tb-nav::-webkit-scrollbar{display:none;height:0}' +
    '#spn-topbar .tb-nav a{padding:6px 7px;border-radius:6px;font-size:12px;font-weight:500;' +
      'color:#7a99b8;text-decoration:none;transition:all .15s;white-space:nowrap;' +
      'display:inline-flex;align-items:center;gap:4px}' +
    '#spn-topbar .tb-nav a:hover{background:rgba(240,165,0,.1);color:#c8d8e8}' +
    '#spn-topbar .tb-nav a.on{color:#f0a500;font-weight:700;background:rgba(240,165,0,.12)}' +
    // Persian (RTL) gets slightly roomier link padding.
    '#spn-topbar[dir="rtl"] .tb-nav a{padding:6px 7px}' +
    // English (LTR) link padding.
    '#spn-topbar[dir="ltr"] .tb-nav a{padding:6px 7px}' +
    // Hamburger button — hidden on desktop, shown on mobile.
    '#spn-topbar .tb-burger{display:none;background:transparent;border:1px solid rgba(240,165,0,.3);' +
      'border-radius:10px;width:42px;height:42px;cursor:pointer;color:#f0a500;font-size:19px;flex-shrink:0;' +
      'align-items:center;justify-content:center;margin-inline-start:auto;transition:background .15s,transform .15s}' +
    '#spn-topbar .tb-burger:hover{background:rgba(240,165,0,.12)}' +
    '#spn-topbar .tb-burger:active{transform:scale(.92)}' +
    // Dimmed backdrop behind the mobile menu.
    '#spn-nav-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);' +
      'opacity:0;pointer-events:none;transition:opacity .2s;z-index:9997}' +
    '#spn-topbar.open ~ #spn-nav-backdrop,body.spn-nav-open #spn-nav-backdrop{opacity:1;pointer-events:auto}' +

    '@media(max-width:1550px){#spn-topbar[dir] .tb-nav a{padding:4px 5px;font-size:11px}#spn-topbar .tb-nav a .ic{font-size:11px}#spn-topbar .tb-in{gap:4px}}' +
    '@media(max-width:1150px) and (min-width:761px){#spn-topbar[dir] .tb-nav a .t{display:none}#spn-topbar[dir] .tb-nav a{padding:8px 10px;font-size:16px}}' +
    // ── Mobile: collapse the row into a clean single-column hamburger drawer ──
    '@media(max-width:760px){' +
      '#spn-topbar .tb-burger{display:inline-flex}' +
      '#spn-topbar .tb-in{height:56px}' +
      '#spn-topbar .tb-nav{position:fixed;top:56px;inset-inline:0;bottom:auto;max-height:calc(100dvh - 56px);' +
        'display:flex;flex-direction:column;align-items:stretch;gap:5px;overflow-y:auto;background:rgba(8,12,18,.99);' +
        'backdrop-filter:blur(16px);border-bottom:1px solid rgba(0,255,136,.14);' +
        'border-radius:0 0 16px 16px;box-shadow:0 18px 40px rgba(0,0,0,.5);padding:12px;' +
        'transform:translateY(-12px) scale(.98);transform-origin:top center;opacity:0;pointer-events:none;' +
        'transition:opacity .2s ease,transform .2s cubic-bezier(.22,1,.36,1);z-index:9998}' +
      '#spn-topbar.open .tb-nav{transform:translateY(0) scale(1);opacity:1;pointer-events:auto}' +
      '#spn-topbar .tb-nav a{font-size:15px;font-weight:600;padding:13px 15px;border-radius:11px;gap:13px;' +
        'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);justify-content:flex-start;width:100%}' +
      '#spn-topbar .tb-nav a:hover,#spn-topbar .tb-nav a:active{background:rgba(240,165,0,.1)}' +
      '#spn-topbar .tb-nav a.on{background:rgba(240,165,0,.16);border-color:rgba(240,165,0,.35)}' +
      '#spn-topbar .tb-nav a .t{display:inline!important}' +
      '#spn-topbar .tb-nav a .ic,#spn-topbar .tb-nav a>span:first-child{font-size:18px;width:24px;text-align:center;flex-shrink:0}' +
      '#spn-topbar .tb-nav a.last{margin-inline-start:0}' +
    '}' +
    '.spn-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
    '.spn-skip{position:fixed;top:-60px;inset-inline-start:12px;z-index:100000;' +
      'background:#f0a500;color:#000;font-weight:700;font-family:Sora,system-ui,sans-serif;' +
      'padding:10px 16px;border-radius:0 0 10px 10px;text-decoration:none;transition:top .18s}' +
    '.spn-skip:focus{top:0;outline:3px solid #fff;outline-offset:2px}' +
    'a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,' +
      'textarea:focus-visible,[tabindex]:focus-visible{outline:3px solid #f0a500;' +
      'outline-offset:2px;border-radius:6px}';

  function build() {
    if (document.getElementById('spn-topbar')) return;

    // Ensure the nav's font (Sora) is loaded on EVERY page, even ones that don't
    // load it themselves (e.g. Explorer). Without this the nav falls back to a
    // wider system font and the last items can overflow. Injected once.
    if (!document.querySelector('link[data-spn-nav-font]')) {
      var fl = document.createElement('link');
      fl.rel = 'stylesheet';
      fl.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;900&display=swap';
      fl.setAttribute('data-spn-nav-font', '1');
      document.head.appendChild(fl);
    }

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'spn-topbar';

    var inner = '<div class="tb-in">' +
      '<a class="tb-logo" href="explorer" aria-label="SPN Coin home"><span class="ic" aria-hidden="true">S</span><span class="txt">SPN Coin</span></a>' +
      '<button class="tb-burger" aria-label="Menu" aria-expanded="false" aria-controls="spn-nav-list">☰</button>' +
      '<div class="tb-nav" id="spn-nav-list" role="navigation" aria-label="Main navigation">';
    // Build the visible link list; append the Admin link only for an admin session.
    var links = LINKS.slice();
    if (isAdminSession()) links.push(ADMIN_LINK);
    links.forEach(function (l, i) {
      var isOn = (l.href === path || l.href === '/' + path);
      var cls = (isOn ? 'on' : '');
      if (i === links.length - 1) cls += ' last';
      inner += '<a href="' + l.href + '" title="' + l.label + '"' +
        (cls.trim() ? ' class="' + cls.trim() + '"' : '') +
        (isOn ? ' aria-current="page"' : '') + '>' +
        '<span aria-hidden="true">' + l.icon + '</span><span class="t">' + l.label + '</span></a>';
    });
    inner += '</div>';
    inner += '</div>';
    bar.innerHTML = inner;
    bar.setAttribute('role', 'banner');

    if (document.body) {
      var skip = document.createElement('a');
      skip.className = 'spn-skip';
      skip.href = '#spn-content';
      skip.textContent = 'Skip to main content';
      document.body.insertBefore(skip, document.body.firstChild);

      document.body.insertBefore(bar, skip.nextSibling);

      // ── Test-network notice banner (shown on every page) ──
      // Can be hidden by setting window.SPN_HIDE_TESTNET_BANNER = true before nav.js,
      // or dismissed by the user for the session.
      if (!window.SPN_HIDE_TESTNET_BANNER) {
        var dismissed = false;
        try { dismissed = sessionStorage.getItem('spn_testnet_dismissed') === '1'; } catch (e) {}
        if (!dismissed) {
          var lang = 'en';
          try { lang = localStorage.getItem('spn_lang') || 'en'; } catch (e) {}
          var isFa = lang === 'fa';
          var notice = document.createElement('div');
          notice.id = 'spn-testnet-banner';
          notice.setAttribute('dir', isFa ? 'rtl' : 'ltr');
          notice.style.cssText = 'background:linear-gradient(90deg,rgba(240,165,0,.14),rgba(240,165,0,.06));' +
            'border-bottom:1px solid rgba(240,165,0,.3);color:#f0c56a;font-size:12.5px;font-weight:600;' +
            'padding:8px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;' +
            'font-family:Sora,sans-serif;line-height:1.5';
          var msg = isFa
            ? '⚠️ SPN یک <b>بلاکچین واقعی مبتنی بر Proof-of-Work</b> است که در ابتدای مسیر قرار دارد و فعلاً ارزش مالی ندارد — برای کاوش، ماین و یادگیری استفاده کنید.'
            : '⚠️ SPN is a <b>live proof-of-work blockchain</b> in its early stage. It currently carries no monetary value — explore, mine and learn at your own discretion.';
          notice.innerHTML = '<span>' + msg + '</span>' +
            '<button aria-label="Dismiss" style="background:none;border:none;color:#f0c56a;cursor:pointer;' +
            'font-size:16px;line-height:1;padding:0 4px;opacity:.7">&times;</button>';
          notice.querySelector('button').onclick = function () {
            try { sessionStorage.setItem('spn_testnet_dismissed', '1'); } catch (e) {}
            notice.remove();
          };
          bar.parentNode.insertBefore(notice, bar.nextSibling);
        }
      }
    }

    // ── Hamburger toggle (mobile) ──
    var burger = bar.querySelector('.tb-burger');
    if (burger) {
      // Dimmed backdrop behind the drawer (inserted right after the topbar so the
      // CSS sibling selector can fade it in with the menu).
      var backdrop = document.createElement('div');
      backdrop.id = 'spn-nav-backdrop';
      bar.parentNode.insertBefore(backdrop, bar.nextSibling);

      function closeMenu() {
        bar.classList.remove('open');
        document.body.classList.remove('spn-nav-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.textContent = '☰';
      }
      function openMenu() {
        bar.classList.add('open');
        document.body.classList.add('spn-nav-open');
        burger.setAttribute('aria-expanded', 'true');
        burger.textContent = '✕';
      }

      burger.addEventListener('click', function (e) {
        e.stopPropagation();
        bar.classList.contains('open') ? closeMenu() : openMenu();
      });
      backdrop.addEventListener('click', closeMenu);
      // Close when a link is tapped, tapping outside, or pressing Escape.
      bar.querySelectorAll('.tb-nav a').forEach(function (a) {
        a.addEventListener('click', closeMenu);
      });
      document.addEventListener('click', function (e) {
        if (bar.classList.contains('open') && !bar.contains(e.target)) closeMenu();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMenu();
      });
    }

    if (!document.getElementById('spn-live')) {
      var live = document.createElement('div');
      live.id = 'spn-live';
      live.className = 'spn-sr-only';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      document.body.appendChild(live);
      window.spnAnnounce = function (msg) {
        try { live.textContent = ''; setTimeout(function () { live.textContent = String(msg || ''); }, 30); }
        catch (e) {}
      };
    }
    try {
      var target = document.querySelector('main')
        || document.querySelector('[role="main"]')
        || document.querySelector('.wrap, .container, .page, main, .content');
      if (!target) {
        var sib = bar.nextElementSibling;
        while (sib && (sib.id === 'spn-nav-backdrop' || sib.id === 'spn-testnet-banner')) sib = sib.nextElementSibling;
        target = sib;
      }
      if (target) {
        if (!target.id) target.id = 'spn-content';
        else { var sk = document.querySelector('.spn-skip'); if (sk) sk.setAttribute('href', '#' + target.id); }
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        if (target.tagName !== 'MAIN' && !target.getAttribute('role')) target.setAttribute('role', 'main');
      }
    } catch (e) {}
    try {
      var toasts = document.querySelectorAll('#toast, .toast, [class*="toast"]');
      toasts.forEach(function (t) {
        if (!t.getAttribute('role')) t.setAttribute('role', 'status');
        if (!t.getAttribute('aria-live')) t.setAttribute('aria-live', 'polite');
      });
    } catch (e) {}
    // If Persian is active, translate the nav labels using the shared dictionary.
    applyNavLang();
  }

  // Translate nav link labels + set RTL when Persian is chosen. Lossless: the
  // original English is stored on each label so switching back restores it.
  function applyNavLang() {
    var bar = document.getElementById('spn-topbar');
    if (!bar) return;
    var l = 'en';
    try { l = localStorage.getItem('spn_lang') || 'en'; } catch (e) {}
    var dict = (window.SPNi18n && window.SPNi18n.dict) || null;
    // Direction follows the language: Persian → RTL, English → LTR.
    if (l === 'fa') bar.setAttribute('dir', 'rtl');
    else bar.setAttribute('dir', 'ltr');
    bar.querySelectorAll('.tb-nav a .t').forEach(function (span) {
      if (!span._en) span._en = span.textContent;
      if (l === 'fa' && dict && dict[span._en]) span.textContent = dict[span._en];
      else span.textContent = span._en;
    });
  }

  // Re-apply nav language whenever the shared switcher fires.
  document.addEventListener('spn-lang-change', applyNavLang);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
