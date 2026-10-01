/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  tls.js — HTTPS / TLS support for the node's HTTP surface.
 *
 *  Supports every common deployment shape:
 *
 *   1. Direct HTTPS in Node  — set TLS_CERT + TLS_KEY (PEM paths) and
 *      the node serves https:// itself.
 *   2. HTTP→HTTPS redirect   — a tiny companion http server on
 *      HTTP_PORT 301-redirects everything to the https URL.
 *   3. Behind a reverse proxy — set TRUST_PROXY=1; the node stays
 *      HTTP but honors X-Forwarded-Proto and still emits HSTS so the
 *      proxy/browser enforce TLS end-to-end.
 *   4. Dev self-signed       — if TLS_SELF_SIGNED=1 and no cert paths
 *      are given, load ./certs/dev-{cert,key}.pem (generate them with
 *      scripts/gen-cert.sh).
 *
 *  Everything is opt-in and fail-safe: if HTTPS can't be set up, the
 *  node logs why and falls back to HTTP so it never fails to boot.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CERT_DIR = path.join(__dirname, '..', 'certs');

/** Resolve the certificate + key, from explicit paths or dev self-signed. */
function loadCert(log = console.log) {
    const certPath = process.env.TLS_CERT;
    const keyPath = process.env.TLS_KEY;

    // 1. explicit real certificate
    if (certPath && keyPath) {
        try {
            const cert = fs.readFileSync(certPath);
            const key = fs.readFileSync(keyPath);
            const ca = process.env.TLS_CA ? fs.readFileSync(process.env.TLS_CA) : undefined;
            log('🔐 [TLS] loaded certificate from TLS_CERT/TLS_KEY');
            return { cert, key, ca, source: 'file' };
        } catch (e) {
            log('⚠️  [TLS] could not read TLS_CERT/TLS_KEY:', e.message);
            return null;
        }
    }

    // 2. dev self-signed fallback
    if (process.env.TLS_SELF_SIGNED === '1') {
        const devCert = path.join(CERT_DIR, 'dev-cert.pem');
        const devKey = path.join(CERT_DIR, 'dev-key.pem');
        try {
            const cert = fs.readFileSync(devCert);
            const key = fs.readFileSync(devKey);
            log('🔐 [TLS] using DEV self-signed certificate (not for production)');
            return { cert, key, source: 'self-signed' };
        } catch {
            log('⚠️  [TLS] TLS_SELF_SIGNED=1 but ./certs/dev-cert.pem missing.');
            log('    Generate a dev certificate with either:');
            log('      • bash scripts/gen-cert.sh          (Linux/macOS/Git-Bash)');
            log('      • openssl req -x509 -newkey rsa:2048 -nodes \\');
            log('          -keyout certs/dev-key.pem -out certs/dev-cert.pem \\');
            log('          -days 825 -subj "/CN=localhost"   (any OS with openssl)');
            return null;
        }
    }

    return null; // no TLS configured
}

/**
 * Middleware: enforce HTTPS.
 *  - Adds HSTS on secure requests (or when behind a trusted proxy).
 *  - Redirects http→https when we know the canonical https host.
 */
function enforceHttps({ httpsPort, trustProxy = false, hstsMaxAge = 31536000 } = {}) {
    return (req, res, next) => {
        const xfProto = req.headers['x-forwarded-proto'];
        const isSecure = req.secure || (trustProxy && xfProto === 'https');

        if (isSecure) {
            // HSTS: force the browser to use HTTPS for a year (+ subdomains)
            res.setHeader('Strict-Transport-Security',
                `max-age=${hstsMaxAge}; includeSubDomains; preload`);
            return next();
        }

        // Not secure. If HTTPS termination is expected, redirect there.
        if (process.env.HTTPS_REDIRECT === '1') {
            const host = (req.headers.host || '').split(':')[0];
            const portSuffix = httpsPort && Number(httpsPort) !== 443 ? `:${httpsPort}` : '';
            return res.redirect(301, `https://${host}${portSuffix}${req.url}`);
        }

        return next();
    };
}

/**
 * Build the main server (https if a cert is available, else http) plus an
 * optional companion http server that redirects to https.
 *
 * @returns {{ server, protocol, redirector }}
 */
function createServers(app, { httpPort, httpsPort, log = console.log } = {}) {
    const creds = loadCert(log);

    if (creds) {
        const server = https.createServer({ cert: creds.cert, key: creds.key, ca: creds.ca }, app);
        let redirector = null;

        // companion HTTP server that 301s to HTTPS (only if a separate http port is set)
        if (httpPort && Number(httpPort) !== Number(httpsPort) && process.env.HTTPS_REDIRECT === '1') {
            redirector = http.createServer((req, res) => {
                const host = (req.headers.host || '').split(':')[0];
                const portSuffix = Number(httpsPort) !== 443 ? `:${httpsPort}` : '';
                res.writeHead(301, { Location: `https://${host}${portSuffix}${req.url}` });
                res.end();
            });
        }
        return { server, protocol: 'https', redirector, certSource: creds.source };
    }

    // no cert → plain HTTP (typical when behind a TLS-terminating proxy)
    return { server: http.createServer(app), protocol: 'http', redirector: null };
}

module.exports = { loadCert, enforceHttps, createServers, CERT_DIR };
