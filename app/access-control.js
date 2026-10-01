/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const totp   = require('./totp');

// ─── Constants ──────────────────────────────────────────────────
const LOCK_FILE   = path.join(__dirname, '../access.lock');
const LOG_FILE    = path.join(__dirname, '../access.log');
const KEY_FILE    = path.join(__dirname, '../.access-key');
const JWT_SECRET  = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Encryption key for access.lock. It MUST stay stable across restarts, otherwise
// the previous access.lock can't be decrypted and gets wiped — destroying users
// and 2FA setup on every restart. Priority:
//   1. ACCESS_KEY env var (best for production — set your own secret)
//   2. a persisted key file (.access-key) generated once and reused
// Only if a file can't be written do we fall back to a random (non-persistent) key.
function resolveEncKey() {
    if (process.env.ACCESS_KEY) return process.env.ACCESS_KEY;
    try {
        if (fs.existsSync(KEY_FILE)) {
            const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
            if (k) return k;
        }
        const k = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
        return k;
    } catch (e) {
        // Fail closed in production: a random key wipes users/2FA on every restart.
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ [Access] ACCESS_KEY is required in production (or a writable .access-key file). Refusing to start.');
            process.exit(1);
        }
        console.warn('[Access] Could not persist encryption key; users/2FA will reset on restart. Set ACCESS_KEY to fix.');
        return crypto.randomBytes(32).toString('hex');
    }
}
const ENC_KEY     = resolveEncKey();
const TOKEN_TTL   = 8 * 60 * 60 * 1000;   // 8 ساعت
const MAX_FAILS   = 5;                      // حداکثر تلاش ناSuccess
const LOCK_TIME   = 15 * 60 * 1000;        // Lock for 15 minutes

// ─── Roles and permissions ──────────────────────────────────────────
const ROLES = {
    admin: {
        label: 'Super Admin',
        color:       '#f5a623',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet',
            'view:miners', 'view:logs', 'view:users', 'view:stats',
            'mine:blocks', 'mine:transactions',
            'transact:send',
            'admin:users', 'admin:settings', 'admin:apikeys', 'admin:logs'
        ]
    },
    miner: {
        label: 'Miner',
        color:       '#00e676',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:miners',
            'mine:blocks', 'mine:transactions'
        ]
    },
    viewer: {
        label: 'Viewer',
        color:       '#2979ff',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet'
        ]
    },
    moderator: {
        label: 'Moderator',
        color:       '#00bcd4',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet',
            'view:miners', 'view:logs', 'view:users',
            'admin:logs'
        ]
    },
    trader: {
        label: 'Trader',
        color:       '#ff9800',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet',
            'transact:send'
        ]
    },
    auditor: {
        label: 'Auditor',
        color:       '#9c27b0',
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet',
            'view:miners', 'view:logs', 'view:users', 'view:stats'
        ]
    },
    developer: {
        label: 'Developer',
        color:       '#7c4dff',
        // For building & testing the chain: broad read, mining, and sending test
        // transactions — but NOT user management, settings, or API-key admin, so
        // a dev account can't change who has access or alter production config.
        permissions: [
            'view:dashboard', 'view:blocks', 'view:transactions', 'view:wallet',
            'view:miners', 'view:logs', 'view:stats',
            'mine:blocks', 'mine:transactions',
            'transact:send',
            'admin:logs'
        ]
    },
    apikey: {
        label: 'API Key',
        color:       '#c158dc',
        // API keys are long-lived bearer secrets with no 2FA — they are READ-ONLY
        // by default. Do NOT grant 'transact:send' here (a leaked key could move
        // funds). Grant spending per-key explicitly only if you truly need it.
        permissions: [
            'view:blocks', 'view:transactions', 'view:stats'
        ]
    }
};

