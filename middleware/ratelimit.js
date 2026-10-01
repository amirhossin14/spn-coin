/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  🛡️ Rate Limiter + DDoS Protection
//  ویژگی‌ها: Sliding Window، IP Blocking، Slowdown، Honeypot
// ════════════════════════════════════════════════════════════

// ── Sliding Window Rate Limiter ─────────────────────────────
class SlidingWindowLimiter {
    constructor({ windowMs, max, message, keyPrefix = '' }) {
        this.windowMs  = windowMs;
        this.max       = max;
        this.message   = message || 'Too many requests';
        this.keyPrefix = keyPrefix;
        this.store     = new Map(); // در production از Redis استفاده کنید
    }

    _getKey(req) {
        const ip = this._getIP(req);
        return `${this.keyPrefix}:${ip}`;
    }

    _getIP(req) {
        return (req.ip || '').trim();
    }

    _clean(record) {
        const cutoff = Date.now() - this.windowMs;
        record.hits  = record.hits.filter(t => t > cutoff);
    }

    check(req) {
        const key = this._getKey(req);
        if (!this.store.has(key)) this.store.set(key, { hits: [] });
        const record = this.store.get(key);
        this._clean(record);

        const remaining = Math.max(0, this.max - record.hits.length);
        const resetAt   = record.hits.length > 0
            ? record.hits[0] + this.windowMs
            : Date.now() + this.windowMs;

        if (record.hits.length >= this.max) {
            return { allowed: false, remaining: 0, resetAt };
        }

        record.hits.push(Date.now());
        return { allowed: true, remaining: remaining - 1, resetAt };
    }

    middleware() {
        return (req, res, next) => {
            const result = this.check(req);
            res.setHeader('X-RateLimit-Limit',     this.max);
            res.setHeader('X-RateLimit-Remaining', result.remaining);
            res.setHeader('X-RateLimit-Reset',     Math.ceil(result.resetAt / 1000));

            if (!result.allowed) {
                res.setHeader('Retry-After', Math.ceil(this.windowMs / 1000));
                return res.status(429).json({
                    error:   this.message,
                    retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
                });
            }
            next();
        };
    }
}

// ── DDoS Protection ─────────────────────────────────────────
class DDoSProtection {
    constructor() {
        this.ipStore    = new Map();  // آمار هر IP
        this.blocklist  = new Map();  // IP های block شده: ip → unblockAt
        this.whitelist  = new Set((process.env.IP_WHITELIST || '127.0.0.1,::1').split(','));

        // تنظیمات DDoS
        this.cfg = {
            reqPerSec:      parseInt(process.env.DDOS_REQ_PER_SEC)     || 50,
            blockThreshold: parseInt(process.env.DDOS_BLOCK_THRESHOLD)  || 200,
            blockDuration:  parseInt(process.env.DDOS_BLOCK_DURATION)   || 15 * 60_000,  // 15 دقیقه
            windowMs:       1000,   // پنجره 1 ثانیه
        };

        // پاکسازی خودکار
        setInterval(() => this._cleanup(), 30_000).unref();
    }

    _getIP(req) {
        return (req.ip || '').trim();
    }

    _cleanup() {
        const now = Date.now();
        for (const [ip, until] of this.blocklist) {
            if (now > until) this.blocklist.delete(ip);
        }
        for (const [ip, data] of this.ipStore) {
            if (now - data.lastSeen > 60_000) this.ipStore.delete(ip);
        }
    }

    _getRecord(ip) {
        if (!this.ipStore.has(ip)) {
            this.ipStore.set(ip, { hits: 0, windowStart: Date.now(), lastSeen: Date.now(), suspicious: 0 });
        }
        return this.ipStore.get(ip);
    }

