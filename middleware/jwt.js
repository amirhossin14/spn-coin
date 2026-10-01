/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  🔑 JWT Authentication Middleware
//  ویژگی‌ها: Access Token + Refresh Token + Blacklist
// ════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ── تنظیمات ────────────────────────────────────────────────
// ── JWT secrets — MUST be set via environment variables ───────
// If not set: warn loudly and use a per-process random secret
// (all sessions invalidated on restart — NOT suitable for production)
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        // Fail closed in production: a random per-process secret invalidates all
        // sessions on restart and diverges across nodes in a cluster. BOTH the
        // access and refresh secrets must be set.
        console.error('❌ [SECURITY] JWT_SECRET and JWT_REFRESH_SECRET are both required in production. Refusing to start.');
        console.error('   Set JWT_SECRET=<64-char-hex> and JWT_REFRESH_SECRET=<64-char-hex> in your environment.');
        process.exit(1);
    }
    console.error('⚠️  [SECURITY] JWT_SECRET / JWT_REFRESH_SECRET not set in environment!');
    console.error('   All sessions will be invalidated on every restart.');
    console.error('   Set JWT_SECRET and JWT_REFRESH_SECRET (64-char hex each) in your .env file.');
}
const JWT_SECRET         = process.env.JWT_SECRET         || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
const ACCESS_TTL        = parseInt(process.env.JWT_ACCESS_TTL)  || 15 * 60;        // 15 دقیقه
const REFRESH_TTL       = parseInt(process.env.JWT_REFRESH_TTL) || 7 * 24 * 3600;  // 7 روز

// ── Token blacklist (revoked tokens) ────────────────────────
// Revoked tokens must survive process restarts, otherwise a token revoked for
// security reasons becomes valid again after a restart. We use Redis when it's
// available (REDIS_URL set) so the blacklist is durable and shared across all
// nodes; otherwise we fall back to an in-memory Set (fine for single-node dev,
// but a restart clears it — a warning is printed once).
const blacklist = new Set();           // in-memory fallback / cache
let redisClient = null;
(function initRedisBlacklist() {
    if (!process.env.REDIS_URL) {
        console.warn('ℹ️  [JWT] REDIS_URL not set — token blacklist is in-memory only (cleared on restart). Set REDIS_URL for durable, multi-node revocation.');
        return;
    }
    try {
        const { createClient } = require('redis');
        redisClient = createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', (e) => console.warn('[JWT] Redis blacklist error:', e.message));
        redisClient.connect().catch((e) => {
            console.warn('[JWT] Redis connect failed, using in-memory blacklist:', e.message);
            redisClient = null;
        });
    } catch (e) {
        console.warn('[JWT] redis module not available, using in-memory blacklist.');
        redisClient = null;
    }
})();

// Mark a token revoked in Redis (durable) and in the local cache.
function _blacklistAdd(token, ttlSeconds) {
    blacklist.add(token);
    if (redisClient) {
        // key expires exactly when the token would, so Redis self-cleans
        redisClient.set('bl:' + token, '1', { EX: Math.max(1, ttlSeconds || REFRESH_TTL) })
            .catch(() => {});
    }
}
// Check revocation: local cache first (fast), then Redis (durable) as fallback.
async function _isBlacklisted(token) {
    if (blacklist.has(token)) return true;
    if (redisClient) {
        try { return !!(await redisClient.get('bl:' + token)); } catch { return false; }
    }
    return false;
}

setInterval(() => {
    // پاکسازی خودکار توکن‌های منقضی از کش محلی
    const now = Math.floor(Date.now() / 1000);
    for (const t of blacklist) {
        try {
            const payload = _decode(t);
            if (payload.exp < now) blacklist.delete(t);
        } catch { blacklist.delete(t); }
    }
}, 60_000).unref(); // unref: housekeeping timer must not keep the process/tests alive

// ── Base64url helpers ───────────────────────────────────────
const b64e = s => Buffer.from(s).toString('base64url');
const b64d = s => Buffer.from(s, 'base64url').toString('utf8');

