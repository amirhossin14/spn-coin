/*
 * realtime.js — client-side live feed
 * Connects to the node's /ws WebSocket and dispatches DOM events that any
 * page can listen to, plus a small toast when a new block arrives. Auto-
 * reconnects with backoff. Include with: <script src="realtime.js"></script>
 *
 * Pages can listen like:
 *   window.addEventListener('spn:block', e => { ... e.detail.height ... });
 *   window.addEventListener('spn:tx',    e => { ... e.detail.txid ... });
 */
(function () {
  'use strict';
  if (window.__spnRealtimeStarted) return;
  window.__spnRealtimeStarted = true;

  var API = window.SPN_COIN_API ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:3000' : location.origin);

  function wsUrl() {
    try {
      var u = new URL(API);
      var scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return scheme + '//' + u.host + '/ws';
    } catch (e) {
      return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
    }
  }

  var ws = null, backoff = 1000, pingTimer = null, everConnected = false;

  function setIndicator(online, height) {
    // Reuse the footer node indicator if present.
    var dot = document.getElementById('spn-nsdot');
    var txt = document.getElementById('spn-nstext');
    if (!dot || !txt) return;
    var fa = (window.SPNi18n && SPNi18n.get && SPNi18n.get() === 'fa');
    if (online) {
      dot.style.background = '#00e676';
      dot.style.boxShadow = '0 0 6px rgba(0,230,118,.6)';
      txt.textContent = (fa ? 'زنده · #' : 'Live · #') + (height != null ? height : '?');
    }
  }

  function toast(msg) {
    var t = document.getElementById('spn-rt-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'spn-rt-toast';
      t.style.cssText = 'position:fixed;bottom:74px;inset-inline-end:22px;background:rgba(14,20,27,.95);' +
        'backdrop-filter:blur(8px);border:1px solid rgba(0,230,118,.3);color:#00e676;padding:11px 18px;' +
        'border-radius:12px;font-size:13px;font-weight:600;z-index:9998;opacity:0;transform:translateY(10px);' +
        'transition:opacity .3s,transform .3s;font-family:inherit;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; }, 3500);
  }

  function connect() {
    try { ws = new WebSocket(wsUrl()); } catch (e) { return retry(); }

    ws.onopen = function () {
      everConnected = true; backoff = 1000;
      clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.type) return;

      if (m.type === 'hello') {
        setIndicator(true, m.height);
      } else if (m.type === 'block') {
        setIndicator(true, m.height);
        var fa = (window.SPNi18n && SPNi18n.get && SPNi18n.get() === 'fa');
        toast((fa ? '🧱 بلوک جدید #' : '🧱 New block #') + m.height +
              ' · ' + (m.txCount || 0) + (fa ? ' تراکنش' : ' tx'));
        window.dispatchEvent(new CustomEvent('spn:block', { detail: m }));
      } else if (m.type === 'tx') {
        window.dispatchEvent(new CustomEvent('spn:tx', { detail: m }));
      } else if (m.type === 'mempool') {
        window.dispatchEvent(new CustomEvent('spn:mempool', { detail: m }));
      }
    };

    ws.onclose = function () { clearInterval(pingTimer); retry(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function retry() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.6, 15000); // capped exponential backoff
  }

  // Expose a tiny API for pages that want to subscribe to specific channels.
  window.SPNRealtime = {
    onBlock: function (fn) { window.addEventListener('spn:block', function (e) { fn(e.detail); }); },
    onTx: function (fn) { window.addEventListener('spn:tx', function (e) { fn(e.detail); }); },
    onMempool: function (fn) { window.addEventListener('spn:mempool', function (e) { fn(e.detail); }); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
