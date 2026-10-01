/*
 * © 2026 SPN Coin Project
 * elliptic-isolation.test.js — guards the security boundary around elliptic.
 *
 * elliptic has a low-severity advisory (GHSA-848j-6mx2-7j84) with no upstream
 * fix. Our exposure is minimal *because* the security-critical path — verifying
 * externally-supplied signatures — uses Node's native `crypto`, not elliptic.
 *
 * These tests fail loudly if that boundary ever regresses.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('../blockchain/crypto');

const hash = (s) => crypto.sha256(s); // hex digest

test('sign/verify round-trips correctly (native crypto path)', () => {
  const kp = crypto.generateKeyPair();
  const h = hash('the quick brown fox');
  const sig = crypto.sign(kp.privateKey, h);
  assert.strictEqual(crypto.verify(kp.publicKey, h, sig), true, 'valid signature must verify');
  assert.strictEqual(crypto.verify(kp.publicKey, hash('tampered'), sig), false, 'wrong hash must fail');
});

test('verify() does not depend on elliptic (uses native crypto)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'blockchain', 'crypto.js'), 'utf8');
  const idx = src.indexOf('function verify');
  assert.ok(idx > -1, 'verify() must exist');
  const body = src.slice(idx, idx + 800);
  assert.ok(/crypto\.verify/.test(body), 'verify() must use native crypto.verify');
  assert.ok(!/elliptic/.test(body), 'verify() must NOT use elliptic (attack surface)');
});

test('keyPairFromRawPrivate output verifies via native path', () => {
  const raw = '2222222222222222222222222222222222222222222222222222222222222222';
  const kp = crypto.keyPairFromRawPrivate(raw);
  const h = hash('hd-derived key works');
  const sig = crypto.sign(kp.privateKey, h);
  assert.strictEqual(crypto.verify(kp.publicKey, h, sig), true);
  assert.ok(kp.address.startsWith('SPN'), 'address should be well-formed');
});
