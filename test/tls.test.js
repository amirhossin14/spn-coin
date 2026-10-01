'use strict';
const { describe, test, afterEach, before } = require('node:test');
require('./_expect');

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const express = require('express');
const { loadCert, enforceHttps, createServers } = require('../middleware/tls');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const CERT = path.join(CERT_DIR, 'dev-cert.pem');
const KEY = path.join(CERT_DIR, 'dev-key.pem');

// The dev certificate is git-ignored (and never shipped in the zip), so tests
// must not assume it exists. Generate one here if openssl is available; if it
// isn't, we mark hasCert=false and the cert-dependent tests skip cleanly
// instead of failing on a machine that simply has no cert yet.
let hasCert = false;
before(() => {
    if (fs.existsSync(CERT) && fs.existsSync(KEY)) { hasCert = true; return; }
    try {
        fs.mkdirSync(CERT_DIR, { recursive: true });
        execSync(
            `openssl req -x509 -newkey rsa:2048 -sha256 -nodes ` +
            `-keyout "${KEY}" -out "${CERT}" -days 825 -subj "/CN=localhost"`,
            { stdio: 'ignore' },
        );
        hasCert = fs.existsSync(CERT) && fs.existsSync(KEY);
    } catch {
        hasCert = false; // openssl not available — dependent tests will skip
    }
});

describe('TLS cert loading', () => {
    afterEach(() => { delete process.env.TLS_CERT; delete process.env.TLS_KEY; delete process.env.TLS_SELF_SIGNED; });

    test('loads explicit cert/key from paths', (t) => {
        if (!hasCert) return t.skip('no dev certificate available (openssl missing)');
        process.env.TLS_CERT = CERT; process.env.TLS_KEY = KEY;
        const creds = loadCert(() => {});
        expect(creds).toBeTruthy();
        expect(creds.source).toBe('file');
        expect(creds.cert).toBeTruthy();
    });

    test('loads self-signed dev cert when enabled', (t) => {
        if (!hasCert) return t.skip('no dev certificate available (openssl missing)');
        process.env.TLS_SELF_SIGNED = '1';
        const creds = loadCert(() => {});
        expect(creds).toBeTruthy();
        expect(creds.source).toBe('self-signed');
    });

    test('returns null when no TLS configured', () => {
        expect(loadCert(() => {})).toBeNull();
    });

    test('returns null on bad cert path', () => {
        process.env.TLS_CERT = '/nonexistent/cert.pem'; process.env.TLS_KEY = '/nonexistent/key.pem';
        expect(loadCert(() => {})).toBeNull();
    });
});

describe('enforceHttps middleware', () => {
    afterEach(() => { delete process.env.HTTPS_REDIRECT; });

    test('adds HSTS header on a secure (proxied) request', () => {
        const mw = enforceHttps({ httpsPort: 443, trustProxy: true });
        const headers = {};
        const req = { headers: { 'x-forwarded-proto': 'https' }, secure: false };
        const res = { setHeader: (k, v) => { headers[k] = v; } };
        let nexted = false;
        mw(req, res, () => { nexted = true; });
        expect(nexted).toBe(true);
        expect(headers['Strict-Transport-Security']).toMatch(/max-age=/);
    });

    test('redirects http→https when HTTPS_REDIRECT=1', () => {
        process.env.HTTPS_REDIRECT = '1';
        const mw = enforceHttps({ httpsPort: 8443, trustProxy: true });
        const req = { headers: { host: 'example.com:8080', 'x-forwarded-proto': 'http' }, secure: false, url: '/api/x' };
        let redirectedTo = null, code = null;
        const res = { setHeader() {}, redirect: (c, url) => { code = c; redirectedTo = url; } };
        mw(req, res, () => {});
        expect(code).toBe(301);
        expect(redirectedTo).toBe('https://example.com:8443/api/x');
    });

    test('passes through plain http when redirect disabled', () => {
        const mw = enforceHttps({ httpsPort: 8443, trustProxy: true });
        const req = { headers: { host: 'example.com' }, secure: false, url: '/' };
        let nexted = false;
        mw(req, res_stub(() => { nexted = true; }), () => { nexted = true; });
        expect(nexted).toBe(true);
    });
});

function res_stub() { return { setHeader() {}, redirect() {} }; }

describe('createServers', () => {
    afterEach(() => { delete process.env.TLS_SELF_SIGNED; delete process.env.HTTPS_REDIRECT; });

    test('creates an https server that serves a real request', (t) => {
        if (!hasCert) return t.skip('no dev certificate available (openssl missing)');
        process.env.TLS_SELF_SIGNED = '1';
        const app = express();
        app.get('/ping', (req, res) => res.json({ pong: true, secure: true }));
        const { server, protocol } = createServers(app, { httpPort: 0, httpsPort: 0, log: () => {} });
        expect(protocol).toBe('https');
        return new Promise((resolve, reject) => {
            server.listen(0, () => {
                const port = server.address().port;
                https.get({ host: '127.0.0.1', port, path: '/ping', rejectUnauthorized: false }, (res) => {
                    let d = ''; res.on('data', c => d += c); res.on('end', () => {
                        try {
                            expect(res.statusCode).toBe(200);
                            expect(JSON.parse(d).pong).toBe(true);
                            server.close(); resolve();
                        } catch (e) { server.close(); reject(e); }
                    });
                }).on('error', (e) => { server.close(); reject(e); });
            });
        });
    });

    test('falls back to http when no cert configured', () => {
        const app = express();
        const { protocol } = createServers(app, { httpPort: 3000, httpsPort: 3000, log: () => {} });
        expect(protocol).toBe('http');
    });
});
