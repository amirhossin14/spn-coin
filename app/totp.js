/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — TOTP (RFC 6238) two-factor auth
 *  Proton Authenticator & TOTP compatible: SHA-1, 6 digits, 30s period,
 *  base32 secrets, otpauth:// provisioning URIs.
 *  Dependency-free (Node crypto only).
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
    let bits = 0, value = 0, out = "";
    for (const byte of buf) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
    let bits = 0, value = 0; const out = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx === -1) continue;
        value = (value << 5) | idx; bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
}

/** Generate a random base32 secret (default 20 bytes = 160 bits). */
function generateSecret(bytes = 20) {
    return base32Encode(crypto.randomBytes(bytes));
}

/** HOTP (RFC 4226) for a given counter. */
function hotp(secretBase32, counter, digits = 6) {
    const key = base32Decode(secretBase32);
    const buf = Buffer.alloc(8);
    // 64-bit big-endian counter
    for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
    const hmac = crypto.createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
                (hmac[offset + 2] << 8) | (hmac[offset + 3]);
    return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** TOTP code for the current (or given) time. */
function totp(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
    const counter = Math.floor(time / 1000 / step);
    return hotp(secretBase32, counter, digits);
}

/**
 * Verify a submitted token, allowing ±`window` steps for clock drift.
 * Uses timing-safe comparison. Returns true/false.
 */
function verify(token, secretBase32, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
    if (!token || !secretBase32) return false;
    const t = String(token).trim();
    if (!/^\d{6,8}$/.test(t)) return false;
    const counter = Math.floor(time / 1000 / step);
    for (let w = -window; w <= window; w++) {
        const candidate = hotp(secretBase32, counter + w, digits);
        if (candidate.length === t.length &&
            crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(t))) return true;
    }
    return false;
}

/**
 * Like verify(), but returns the matched time-step counter (or -1 on failure).
 * Callers persist the last-used counter and reject reuse to stop replay of a code
 * observed (shoulder-surf / phishing proxy) within its ~90s validity window.
 */
function verifyReturningCounter(token, secretBase32, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
    if (!token || !secretBase32) return -1;
    const t = String(token).trim();
    if (!/^\d{6,8}$/.test(t)) return -1;
    const counter = Math.floor(time / 1000 / step);
    for (let w = -window; w <= window; w++) {
        const candidate = hotp(secretBase32, counter + w, digits);
        if (candidate.length === t.length &&
            crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(t))) return counter + w;
    }
    return -1;
}

/** Build an otpauth:// URI for QR provisioning (scanned by the authenticator app). */
function keyURI(account, issuer, secretBase32) {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({
        secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30",
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, hotp, totp, verify, verifyReturningCounter, keyURI, base32Encode, base32Decode };
