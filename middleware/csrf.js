/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * middleware/csrf.js — stateless CSRF protection (double-submit cookie).
 *
 * Strategy:
 *   • On any safe request we ensure the client holds a random CSRF token in a
 *     readable cookie (spn_csrf) plus a signed, HttpOnly companion cookie.
 *   • For state-changing requests (POST/PUT/PATCH/DELETE) the client must echo
 *     the token back in the `X-CSRF-Token` header. We verify the header matches
 *     the signed cookie. An attacker's cross-site form can't read the cookie,
 *     so it can't forge the header — the classic double-submit defense.
 *
 * Bearer-token API calls (Authorization: Bearer …) are exempt: they aren't sent
 * automatically by browsers, so they aren't vulnerable to CSRF. This keeps
 * programmatic API clients working while protecting cookie/session flows.
 */
'use strict';

const crypto = require('crypto');

const COOKIE = 'spn_csrf';
const SIGNED = 'spn_csrf_sig';
const HEADER = 'x-csrf-token';
// Never fall back to a static, publicly-known secret. Prefer an explicit
// CSRF_SECRET, then reuse JWT_SECRET, and only as a last resort generate a
// strong random one (with a warning) so signatures are never forgeable with a
// value that's visible in the source code.
const SECRET = (function resolveCsrfSecret() {
  const s = process.env.CSRF_SECRET || process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  console.warn('⚠️  [SECURITY] CSRF_SECRET/JWT_SECRET not set — generated a random CSRF secret for this run.');
  console.warn('   Set CSRF_SECRET (or JWT_SECRET) in your environment for stable, secure CSRF tokens.');
  return crypto.randomBytes(32).toString('hex');
})();
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(token) {
  return crypto.createHmac('sha256', SECRET).update(token).digest('hex');
}
function newToken() {
  return crypto.randomBytes(24).toString('hex');
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function timingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function middleware(opts) {
  opts = opts || {};
  const secure = opts.secure !== false; // set cookies Secure unless explicitly disabled
  return function (req, res, next) {
    const cookies = parseCookies(req);

    // Ensure a token pair exists (issue on first visit or if missing).
    var token = cookies[COOKIE];
    var signed = cookies[SIGNED];
    if (!token || !signed || !timingEqual(sign(token), signed)) {
      token = newToken();
      signed = sign(token);
      var base = 'Path=/; SameSite=Strict' + (secure ? '; Secure' : '');
      // Readable token (JS can read to echo it back) + HttpOnly signed companion.
      res.append('Set-Cookie', COOKIE + '=' + token + '; ' + base);
      res.append('Set-Cookie', SIGNED + '=' + signed + '; HttpOnly; ' + base);
    }
    // Expose for pages/templates that want to embed it.
    res.locals = res.locals || {};
    res.locals.csrfToken = token;
    req.csrfToken = function () { return token; };

    // Safe methods: no verification needed.
    if (SAFE.has(req.method)) return next();

    // Bearer-authenticated API calls are not CSRF-able — exempt them.
    var auth = req.headers.authorization || '';
    if (auth.indexOf('Bearer ') === 0) return next();

    // Verify double-submit: header must equal the signed cookie's token.
    var headerTok = req.headers[HEADER] || (req.body && req.body._csrf);
    if (!headerTok || !signed || !timingEqual(sign(String(headerTok)), signed)) {
      return res.status(403).json({ error: 'CSRF token missing or invalid', code: 'CSRF_FAILED' });
    }
    return next();
  };
}

module.exports = { middleware, COOKIE, HEADER };