// ─── Default users (auto-generated on first run) ─────────
// Credentials are generated RANDOMLY at first start and printed ONCE to the
// console — they are NEVER hard-coded in the source (so they can't be read from
// the repository). Change them after first login. To pin specific credentials,
// set ADMIN_USER/ADMIN_PASS (and MINER_*/VIEWER_*) in the environment.
function randUsername(prefix) {
    return prefix + crypto.randomBytes(4).toString('hex');
}
function randPassword() {
    // 24 URL-safe chars from cryptographically-strong bytes
    return crypto.randomBytes(18).toString('base64url');
}
function buildDefaultUsers() {
    return [
    {
        id:       'admin-001',
        username: process.env.ADMIN_USER || randUsername('admin_'),
        password: process.env.ADMIN_PASS || randPassword(),
        role:     'admin',
        active:   true,
        created:  Date.now()
    },
    {
        id:       'miner-001',
        username: process.env.MINER_USER || randUsername('miner_'),
        password: process.env.MINER_PASS || randPassword(),
        role:     'miner',
        active:   true,
        created:  Date.now()
    },
    {
        id:       'viewer-001',
        username: process.env.VIEWER_USER || randUsername('viewer_'),
        password: process.env.VIEWER_PASS || randPassword(),
        role:     'viewer',
        active:   true,
        created:  Date.now()
    }
    ];
}

