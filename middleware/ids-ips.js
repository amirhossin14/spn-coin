/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — IDS / IPS
 *  Intrusion Detection & Prevention System.
 *
 *   • Signature engine: SQLi, XSS, path traversal, command
 *     injection, LFI/RFI, SSRF, NoSQL injection, scanner tools,
 *     and sensitive-path recon — inspected across the method,
 *     path, query string, request body and headers.
 *   • IDS: every match is recorded as a severity-tagged event.
 *   • IPS: per-IP threat scoring with decay; offenders are
 *     auto-banned with escalating TTLs. Critical hits block on
 *     sight. A whitelist prevents self-lockout.
 *
 *  Modes (env IDS_IPS_MODE):  'ips' (detect+block, default) |
 *  'ids' (detect+log only) | 'off'.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

// ── Attack signatures ─────────────────────────────────────────
// target: 'all' (path+query+body+headers) | 'path' | 'ua'
const SIGNATURES = [
    { id: "sqli",      cat: "SQL Injection",       sev: "high",     score: 80, target: "all",
      re: /(\bunion\b\s+\bselect\b|\bselect\b\s+.+\bfrom\b|\binsert\b\s+\binto\b|\bdrop\b\s+\btable\b|\bupdate\b\s+.+\bset\b|\bdelete\b\s+\bfrom\b|(%27|')\s*(or|and)\s*(%27|')?\s*\d|--\s|\/\*.*\*\/|xp_cmdshell|information_schema|sleep\(\d|benchmark\()/i },
    { id: "xss",       cat: "Cross-Site Scripting", sev: "high",    score: 70, target: "all",
      re: /(<script\b|javascript:|onerror\s*=|onload\s*=|onmouseover\s*=|<iframe\b|<svg\b[^>]*onload|document\.cookie|<img[^>]+src\s*=\s*["']?javascript)/i },
    { id: "traversal", cat: "Path Traversal",      sev: "high",     score: 75, target: "all",
      re: /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|%252e%252e|\/etc\/passwd|\/proc\/self|\/boot\.ini|c:\\windows|win\.ini)/i },
    { id: "cmdi",      cat: "Command Injection",   sev: "critical", score: 95, target: "all",
      re: /([;|`]|\$\(|&&|\|\|)\s*(cat|ls|id|whoami|uname|wget|curl|nc |netcat|bash|\/bin\/sh|powershell|ping\s+-|rm\s+-|chmod|nslookup)\b/i },
    { id: "fileincl",  cat: "File Inclusion",      sev: "high",     score: 70, target: "all",
      re: /(php:\/\/|file:\/\/|data:\/\/text|expect:\/\/|zip:\/\/|phar:\/\/)/i },
    { id: "ssrf",      cat: "SSRF",                sev: "medium",   score: 55, target: "all",
      re: /(169\.254\.169\.254|metadata\.google\.internal|@localhost|@127\.0\.0\.1|%40127)/i },
    { id: "nosqli",    cat: "NoSQL Injection",     sev: "high",     score: 60, target: "all",
      re: /(\$where\b|\$ne\b|\$gt\b|\$lt\b|\$regex\b|\{\s*["']?\$[a-z]+["']?\s*:)/i },
    { id: "scanner",   cat: "Scanner / Tool",      sev: "medium",   score: 45, target: "ua",
      re: /(sqlmap|nikto|nmap|masscan|acunetix|nessus|dirbuster|gobuster|feroxbuster|wpscan|hydra|zgrab|nuclei|whatweb|semrushbot|censys|zmeu)/i },
    { id: "recon",     cat: "Recon / Sensitive Path", sev: "medium", score: 45, target: "path",
      re: /(\/\.env|\/\.git\/|\/wp-admin|\/wp-login|\/phpmyadmin|\/\.aws\/|\/\.ssh\/|id_rsa|\.htpasswd|\/actuator|\/console\b|\/vendor\/|\/\.vscode|\/\.docker)/i },
];

const SEV_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };

function nowMs() { return Date.now(); }
function clientIp(req) {
    // Use Express's resolved req.ip (honours the bounded `trust proxy` setting)
    // instead of the raw, client-spoofable X-Forwarded-For header.
    return String(req.ip || req.connection?.remoteAddress || "").trim();
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

class IdsIps {
    constructor(opts = {}) {
        this.mode         = opts.mode || process.env.IDS_IPS_MODE || "ips";
        this.blockScore   = opts.blockScore || 70;    // cumulative score → ban
        // At 70, a single serious attack blocks immediately (SQLi 80, XSS 70,
        // traversal 75, cmdi 95), while low-signal hits (scanner/recon 45,
        // SSRF 55, NoSQL 60) still need to accumulate — limiting false positives.
        this.decayMs      = opts.decayMs || 5 * 60 * 1000;  // score half-life
        this.baseBanMs    = opts.baseBanMs || 15 * 60 * 1000;
        this.maxBanMs     = opts.maxBanMs || 24 * 60 * 60 * 1000;
        this.maxEvents    = opts.maxEvents || 500;
        this.scorer       = opts.scorer || null;       // optional shared ThreatScorer
        this.onEvent      = opts.onEvent || null;       // optional logger callback

        this.threat   = new Map();  // ip → { score, ts }
        this.bans      = new Map();  // ip → { until, reason, count }
        this.events    = [];         // ring buffer of detections
        this.counters  = { inspected: 0, detections: 0, blocked: 0, bansIssued: 0 };

        // Whitelist — never block these.
        this.whitelist = new Set([
            "127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost",
            ...String(process.env.SECURITY_WHITELIST || "").split(",").map(s => s.trim()).filter(Boolean),
        ]);
    }

    isWhitelisted(ip) { return !ip || this.whitelist.has(ip); }

    isBanned(ip) {
        const b = this.bans.get(ip);
        if (!b) return false;
        if (nowMs() >= b.until) { this.bans.delete(ip); return false; }
        return true;
    }

    _decayedScore(ip) {
        const t = this.threat.get(ip);
        if (!t) return 0;
        const elapsed = nowMs() - t.ts;
        const decayed = t.score * Math.pow(0.5, elapsed / this.decayMs);
        return decayed < 1 ? 0 : decayed;
    }

    _addScore(ip, amount) {
        const current = this._decayedScore(ip);
        this.threat.set(ip, { score: current + amount, ts: nowMs() });
        if (this.scorer && typeof this.scorer.add === "function") {
            try { this.scorer.add(ip, "ids_signature", amount); } catch { /* ignore */ }
        }
        return current + amount;
    }

    ban(ip, reason = "manual", ms = null) {
        if (this.isWhitelisted(ip)) return false;
        const prev = this.bans.get(ip);
        const count = (prev?.count || 0) + 1;
        const duration = ms != null ? ms
            : Math.min(this.baseBanMs * Math.pow(4, count - 1), this.maxBanMs);
        this.bans.set(ip, { until: nowMs() + duration, reason, count });
        this.counters.bansIssued++;
        return { ip, reason, until: nowMs() + duration, count, durationMs: duration };
    }

    unban(ip) { return this.bans.delete(ip); }

    /** Inspect a request → array of findings. */
    inspect(req) {
        const method = (req.method || "GET").toUpperCase();
        const urlHay = safeDecode(req.originalUrl || req.url || "");
        const path   = (req.path || "").toLowerCase();
        const ua     = req.headers["user-agent"] || "";
        let bodyHay = "";
        if (req.body && typeof req.body === "object") {
            try { bodyHay = JSON.stringify(req.body).slice(0, 8000); } catch { bodyHay = ""; }
        }
        const headerHay = `${req.headers["referer"] || ""} ${req.headers["x-forwarded-for"] || ""} ${req.headers["cookie"] || ""}`;
        const allHay = `${method} ${urlHay} ${bodyHay} ${headerHay}`;

        const findings = [];
        for (const sig of SIGNATURES) {
            const hay = sig.target === "ua" ? ua : sig.target === "path" ? path : allHay;
            if (sig.re.test(hay)) {
                findings.push({ id: sig.id, category: sig.cat, severity: sig.sev, score: sig.score });
            }
        }
        return findings;
    }

    _record(ip, req, finding) {
        const ev = {
            ts: nowMs(), ip, severity: finding.severity, category: finding.category,
            rule: finding.id, method: req.method,
            path: (req.originalUrl || req.url || "").slice(0, 200),
            ua: (req.headers["user-agent"] || "").slice(0, 120),
        };
        this.events.push(ev);
        if (this.events.length > this.maxEvents) this.events.shift();
        this.counters.detections++;
        if (this.onEvent) { try { this.onEvent(ev); } catch { /* ignore */ } }
        return ev;
    }

    // ── Express middleware ────────────────────────────────────
    // 1) Fast block gate — reject already-banned IPs (runs early).
    blockGate() {
        return (req, res, next) => {
            if (this.mode === "off") return next();
            const ip = clientIp(req);
            if (this.isWhitelisted(ip)) return next();
            if (this.isBanned(ip)) {
                const b = this.bans.get(ip);
                this.counters.blocked++;
                res.setHeader("Retry-After", Math.ceil((b.until - nowMs()) / 1000));
                return res.status(403).json({ error: "Blocked by IPS", code: "IPS_BANNED", reason: b.reason });
            }
            next();
        };
    }

    // 2) Deep inspection — runs after body parsing so the body is checked.
    inspector() {
        return (req, res, next) => {
            if (this.mode === "off") return next();
            const ip = clientIp(req);
            if (this.isWhitelisted(ip)) return next();
            this.counters.inspected++;

            const findings = this.inspect(req);
            if (!findings.length) return next();

            let worst = "low", added = 0, critical = false;
            for (const f of findings) {
                this._record(ip, req, f);
                added += f.score;
                if (f.severity === "critical") critical = true;
                if (SEV_WEIGHT[f.severity] >= SEV_WEIGHT[worst]) worst = f.severity;
            }
            const total = this._addScore(ip, added);

            // IPS decision: block on a critical hit or when the score crosses the threshold.
            const shouldBlock = this.mode === "ips" && (critical || total >= this.blockScore);
            if (shouldBlock) {
                const reason = findings.map(f => f.category).join(", ");
                this.ban(ip, reason);
                this.counters.blocked++;
                console.warn(`🛡️  [IPS] Blocked ${ip} — ${reason} (score ${Math.round(total)})`);
                return res.status(403).json({ error: "Request blocked by IPS", code: "IPS_BLOCKED" });
            }
            if (this.mode === "ips" || this.mode === "ids") {
                console.warn(`🔎 [IDS] ${worst.toUpperCase()} from ${ip}: ${findings.map(f => f.category).join(", ")} (${req.method} ${req.path})`);
            }
            next();
        };
    }

    // ── Admin surface ─────────────────────────────────────────
    getEvents(limit = 100) { return this.events.slice(-limit).reverse(); }
    getBlocklist() {
        const out = [];
        for (const [ip, b] of this.bans) {
            if (nowMs() < b.until) out.push({ ip, reason: b.reason, count: b.count, expiresInSec: Math.ceil((b.until - nowMs()) / 1000) });
        }
        return out;
    }
    stats() {
        return {
            mode: this.mode,
            ...this.counters,
            trackedIps: this.threat.size,
            activeBans: this.getBlocklist().length,
            signatures: SIGNATURES.length,
            whitelistSize: this.whitelist.size,
        };
    }
}

module.exports = { IdsIps, SIGNATURES };
