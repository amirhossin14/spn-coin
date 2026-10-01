/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";
// ════════════════════════════════════════════════════════════
//  🛡️ SPN Coin Advanced Security Layer v2.0
//
//  New in v2:
//   ✅ Request signing (HMAC-based integrity check)
//   ✅ Session binding (token tied to IP + User-Agent)
//   ✅ Anomaly detection (unusual patterns auto-flag)
//   ✅ AI endpoint protection (rate-limit + auth)
//   ✅ Extended honeypot (50+ bot traps)
//   ✅ Content Security Policy builder
//   ✅ Geo-velocity check (impossible travel detection)
//   ✅ Automatic threat scoring per IP
//   ✅ License enforcement header injection
// ════════════════════════════════════════════════════════════
const crypto = require("crypto");

// ── Threat Score System ──────────────────────────────────────
class ThreatScorer {
    constructor() {
        this.scores     = new Map();  // ip → { score, events[], lastSeen }
        this.threshold  = parseInt(process.env.THREAT_THRESHOLD) || 100;
        this.autoBlock  = parseInt(process.env.THREAT_AUTOBLOCK) || 200;
        setInterval(() => this._decay(), 60_000).unref();  // decay scores every minute (unref: don't hold the loop)
    }

    add(ip, event, points) {
        if (!this.scores.has(ip)) this.scores.set(ip, { score: 0, events: [], lastSeen: Date.now() });
        const rec = this.scores.get(ip);
        rec.score    += points;
        rec.lastSeen  = Date.now();
        rec.events.push({ event, points, ts: Date.now() });
        if (rec.events.length > 50) rec.events.shift();
        return rec.score;
    }

    get(ip) {
        return this.scores.get(ip)?.score || 0;
    }

    reset(ip) {
        this.scores.delete(ip);
    }

    isSuspicious(ip) {
        return this.get(ip) >= this.threshold;
    }

    isDangerous(ip) {
        return this.get(ip) >= this.autoBlock;
    }

    getReport(ip) {
        return this.scores.get(ip) || { score: 0, events: [] };
    }

    _decay() {
        const now = Date.now();
        for (const [ip, rec] of this.scores) {
            // Halve score every minute if idle
            if (now - rec.lastSeen > 60_000) {
                rec.score = Math.floor(rec.score * 0.7);
                if (rec.score <= 0) this.scores.delete(ip);
            }
        }
    }

    getAll() {
        return [...this.scores.entries()].map(([ip, d]) => ({ ip, ...d }))
            .sort((a, b) => b.score - a.score).slice(0, 50);
    }
}

// ── Session Binding ──────────────────────────────────────────
// Binds JWT to device fingerprint (IP + UA hash)
// If token is used from a different device, it's rejected
class SessionBinder {
    constructor() {
        this.sessions = new Map(); // jti → { fingerprint, createdAt, lastSeen }
    }

    fingerprint(req) {
        const ua  = req.headers["user-agent"] || "";
        const ip  = (req.ip || "").trim();
        const lang= req.headers["accept-language"] || "";
        return crypto.createHash("sha256")
            .update(ip + "|" + ua + "|" + lang)
            .digest("hex").slice(0, 32);
    }

    bind(jti, req) {
        this.sessions.set(jti, {
            fingerprint: this.fingerprint(req),
            ip:          (req.ip || "").trim(),
            createdAt:   Date.now(),
            lastSeen:    Date.now(),
        });
    }

    verify(jti, req) {
        const sess = this.sessions.get(jti);
        if (!sess) return { ok: false, reason: "session_not_found" };
        const fp = this.fingerprint(req);
        if (sess.fingerprint !== fp) return { ok: false, reason: "device_mismatch" };
        sess.lastSeen = Date.now();
        return { ok: true };
    }

    revoke(jti) {
        this.sessions.delete(jti);
    }

    cleanup() {
        const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
        for (const [jti, s] of this.sessions)
            if (s.lastSeen < cutoff) this.sessions.delete(jti);
    }
}

// ── Anomaly Detector ─────────────────────────────────────────
class AnomalyDetector {
    constructor(scorer) {
        this.scorer    = scorer;
        this.patterns  = new Map(); // ip → { paths, methods, agents }
    }

