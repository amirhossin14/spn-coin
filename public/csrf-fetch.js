/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * csrf-fetch.js — transparently attaches the CSRF token to state-changing
 * same-origin fetch() calls. Load this FIRST (before any other script that
 * makes requests). Reads the readable spn_csrf cookie and echoes it back in
 * the X-CSRF-Token header, satisfying the server's double-submit check.
 * Bearer-authenticated calls are left untouched (exempt server-side).
 */
(function () {
  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)spn_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  if (!window.fetch || window.__spnCsrfPatched) return;
  window.__spnCsrfPatched = true;
  var orig = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    var method = (init.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    var unsafe = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var sameOrigin = url.indexOf('http') !== 0 || url.indexOf(location.origin) === 0;
    if (unsafe && sameOrigin) {
      var headers = new Headers(init.headers || (typeof input === 'object' && input && input.headers) || {});
      if (!headers.has('Authorization') && !headers.has('X-CSRF-Token')) {
        var t = csrfToken();
        if (t) headers.set('X-CSRF-Token', t);
      }
      init.headers = headers;
    }
    return orig.call(this, input, init);
  };
})();
