/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  hardening.js — Request-level input validation & attack hardening.
 *
 *  Complements the DDoS guard (volumetric) with content-level defenses:
 *
 *   1. Prototype-pollution guard  — reject bodies containing __proto__,
 *      constructor, prototype keys (a classic Node.js RCE/DoS vector).
 *   2. Depth / size limits        — reject deeply nested or oversized
 *      JSON that can exhaust CPU/stack.
 *   3. Field validators           — small, composable validators for the
 *      value types this API actually uses (addresses, amounts, hex,
 *      hashes) so routes stop hand-rolling checks.
 *   4. Request IDs                — attach a correlation id to every
 *      request/response for tracing and abuse investigation.
 *
 *  All fail-safe and dependency-free.
 */

'use strict';

const crypto = require('crypto');

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = parseInt(process.env.MAX_JSON_DEPTH, 10) || 12;
const MAX_KEYS = parseInt(process.env.MAX_JSON_KEYS, 10) || 500;

/** Recursively scan a parsed body for pollution keys + excessive depth/size. */
function inspect(value, depth = 0, counter = { keys: 0 }) {
    if (depth > MAX_DEPTH) return 'payload nesting too deep';
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) return `forbidden key: ${key}`;
            if (++counter.keys > MAX_KEYS) return 'too many fields in payload';
            const err = inspect(value[key], depth + 1, counter);
            if (err) return err;
        }
    }
    return null;
}

/** Middleware: reject polluted / oversized-structure bodies. */
function bodyGuard() {
    return (req, res, next) => {
        try {
            if (req.body && typeof req.body === 'object') {
                const err = inspect(req.body);
                if (err) return res.status(400).json({ error: 'rejected payload', reason: err });
            }
        } catch { /* fail-open on inspector error */ }
        next();
    };
}

/** Middleware: attach a request id (honors upstream X-Request-Id). */
function requestId() {
    return (req, res, next) => {
        const id = (req.headers['x-request-id'] || '').toString().slice(0, 64)
            || crypto.randomBytes(8).toString('hex');
        req.id = id;
        res.setHeader('X-Request-Id', id);
        next();
    };
}

// ── Field validators ─────────────────────────────────────────
const V = {
    isHex: (s, len = null) => typeof s === 'string' && /^[0-9a-fA-F]*$/.test(s) && (len == null || s.length === len),
    isHash: (s) => V.isHex(s, 64),
    isAmount: (s) => {
        try { return BigInt(s) >= 0n; } catch { return false; }
    },
    isAddress: (s) => typeof s === 'string' && /^SPN[0-9A-Za-z]{10,60}$/.test(s),
    isPubKeyHex: (s) => V.isHex(s) && s.length >= 66 && s.length <= 200,
    inRange: (n, min, max) => Number.isFinite(+n) && +n >= min && +n <= max,
    nonEmptyStr: (s, max = 256) => typeof s === 'string' && s.length > 0 && s.length <= max,
};

/**
 * Build a validator middleware from a simple schema:
 *   validate({ address: 'address', amount: 'amount', to: 'address' }, 'body')
 * Fields not in the schema are ignored; missing required fields fail.
 */
function validate(schema, source = 'body') {
    const checks = {
        address: V.isAddress, hash: V.isHash, amount: V.isAmount,
        pubkey: V.isPubKeyHex, hex: (s) => V.isHex(s), str: (s) => V.nonEmptyStr(s),
    };
    return (req, res, next) => {
        const data = req[source] || {};
        for (const [field, type] of Object.entries(schema)) {
            const optional = type.endsWith('?');
            const key = optional ? type.slice(0, -1) : type;
            const val = data[field];
            if (val == null) {
                if (optional) continue;
                return res.status(400).json({ error: `missing field: ${field}` });
            }
            const check = checks[key];
            if (check && !check(val))
                return res.status(400).json({ error: `invalid ${field} (expected ${key})` });
        }
        next();
    };
}

module.exports = { bodyGuard, requestId, validate, V, inspect };