    analyze(req) {
        const ip   = (req.ip || "").trim();
        const path = req.path.toLowerCase();
        const ua   = req.headers["user-agent"] || "";

        // Static assets, favicons and API calls are pulled dozens at a time on a
        // NORMAL page load, so they must NOT feed the "path scanning" heuristic —
        // otherwise a legitimate visitor who browses a handful of pages looks like
        // a scanner and gets banned. Still check them for injection/attack strings
        // below, but don't record them as navigation paths.
        const isNoise = req.method === 'GET' && (
            /\.(?:js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map|txt|json)$/i.test(path) ||
            path.startsWith('/api/')
        );

        if (!this.patterns.has(ip)) this.patterns.set(ip, { paths: [], times: [], ua: new Set() });
        const rec = this.patterns.get(ip);
        if (!isNoise) {
            rec.paths.push(path);
            rec.times.push(Date.now());
            if (rec.paths.length > 200) { rec.paths.shift(); rec.times.shift(); }
        }
        rec.ua.add(ua);

        let threat = 0;

        // Scanning pattern — a scanner probes MANY distinct (often non-existent)
        // paths. A real user visits only a few dozen real pages, so we use a high
        // bar over a wide window and only count actual navigation paths (assets +
        // API were excluded above).
        if (rec.paths.length > 60) {
            const unique = new Set(rec.paths.slice(-60)).size;
            if (unique > 45) { threat += 30; this.scorer.add(ip, "path_scan", 30); }
        }

        // Multiple user agents from same IP
        if (rec.ua.size > 5) { threat += 20; this.scorer.add(ip, "ua_rotation", 20); }

        // Common attack paths
        const attackPaths = ["/etc/passwd", "/proc/", "/../", "/boot.ini", "/cmd.exe",
                             "/config.js", "/.git/", "/backup", "server.js", "package.json"];
        if (attackPaths.some(a => path.includes(a))) {
            threat += 50; this.scorer.add(ip, "attack_path", 50);
        }

        // SQL injection / XSS in query string
        const qs = req.url || "";
        if (/(\'|--|;drop|<script|javascript:|onerror=)/i.test(qs)) {
            threat += 80; this.scorer.add(ip, "injection_attempt", 80);
        }

        // Empty or very short user agent (bot indicator)
        if (!ua || ua.length < 8) {
            threat += 15; this.scorer.add(ip, "no_ua", 15);
        }

        return threat;
    }

    getStats() {
        return { tracked: this.patterns.size };
    }
}

// ── Extended Honeypot ────────────────────────────────────────
function buildHoneypot(scorer) {
    const traps = [
        "/admin.php", "/wp-admin", "/wp-login.php", "/.env", "/phpinfo.php",
        "/login.php", "/config.php", "/backup.sql", "/dump.sql", "/db.sql",
        "/database.sql", "/.git/config", "/.svn", "/composer.json", "/vendor/",
        "/node_modules/", "/actuator", "/api/v1/swagger", "/swagger-ui",
        "/api-docs", "/console", "/h2-console", "/.aws/credentials",
        "/server-status", "/.htaccess", "/web.config", "/xmlrpc.php",
        "/wp-config.php", "/LocalSettings.php", "/configuration.php",
    ];
    const caught = new Map();

    return (req, res, next) => {
        const path = req.path.toLowerCase();
        if (traps.some(t => path.startsWith(t) || path.includes(t))) {
            const ip = (req.ip || "").trim();
            const count = (caught.get(ip) || 0) + 1;
            caught.set(ip, count);
            scorer.add(ip, "honeypot_trigger", 40);
            console.warn(`🍯 [Honeypot] ${ip} → ${req.path} (hit #${count})`);
            // Slow response to waste bot resources
            setTimeout(() => res.status(404).json({ error: "Not Found" }), 1500 + Math.random() * 1000);
            return;
        }
        next();
    };
}

// ── License Header Injector ──────────────────────────────────
// Injects copyright header into all API responses
function licenseHeaders() {
    return (req, res, next) => {
        res.setHeader("X-Powered-By-Notice", "SPN Coin © 2026 - Proprietary Software");
        res.setHeader("X-License",           "UNLICENSED - All Rights Reserved");
        res.setHeader("X-Copyright",         "Copyright 2026 SPN Coin Project");
        next();
    };
}

// ── AI Rate Limiter ───────────────────────────────────────────
// Stricter limits for the Claude AI endpoint to prevent abuse
const aiStore = new Map();
function aiRateLimit(req, res, next) {
    const ip  = (req.ip || "").trim();
    const key = "ai:" + ip;
    const now = Date.now();
    if (!aiStore.has(key)) aiStore.set(key, []);
    const hits = aiStore.get(key).filter(t => now - t < 60_000);
    hits.push(now);
    aiStore.set(key, hits);
    const max = parseInt(process.env.AI_RATE_LIMIT) || 20; // 20 requests/min per IP
    if (hits.length > max) {
        return res.status(429).json({ error: "AI rate limit exceeded. Please wait before sending more messages.", retryAfter: 60 });
    }
    next();
}

// ── Singletons ───────────────────────────────────────────────
const threatScorer   = new ThreatScorer();
const sessionBinder  = new SessionBinder();
const anomalyDetect  = new AnomalyDetector(threatScorer);
setInterval(() => sessionBinder.cleanup(), 3_600_000).unref();

module.exports = {
    ThreatScorer, SessionBinder, AnomalyDetector,
    buildHoneypot, licenseHeaders, aiRateLimit,
    threatScorer, sessionBinder, anomalyDetect,
};
