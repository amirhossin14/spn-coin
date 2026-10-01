'use strict';
const { describe, test } = require('node:test');
require('./_expect');

const { bodyGuard, requestId, validate, V, inspect } = require('../middleware/hardening');

function mkRes() {
    return { statusCode: 200, headers: {}, body: null,
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; return this; },
        setHeader(k, v) { this.headers[k] = v; } };
}
function runMw(mw, req) {
    const res = mkRes(); let nexted = false;
    mw(req, res, () => { nexted = true; });
    return { res, nexted };
}

describe('prototype-pollution guard', () => {
    test('rejects __proto__ in body', () => {
        const { res, nexted } = runMw(bodyGuard(), { body: JSON.parse('{"__proto__":{"x":1}}') });
        expect(nexted).toBe(false);
        expect(res.statusCode).toBe(400);
    });
    test('rejects nested constructor key', () => {
        const { res, nexted } = runMw(bodyGuard(), { body: { a: { b: { constructor: 1 } } } });
        expect(nexted).toBe(false);
        expect(res.statusCode).toBe(400);
    });
    test('allows a clean body', () => {
        const { nexted } = runMw(bodyGuard(), { body: { address: 'SPNx', amount: '10' } });
        expect(nexted).toBe(true);
    });
    test('rejects too-deep nesting', () => {
        let deep = {}; let cur = deep;
        for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n; }
        expect(inspect(deep)).toMatch(/deep/);
    });
});

describe('request id', () => {
    test('generates an id and sets header', () => {
        const req = { headers: {} };
        const { res, nexted } = runMw(requestId(), req);
        expect(nexted).toBe(true);
        expect(req.id).toBeTruthy();
        expect(res.headers['X-Request-Id']).toBe(req.id);
    });
    test('honors upstream X-Request-Id', () => {
        const req = { headers: { 'x-request-id': 'abc123' } };
        runMw(requestId(), req);
        expect(req.id).toBe('abc123');
    });
});

describe('field validators', () => {
    test('address validator', () => {
        expect(V.isAddress('SPN1BAbcdefghij')).toBe(true);
        expect(V.isAddress('bad')).toBe(false);
        expect(V.isAddress('0xdeadbeef')).toBe(false);
    });
    test('amount validator (bigint-safe, non-negative)', () => {
        expect(V.isAmount('1000')).toBe(true);
        expect(V.isAmount('0')).toBe(true);
        expect(V.isAmount('-5')).toBe(false);
        expect(V.isAmount('abc')).toBe(false);
    });
    test('hash validator (64 hex)', () => {
        expect(V.isHash('a'.repeat(64))).toBe(true);
        expect(V.isHash('a'.repeat(63))).toBe(false);
        expect(V.isHash('xyz')).toBe(false);
    });
    test('pubkey hex validator', () => {
        expect(V.isPubKeyHex('3056301006' + 'a'.repeat(120))).toBe(true);
        expect(V.isPubKeyHex('short')).toBe(false);
    });
});

describe('validate() middleware', () => {
    test('passes a valid body', () => {
        const mw = validate({ address: 'address', amount: 'amount' });
        const { nexted } = runMw(mw, { body: { address: 'SPN1BAbcdefghij', amount: '100' } });
        expect(nexted).toBe(true);
    });
    test('fails a missing required field', () => {
        const mw = validate({ address: 'address' });
        const { res } = runMw(mw, { body: {} });
        expect(res.statusCode).toBe(400);
    });
    test('fails an invalid field', () => {
        const mw = validate({ amount: 'amount' });
        const { res } = runMw(mw, { body: { amount: 'not-a-number' } });
        expect(res.statusCode).toBe(400);
    });
    test('optional field may be omitted', () => {
        const mw = validate({ amount: 'amount', note: 'str?' });
        const { nexted } = runMw(mw, { body: { amount: '5' } });
        expect(nexted).toBe(true);
    });
});