function _sign(payload, secret) {
    const header = b64e(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body   = b64e(JSON.stringify(payload));
    const sig    = crypto.createHmac('sha256', secret)
        .update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function _verify(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid_token');
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret)
        .update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
        throw new Error('invalid_signature');
    const payload = JSON.parse(b64d(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
        throw new Error('token_expired');
    return payload;
}

function _decode(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid_token');
    return JSON.parse(b64d(parts[1]));
}

// ════════════════════════════════════════════════════════════
//  توابع اصلی
// ════════════════════════════════════════════════════════════
function createTokens(user, opts = {}) {
    const now = Math.floor(Date.now() / 1000);
    const accessPayload = {
        sub:  user.id,
        user: { id: user.id, username: user.username, role: user.role },
        iat:  now,
        exp:  now + ACCESS_TTL,
        type: 'access'
    };
    // A "pending 2FA" token is issued after a correct password when the account
    // must still enroll in two-factor auth. It can ONLY reach the 2FA-setup
    // endpoints (see jwtMiddleware) — never protected data — until 2FA is on.
    if (opts.pending2fa) accessPayload.pending2fa = true;
    const refreshPayload = {
        sub:  user.id,
        jti:  crypto.randomBytes(16).toString('hex'),  // یکتا برای هر refresh
        iat:  now,
        exp:  now + REFRESH_TTL,
        type: 'refresh'
    };
    return {
        accessToken:  _sign(accessPayload,  JWT_SECRET),
        refreshToken: _sign(refreshPayload, JWT_REFRESH_SECRET),
        expiresIn:    ACCESS_TTL
    };
}

function verifyAccess(token) {
    if (blacklist.has(token)) throw new Error('token_revoked');
    return _verify(token, JWT_SECRET);
}

function verifyRefresh(token) {
    if (blacklist.has(token)) throw new Error('token_revoked');
    return _verify(token, JWT_REFRESH_SECRET);
}

// Revoke a token. Stored in the local cache immediately (so it's blocked on
// this node right away) and in Redis (so the revocation survives restarts and
// is seen by every node). TTL is set to the token's own remaining lifetime.
function revokeToken(token) {
    let ttl = REFRESH_TTL;
    try {
        const payload = _decode(token);
        if (payload && payload.exp) ttl = Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
    } catch { /* keep default ttl */ }
    _blacklistAdd(token, ttl);
}

// On startup, warm the local cache from Redis so revocations made before a
// restart are enforced immediately (defence in depth alongside per-check reads).
async function loadRevokedFromRedis() {
    if (!redisClient) return;
    try {
        for await (const key of redisClient.scanIterator({ MATCH: 'bl:*', COUNT: 500 })) {
            blacklist.add(key.slice(3));
        }
    } catch { /* best effort */ }
}
setTimeout(() => { loadRevokedFromRedis().catch(() => {}); }, 2000).unref();

// ── Express Middleware ──────────────────────────────────────
function jwtMiddleware(required = true) {
    return async (req, res, next) => {
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

        if (!token) {
            if (!required) return next();
            return res.status(401).json({ error: 'Token not provided' });
        }

        try {
            const payload = verifyAccess(token);
            // Also consult the durable (Redis) blacklist, not just the in-memory
            // cache — otherwise a token revoked on another node (or before a
            // restart) would still be accepted here.
            if (await _isBlacklisted(token)) {
                return res.status(401).json({ error: 'token_revoked', code: 'TOKEN_REVOKED' });
            }
            req.user      = payload.user;
            req.jwtToken  = token;
            req.pending2fa = !!payload.pending2fa;
            // A pending-2FA token is restricted to the 2FA enrollment endpoints
            // (plus identity/logout). Any other route is refused until 2FA is on.
            if (req.pending2fa) {
                const p = (req.originalUrl || req.url || '').split('?')[0];
                const allowed = [
                    '/api/auth/2fa/setup',
                    '/api/auth/2fa/confirm',
                    '/api/auth/2fa/status',
                    '/api/auth/me',
                    '/api/auth/logout',
                ];
                if (!allowed.includes(p)) {
                    return res.status(403).json({ error: 'Two-factor setup required', code: 'TWO_FA_SETUP_REQUIRED' });
                }
            }
            next();
        } catch (e) {
            const code = e.message === 'token_expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
            return res.status(401).json({ error: e.message, code });
        }
    };
}

module.exports = { createTokens, verifyAccess, verifyRefresh, revokeToken, jwtMiddleware, ACCESS_TTL, REFRESH_TTL };