    check(req) {
        const ip = this._getIP(req);

        // Whitelist (normalise IPv6-mapped IPv4 like ::ffff:127.0.0.1 → 127.0.0.1)
        const nip = ip.replace(/^::ffff:/, '');
        if (this.whitelist.has(ip) || this.whitelist.has(nip)) return { allowed: true, blocked: false };

        // Static assets (js/css/images/fonts/favicon) are pulled on EVERY page
        // load — a single normal user browsing a few pages fetches dozens of them.
        // Counting them here would ban a legitimate visitor, so they bypass the
        // volumetric counter. Dynamic routes (/api, POSTs, pages) are still counted.
        if (req.method === 'GET' && /\.(?:js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map|txt|json)$/i.test(req.path || ''))
            return { allowed: true };

        // بررسی block بودن
        if (this.blocklist.has(ip)) {
            const until = this.blocklist.get(ip);
            if (Date.now() < until) {
                return { allowed: false, blocked: true, until };
            }
            this.blocklist.delete(ip);
        }

        const record  = this._getRecord(ip);
        const now     = Date.now();
        record.lastSeen = now;

        // ریست پنجره
        if (now - record.windowStart > this.cfg.windowMs) {
            record.hits        = 0;
            record.windowStart = now;
        }

        record.hits++;

        // Header heuristics (soft signal only). Many LEGITIMATE clients —
        // mobile apps, API scripts, curl, monitoring/health checkers — send a
        // short or missing User-Agent / Accept. So these add only a tiny amount
        // and must NEVER be enough on their own to ban an IP; only real request
        // volume (blockThreshold) triggers a ban.
        const ua = req.headers['user-agent'] || '';
        if (!ua) record.suspicious += 1;
        // (Accept header is optional for many valid API clients — ignored.)

        // Block only on real flooding (hits per second over the threshold).
        // The suspicious score can raise the bar but can't ban by itself.
        if (record.hits >= this.cfg.blockThreshold) {
            this.blocklist.set(ip, now + this.cfg.blockDuration);
            console.warn(`🚫 [DDoS] IP block : ${ip} | hits=${record.hits} suspicious=${record.suspicious}`);
            return { allowed: false, blocked: true, until: now + this.cfg.blockDuration };
        }

        // Throttle
        if (record.hits >= this.cfg.reqPerSec) {
            return { allowed: false, blocked: false, throttled: true };
        }

        return { allowed: true };
    }

    blockIP(ip, durationMs = null) {
        this.blocklist.set(ip, Date.now() + (durationMs || this.cfg.blockDuration));
    }

    unblockIP(ip) {
        this.blocklist.delete(ip);
    }

    middleware() {
        return (req, res, next) => {
            const result = this.check(req);

            if (!result.allowed) {
                if (result.blocked) {
                    return res.status(403).json({
                        error: 'IP',
                        until: result.until
                    });
                }
                return res.status(429).json({ error: 'Too many requests' });
            }
            next();
        };
    }

    getStats() {
        return {
            blocked: this.blocklist.size,
            tracked: this.ipStore.size,
            blockedIPs: [...this.blocklist.entries()].map(([ip, until]) => ({ ip, until: new Date(until) }))
        };
    }
}

// ── Honeypot middleware (تله برای بات‌ها) ──────────────────
function honeypot() {
    const traps  = ['/admin.php', '/wp-admin', '/.env', '/phpinfo.php', '/login.php'];
    const caught = new Map();

    return (req, res, next) => {
        const path = req.path.toLowerCase();
        if (traps.some(t => path.startsWith(t))) {
            const ip = (req.ip || '').trim();
            caught.set(ip, (caught.get(ip) || 0) + 1);
            console.warn(`🍯 [Honeypot] ${ip} → ${req.path}`);
            // پاسخ تأخیردار برای مصرف منابع بات
            setTimeout(() => res.status(404).json({ error: 'Not Found' }), 2000);
            return;
        }
        next();
    };
}

// ── نمونه‌های آماده ─────────────────────────────────────────
const ddos = new DDoSProtection();

const limiters = {
    global:  new SlidingWindowLimiter({ windowMs: 60_000,   max: parseInt(process.env.RATE_GLOBAL)  || 300,  keyPrefix: 'gl',    message: 'limit' }),
    auth:    new SlidingWindowLimiter({ windowMs: 15 * 60_000, max: parseInt(process.env.RATE_AUTH) || 10,   keyPrefix: 'auth',  message: 'Login —' }),
    // Extra-strict, dedicated limiter for the login endpoint itself: at most 5
    // attempts per IP per 15 min. Layered ON TOP of `auth` and the per-account
    // lockout in access-control (5 fails ⇒ 15 min lock) to blunt brute-force.
    login:   new SlidingWindowLimiter({ windowMs: 15 * 60_000, max: parseInt(process.env.RATE_LOGIN) || 5,    keyPrefix: 'login', message: 'Too many login attempts — try again later.' }),
    api:     new SlidingWindowLimiter({ windowMs: 60_000,   max: parseInt(process.env.RATE_API)     || 100,  keyPrefix: 'api',   message: 'limit API' }),
    mining:  new SlidingWindowLimiter({ windowMs: 60_000,   max: parseInt(process.env.RATE_MINE)    || 30,   keyPrefix: 'mine',  message: 'limit mining' }),
    stratum: new SlidingWindowLimiter({ windowMs: 60_000,   max: parseInt(process.env.RATE_STRATUM) || 60,   keyPrefix: 'str',   message: 'limit Stratum' }),
};

module.exports = { SlidingWindowLimiter, DDoSProtection, honeypot, ddos, limiters };