// ══════════════════════════════════════════════════════════════
//  AES-256-GCM encryption
// ══════════════════════════════════════════════════════════════
function encrypt(text) {
    const key  = crypto.scryptSync(ENC_KEY, 'spncoin-salt', 32);
    const iv   = crypto.randomBytes(16);
    const ciph = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc  = Buffer.concat([ciph.update(text, 'utf8'), ciph.final()]);
    const tag  = ciph.getAuthTag();
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(data) {
    const [ivHex, tagHex, encHex] = data.split(':');
    const key  = crypto.scryptSync(ENC_KEY, 'spncoin-salt', 32);
    const iv   = Buffer.from(ivHex,  'hex');
    const tag  = Buffer.from(tagHex, 'hex');
    const enc  = Buffer.from(encHex, 'hex');
    const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    return dec.update(enc, undefined, 'utf8') + dec.final('utf8');
}

// ── Password hashing — per-user random salt (scrypt) ────────
// Returns "salt:hash" — salt is stored with the hash
function hashPassword(password, salt = null) {
    const s = salt || crypto.randomBytes(32).toString('hex');
    const h = crypto.scryptSync(password, s, 64).toString('hex');
    return `${s}:${h}`;
}

// Hash a recovery code. Codes have plenty of entropy, so a keyed SHA-256 is
// enough and keeps verification fast. Deterministic so we can look codes up.
function hashRecovery(code) {
    return crypto.createHmac('sha256', ENC_KEY)
        .update(String(code || '').trim().toLowerCase().replace(/\s+/g, ''))
        .digest('hex');
}

// Constant-time comparison — prevents timing attacks
function verifyPassword(plaintext, storedHash) {
    try {
        const [salt, hash] = storedHash.split(':');
        if (!salt || !hash) return false;
        const attempt = crypto.scryptSync(plaintext, salt, 64);
        const expected = Buffer.from(hash, 'hex');
        if (attempt.length !== expected.length) return false;
        return crypto.timingSafeEqual(attempt, expected);
    } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
//  JWT ساده (بدون کتابخانه)
// ══════════════════════════════════════════════════════════════
function signToken(payload) {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body    = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    {
        const _a = Buffer.from(sig), _b = Buffer.from(parts[2] || '');
        if (_a.length !== _b.length || !crypto.timingSafeEqual(_a, _b)) return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
}

// ══════════════════════════════════════════════════════════════
//  فایل access.lock
// ══════════════════════════════════════════════════════════════
function loadLock() {
    try {
        if (!fs.existsSync(LOCK_FILE)) return initLock();
        const raw  = fs.readFileSync(LOCK_FILE, 'utf8');
        return JSON.parse(decrypt(raw));
    } catch {
        return initLock();
    }
}

function saveLock(data) {
    fs.writeFileSync(LOCK_FILE, encrypt(JSON.stringify(data)), 'utf8');
}

function initLock() {
    // Build defaults NOW (reads env vars at init time, not at module load)
    const defaults = buildDefaultUsers();
    // hash رمزها برای ذخیره امن
    const users = defaults.map(u => ({
        ...u,
        passwordHash: hashPassword(u.password),
        password:     undefined,
        apiKeys:      [],
        failCount:    0,
        lockedUntil:  null,
        lastLogin:    null,
        lastIp:       null
    }));

    const data = {
        version:  1,
        created:  Date.now(),
        users,
        apiKeys:  [],
        sessions: []
    };
    saveLock(data);
    console.log('\n🔐 [Access] access.lock created with default users');
    const _byRole = (r) => defaults.find(u => u.role === r) || {};
    const _a = _byRole('admin'), _m = _byRole('miner'), _v = _byRole('viewer');
    console.log('   📋 Admin : ' + _a.username + ' / ' + _a.password);
    console.log('   📋 Miner : ' + _m.username + ' / ' + _m.password);
    console.log('   📋 Viewer: ' + _v.username + ' / ' + _v.password);
    console.log('   ⚠️  Shown ONCE. Save them now, then change after first login!\n');
    return data;
}

// ══════════════════════════════════════════════════════════════
//  لاگ‌گذاری — Persistent, tamper-evident (hash-chained) audit log
// ══════════════════════════════════════════════════════════════
let _auditPrevHash = null;
function _loadLastHash() {
    if (_auditPrevHash !== null) return _auditPrevHash;
    try {
        const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
        if (lines.length) _auditPrevHash = JSON.parse(lines[lines.length - 1]).hash || '';
        else _auditPrevHash = '';
    } catch { _auditPrevHash = ''; }
    return _auditPrevHash;
}

function writeLog(entry) {
    const prevHash = _loadLastHash();
    const record = {
        ts:   new Date().toISOString(),
        time: new Date().toLocaleString('fa-IR'),
        ...entry,
        prevHash,
    };
    // Chain each entry to the previous one → any edit/removal breaks the chain.
    record.hash = crypto.createHash('sha256').update(prevHash + JSON.stringify(record)).digest('hex');
    _auditPrevHash = record.hash;
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
}

// Re-read the whole audit log and verify the hash chain is intact.
function verifyAuditLog() {
    let prevHash = '';
    let lines;
    try { lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean); }
    catch { return { ok: true, entries: 0, note: 'no log yet' }; }
    for (let i = 0; i < lines.length; i++) {
        let rec;
        try { rec = JSON.parse(lines[i]); } catch { return { ok: false, brokenAt: i, reason: 'unparseable line' }; }
        const stored = rec.hash;
        const copy = { ...rec }; delete copy.hash;
        const expected = crypto.createHash('sha256').update((rec.prevHash || '') + JSON.stringify(copy)).digest('hex');
        if (rec.prevHash !== prevHash) return { ok: false, brokenAt: i, reason: 'prevHash mismatch (entry inserted/removed)' };
        if (stored !== expected)      return { ok: false, brokenAt: i, reason: 'hash mismatch (entry tampered)' };
        prevHash = stored;
    }
    return { ok: true, entries: lines.length };
}

function getLogs(limit = 200) {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map(l => JSON.parse(l));
    } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
//  اکشن‌های نام‌گذاری شده برای لاگ
// ══════════════════════════════════════════════════════════════
const ACTION_LABELS = {
    'login':              'Login',
    'logout':             'logout',
    'login:failed':       'login:failed',
    'login:locked':       'Account locked',
    'view:dashboard':     'view:dashboard',
    'view:blocks':        'view:blocks',
    'view:transactions':  'view:transactions',
    'view:wallet':        'view:wallet',
    'view:miners':        'view:miners',
    'view:logs':          'view:logs',
    'mine:transactions':  'mine:transactions',
    'mine:blocks':        'mine:blocks',
    'transact:send':      'Send transaction',
    'admin:users':        'admin User',
    'admin:apikeys':      'admin API Key',
    'admin:settings':     'info',
    'user:created':       'User Create',
    'user:deleted':       'User Delete',
    'user:updated':       'User Edit',
    'apikey:created':     'API Key Create',
    'apikey:revoked':     'API Key Cancel',
    'password:changed':   'password:changed',
    'access:denied':      'Permission denied',
};

// ══════════════════════════════════════════════════════════════
//  کلاس اصلی AccessControl
// ══════════════════════════════════════════════════════════════
class AccessControl {

    constructor() {
        this.data = loadLock();
    }

    // ── login ────────────────────────────────────────────────────
    login({ username, password, totp: totpToken = null, ip = 'unknown' }) {
        const user = this.data.users.find(u => u.username === username);

        if (!user || !user.active) {
            writeLog({ action: 'login:failed', username, ip, reason: 'user not found' });
            return { ok: false, error: 'User' };
        }

        // Check قفل بودن
        if (user.lockedUntil && Date.now() < user.lockedUntil) {
            const rem = Math.ceil((user.lockedUntil - Date.now()) / 60000);
            writeLog({ action: 'login:locked', username, ip });
            return { ok: false, error: 'Account is locked. Try again in ' + rem };
        }

        // Check رمز
        if (!verifyPassword(password, user.passwordHash)) {
            user.failCount = (user.failCount || 0) + 1;
            if (user.failCount >= MAX_FAILS) {
                user.lockedUntil = Date.now() + LOCK_TIME;
                writeLog({ action: 'login:locked', username, ip, fails: user.failCount });
            } else {
                writeLog({ action: 'login:failed', username, ip, fails: user.failCount });
            }
            saveLock(this.data);
            return { ok: false, error: 'Invalid password. Attempts: ' + user.failCount + '/' + MAX_FAILS };
        }

        // Two-factor (TOTP) gate — required when the user has enabled it.
        if (user.totpEnabled && user.totpSecret) {
            if (!totpToken) {
                writeLog({ action: 'login:2fa_required', username, ip });
                return { ok: false, require2fa: true, error: 'Two-factor code required' };
            }
            // Accept either a valid TOTP code OR an unused recovery code.
            // Anti-replay: a TOTP code is valid within a ~90s window; reject any
            // code whose time-step was already consumed for this user.
            const matchedCounter = totp.verifyReturningCounter(totpToken, user.totpSecret);
            let totpOk = matchedCounter !== -1;
            if (totpOk && user.lastTotpCounter != null && matchedCounter <= user.lastTotpCounter) {
                writeLog({ action: 'login:2fa_replay', username, ip });
                return { ok: false, require2fa: true, error: 'This code was already used. Wait for the next code.' };
            }
            const recoveryOk = !totpOk && this.verifyRecoveryCode(user.id, totpToken);
            if (!totpOk && !recoveryOk) {
                user.failCount = (user.failCount || 0) + 1;
                if (user.failCount >= MAX_FAILS) user.lockedUntil = Date.now() + LOCK_TIME;
                saveLock(this.data);
                writeLog({ action: 'login:2fa_failed', username, ip, fails: user.failCount });
                return { ok: false, require2fa: true, error: 'Invalid two-factor or recovery code' };
            }
            // Remember the consumed time-step so the same code can't be replayed.
            if (totpOk) user.lastTotpCounter = matchedCounter;
        }

        // login Success
        user.failCount   = 0;
        user.lockedUntil = null;
        user.lastLogin   = Date.now();
        user.lastIp      = ip;

        const payload = {
            id:       user.id,
            username: user.username,
            role:     user.role,
            iat:      Date.now(),
            exp:      Date.now() + TOKEN_TTL
        };
        const token = signToken(payload);

        // ذخیره session
        this.data.sessions = (this.data.sessions || []).filter(s => s.userId !== user.id);
        this.data.sessions.push({ token, userId: user.id, ip, loginAt: Date.now() });

        saveLock(this.data);
        writeLog({ action: 'login', username, role: user.role, ip });

        return {
            ok:    true,
            token,
            user:  { id: user.id, username: user.username, role: user.role, label: ROLES[user.role]?.label }
        };
    }

    // ── Exit ────────────────────────────────────────────────────
    logout(token, ip = 'unknown') {
        const payload = verifyToken(token);
        this.data.sessions = (this.data.sessions || []).filter(s => s.token !== token);
        saveLock(this.data);
        if (payload) writeLog({ action: 'logout', username: payload.username, role: payload.role, ip });
        return { ok: true };
    }

    // ── Confirm Token ─────────────────────────────────────────────
    authenticate(token) {
        const payload = verifyToken(token);
        if (!payload) return null;
        const user = this.data.users.find(u => u.id === payload.id);
        if (!user || !user.active) return null;
        return { ...payload, permissions: ROLES[payload.role]?.permissions || [] };
    }

    // ── Confirm API Key ────────────────────────────────────────────
    authenticateApiKey(key) {
        const entry = (typeof key === 'string' && key.length)
            ? this.data.apiKeys?.find(k => k.active && typeof k.key === 'string'
                && k.key.length === key.length
                && crypto.timingSafeEqual(Buffer.from(k.key), Buffer.from(key)))
            : null;
        if (!entry) return null;
        entry.lastUsed = Date.now();
        entry.useCount = (entry.useCount || 0) + 1;
        saveLock(this.data);
        return {
            id:          entry.id,
            username:    entry.name,
            role:        'apikey',
            permissions: ROLES.apikey.permissions
        };
    }

    // ── Check مجوز ──────────────────────────────────────────────
    can(user, permission) {
        return user?.permissions?.includes(permission) || false;
    }

    // ── Middleware برای Express ──────────────────────────────────
    middleware(permission = null) {
        return (req, res, next) => {
            // Check API Key در header
            const apiKey = req.headers['x-api-key'];
            if (apiKey) {
                const user = this.authenticateApiKey(apiKey);
                if (user) {
                    req.user = user;
                    if (permission && !this.can(user, permission)) {
                        writeLog({ action: 'access:denied', username: user.username, permission, ip: req.ip, path: req.path });
                        return res.status(403).json({ error: 'Permission denied', required: permission });
                    }
                    return next();
                }
            }

            // Check JWT Token
            const auth  = req.headers['authorization'] || '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.cookies?.token;

            const user = this.authenticate(token);
            if (!user) {
                return res.status(401).json({ error: 'info', code: 'UNAUTHORIZED' });
            }

            req.user = user;

            if (permission && !this.can(user, permission)) {
                writeLog({ action: 'access:denied', username: user.username, role: user.role, permission, ip: req.ip, path: req.path });
                return res.status(403).json({ error: 'Permission denied', required: permission });
            }

            next();
        };
    }

    // ── Operation log ──────────────────────────────────────────────
    log(req, action, details = {}) {
        if (!req.user) return;
        writeLog({
            action,
            label:    ACTION_LABELS[action] || action,
            username: req.user.username,
            role:     req.user.role,
            ip:       req.ip || req.connection?.remoteAddress || 'unknown',
            path:     req.path,
            method:   req.method,
            ...details
        });
    }

    // ── مدیریت Userان ──────────────────────────────────────────
    getUsers() {
        return this.data.users.map(u => ({
            id:          u.id,
            username:    u.username,
            role:        u.role,
            roleLabel:   ROLES[u.role]?.label,
            active:      u.active,
            totpEnabled: !!u.totpEnabled,
            created:     u.created,
            lastLogin:   u.lastLogin,
            lastIp:      u.lastIp,
            failCount:   u.failCount || 0,
            lockedUntil: u.lockedUntil,
            isLocked:    u.lockedUntil && Date.now() < u.lockedUntil
        }));
    }

    // ── Two-factor authentication (TOTP / Proton Authenticator) ──
    getTotpStatus(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return { enabled: false };
        return { enabled: !!user.totpEnabled };
    }

    // Begin enrollment: create a pending secret and return the provisioning
    // URI/secret so the user can add it to their authenticator app. Not active
    // until confirmTotp() succeeds with a valid code.
    setupTotp(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return { ok: false, error: 'User not found' };
        if (user.totpEnabled) return { ok: false, error: 'Two-factor is already enabled' };

        const secret = totp.generateSecret();
        user.totpPending = secret;
        saveLock(this.data);

        const issuer = (() => { try { return require('../config').COIN.NAME; } catch { return 'SPN Coin'; } })();
        return {
            ok: true,
            secret,
            otpauthUrl: totp.keyURI(user.username, issuer, secret),
            issuer,
        };
    }

    // Verify the first code against the pending secret and switch 2FA on.
    confirmTotp(userId, token) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return { ok: false, error: 'User not found' };
        if (!user.totpPending) return { ok: false, error: 'Start setup first' };
        if (!totp.verify(token, user.totpPending))
            return { ok: false, error: 'Invalid code. Check your authenticator app and try again.' };

        user.totpSecret  = user.totpPending;
        user.totpEnabled = true;
        delete user.totpPending;

        // Generate 16 one-time recovery codes. Show the plaintext to the user
        // ONCE now; store only salted hashes so they can't be read from the lock.
        const plainCodes = [];
        user.recoveryCodes = [];
        for (let i = 0; i < 16; i++) {
            // format: XXXX-XXXX (8 hex chars, easy to read/type)
            const raw = crypto.randomBytes(4).toString('hex');
            const code = raw.slice(0, 4) + '-' + raw.slice(4, 8);
            plainCodes.push(code);
            user.recoveryCodes.push({ hash: hashRecovery(code), used: false });
        }

        saveLock(this.data);
        writeLog({ action: '2fa:enabled', username: user.username });
        return { ok: true, enabled: true, recoveryCodes: plainCodes };
    }

    // Verify a recovery code (used when the user lost their authenticator).
    // Each code works once; it's marked used on success.
    verifyRecoveryCode(userId, code) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user || !user.totpEnabled || !Array.isArray(user.recoveryCodes)) return false;
        const norm = String(code || '').trim().toLowerCase().replace(/\s+/g, '');
        const h = hashRecovery(norm);
        const entry = user.recoveryCodes.find(rc => !rc.used && rc.hash === h);
        if (!entry) return false;
        entry.used = true;
        saveLock(this.data);
        writeLog({ action: '2fa:recovery-used', username: user.username });
        return true;
    }

    // How many unused recovery codes remain.
    recoveryCodesRemaining(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user || !Array.isArray(user.recoveryCodes)) return 0;
        return user.recoveryCodes.filter(rc => !rc.used).length;
    }

    // Regenerate a fresh set of recovery codes (invalidates the old ones).
    regenerateRecoveryCodes(userId, token) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return { ok: false, error: 'User not found' };
        if (!user.totpEnabled) return { ok: false, error: 'Two-factor is not enabled' };
        if (!totp.verify(token, user.totpSecret))
            return { ok: false, error: 'Invalid code' };
        const plainCodes = [];
        user.recoveryCodes = [];
        for (let i = 0; i < 16; i++) {
            const raw = crypto.randomBytes(4).toString('hex');
            const code = raw.slice(0, 4) + '-' + raw.slice(4, 8);
            plainCodes.push(code);
            user.recoveryCodes.push({ hash: hashRecovery(code), used: false });
        }
        saveLock(this.data);
        writeLog({ action: '2fa:recovery-regenerated', username: user.username });
        return { ok: true, recoveryCodes: plainCodes };
    }

    // Turn 2FA off — requires a valid current code to prevent lockout abuse.
    disableTotp(userId, token) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) return { ok: false, error: 'User not found' };
        if (!user.totpEnabled) return { ok: false, error: 'Two-factor is not enabled' };
        if (!totp.verify(token, user.totpSecret))
            return { ok: false, error: 'Invalid code' };

        delete user.totpSecret;
        delete user.totpPending;
        user.totpEnabled = false;
        saveLock(this.data);
        writeLog({ action: '2fa:disabled', username: user.username });
        return { ok: true, enabled: false };
    }

    createUser({ username, password, role }, creatorUsername) {
        // Validate BEFORE creating — reject bad input rather than silently mutating it.
        username = String(username ?? '').trim();
        password = String(password ?? '');

        // Username: 3–32 chars, letters/digits/underscore/hyphen only.
        if (username.length < 3 || username.length > 32)
            return { ok: false, error: 'Username must be 3-32 characters long' };
        if (!/^[a-zA-Z0-9_-]+$/.test(username))
            return { ok: false, error: 'Username may only contain letters, digits, underscore and hyphen' };

        // Password: 8–128 chars, and must not be trivially weak.
        if (password.length < 8)
            return { ok: false, error: 'Password must be at least 8 characters' };
        if (password.length > 128)
            return { ok: false, error: 'Password must be at most 128 characters' };
        if (password.toLowerCase() === username.toLowerCase())
            return { ok: false, error: 'Password must not be the same as the username' };

        // Role: default to the least-privileged role when omitted; reject invalid.
        if (role === undefined || role === null || role === '') {
            role = 'viewer';
        } else if (!ROLES[role]) {
            return { ok: false, error: `Invalid role. Allowed: ${Object.keys(ROLES).join(', ')}` };
        }

        // Duplicate check is case-insensitive (prevents "Admin" vs "admin" impersonation).
        if (this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
            return { ok: false, error: 'Username already taken' };

        const user = {
            id:           `${role}-${Date.now()}`,
            username,
            passwordHash: hashPassword(password),
            role,
            active:       true,
            created:      Date.now(),
            failCount:    0,
            lockedUntil:  null,
            lastLogin:    null,
            lastIp:       null
        };
        this.data.users.push(user);
        saveLock(this.data);
        writeLog({ action: 'user:created', username: creatorUsername, target: username, role });
        return { ok: true, user: { id: user.id, username, role } };
    }

    updateUser(id, updates, editorUsername) {
        const user = this.data.users.find(u => u.id === id);
        if (!user) return { ok: false, error: 'User Not found' };

        // ── Optional username change (rename). Safe because the account's real
        //    identity is its `id`, not the username. We still enforce the same
        //    format rules as creation, a case-insensitive uniqueness check, and
        //    an audit-log entry (admin-only, behind auth + 2FA). ──
        if (updates.username !== undefined) {
            const nu = String(updates.username).trim();
            if (nu && nu !== user.username) {
                if (nu.length < 3 || nu.length > 32)
                    return { ok: false, error: 'Username must be 3-32 characters long' };
                if (!/^[a-zA-Z0-9_-]+$/.test(nu))
                    return { ok: false, error: 'Username may only contain letters, digits, underscore and hyphen' };
                if (this.data.users.find(u => u.id !== id && u.username.toLowerCase() === nu.toLowerCase()))
                    return { ok: false, error: 'Username already exists' };
                const old = user.username;
                user.username = nu;
                writeLog({ action: 'username:changed', username: editorUsername, target: old, to: nu });
            }
        }

        if (updates.password) {
            user.passwordHash = hashPassword(updates.password);
            writeLog({ action: 'password:changed', username: editorUsername, target: user.username });
        }
        if (updates.role)   {
            if (!ROLES[updates.role]) return { ok: false, error: `Invalid role. Allowed: ${Object.keys(ROLES).join(', ')}` };
            user.role = updates.role;
        }
        if (updates.active !== undefined) { user.active = updates.active; }
        if (updates.unlock) { user.failCount = 0; user.lockedUntil = null; }

        saveLock(this.data);
        writeLog({ action: 'user:updated', username: editorUsername, target: user.username, updates: Object.keys(updates) });
        return { ok: true };
    }

    deleteUser(id, deleterUsername) {
        const idx = this.data.users.findIndex(u => u.id === id);
        if (idx === -1) return { ok: false, error: 'User Not found' };
        const [removed] = this.data.users.splice(idx, 1);
        saveLock(this.data);
        writeLog({ action: 'user:deleted', username: deleterUsername, target: removed.username });
        return { ok: true };
    }

    // ── مدیریت API Key ───────────────────────────────────────────
    getApiKeys() {
        return (this.data.apiKeys || []).map(k => ({
            id:        k.id,
            name:      k.name,
            key:       k.key.substring(0, 8) + '...',  // نمایش جزئی
            active:    k.active,
            created:   k.created,
            lastUsed:  k.lastUsed,
            useCount:  k.useCount || 0
        }));
    }

    createApiKey({ name }, creatorUsername) {
        const key = 'myc_' + crypto.randomBytes(24).toString('hex');
        const entry = {
            id:       `key-${Date.now()}`,
            name,
            key,
            active:   true,
            created:  Date.now(),
            lastUsed: null,
            useCount: 0
        };
        if (!this.data.apiKeys) this.data.apiKeys = [];
        this.data.apiKeys.push(entry);
        saveLock(this.data);
        writeLog({ action: 'apikey:created', username: creatorUsername, keyName: name });
        return { ok: true, key };  // کلید کامل فقط یک‌بار نمایش داده می‌شود
    }

    revokeApiKey(id, revokerUsername) {
        const key = (this.data.apiKeys || []).find(k => k.id === id);
        if (!key) return { ok: false, error: 'Not found' };
        key.active = false;
        saveLock(this.data);
        writeLog({ action: 'apikey:revoked', username: revokerUsername, keyName: key.name });
        return { ok: true };
    }

    // ── لاگ‌ها ──────────────────────────────────────────────────
    getLogs(limit = 200, filter = {}) {
        let logs = getLogs(limit * 2);
        if (filter.username) logs = logs.filter(l => l.username === filter.username);
        if (filter.action)   logs = logs.filter(l => l.action?.startsWith(filter.action));
        if (filter.role)     logs = logs.filter(l => l.role === filter.role);
        return logs.slice(0, limit);
    }

    // ── اطلاعات role‌ها ───────────────────────────────────────────
    getRoles() { return ROLES; }
}

// singleton
const ac = new AccessControl();
module.exports = { ac, ROLES, ACTION_LABELS, verifyAuditLog };

// ── Methodهای اضافه برای سازگاری با server.js ──────────────────
AccessControl.prototype.getUserById = function(id) {
    const u = (this.data.users || []).find(u => u.id === id);
    if (!u) return null;
    return { id: u.id, username: u.username, role: u.role, permissions: (ROLES[u.role]?.permissions || []) };
};

AccessControl.prototype.hasPerm = function(user, perm) {
    if (!user || !perm) return true;
    const u = (this.data.users || []).find(u => u.id === user.id);
    if (!u) return false;
    const perms = ROLES[u.role]?.permissions || [];
    return perms.includes(perm);
};
