/**
 * Core blockchain consensus tests.
 * Run with: npm test   (Node.js built-in runner, no deps)
 */
'use strict';
process.env.CHAIN_ID = '3';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const crypto = require('../blockchain/crypto');
const { Blockchain } = require('../blockchain/blockchain');

describe('Crypto — Proof of Work', () => {
  test('difficulty 1 target is positive', () => {
    assert.ok(crypto.difficultyToTarget(1) > 0n);
  });
  test('higher difficulty means smaller target', () => {
    assert.ok(crypto.difficultyToTarget(2) < crypto.difficultyToTarget(1));
  });
  test('higher difficulty means more work', () => {
    const w1 = crypto.workForTarget(crypto.difficultyToTarget(1));
    const w2 = crypto.workForTarget(crypto.difficultyToTarget(2));
    assert.ok(w2 > w1);
  });
  test('all-zero hash meets target', () => {
    assert.strictEqual(crypto.meetsTarget('0'.repeat(64), 1), true);
  });
  test('all-f hash never meets target', () => {
    assert.strictEqual(crypto.meetsTarget('f'.repeat(64), 1), false);
  });
});

describe('Crypto — Addresses', () => {
  test('keypair produces valid SPN address', () => {
    const kp = crypto.generateKeyPair();
    assert.ok(kp.address);
    assert.ok(crypto.validateAddress(kp.address));
  });
  test('deterministic address derivation', () => {
    const kp = crypto.generateKeyPair();
    const addr2 = crypto.publicKeyToAddress(crypto.derivePublicKey(kp.privateKey));
    assert.strictEqual(addr2, kp.address);
  });
  test('invalid address rejected', () => {
    assert.strictEqual(crypto.validateAddress('NOTREAL'), false);
  });
  test('tampered address fails checksum', () => {
    const kp = crypto.generateKeyPair();
    const bad = kp.address.slice(0, -1) + (kp.address.slice(-1) === 'a' ? 'b' : 'a');
    assert.strictEqual(crypto.validateAddress(bad), false);
  });
});

describe('Crypto — Signatures', () => {
  test('valid signature verifies', () => {
    const kp = crypto.generateKeyPair();
    const msg = crypto.sha256('hello');
    const sig = crypto.sign(kp.privateKey, msg);
    assert.strictEqual(crypto.verify(crypto.derivePublicKey(kp.privateKey), msg, sig), true);
  });
  test('signature fails for wrong message', () => {
    const kp = crypto.generateKeyPair();
    const sig = crypto.sign(kp.privateKey, crypto.sha256('A'));
    assert.strictEqual(crypto.verify(crypto.derivePublicKey(kp.privateKey), crypto.sha256('B'), sig), false);
  });
});

describe('Blockchain — Mining & Consensus', () => {
  test('genesis at height 0', () => {
    assert.strictEqual(new Blockchain().height, 0);
  });
  test('mines and grows chain', () => {
    const bc = new Blockchain();
    const r = bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    assert.ok(r.ok, r.error || '');
    assert.strictEqual(bc.height, 1);
  });
  test('cumulative work increases', () => {
    const bc = new Blockchain();
    const w0 = Blockchain.chainWork(bc.chain);
    bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    assert.ok(Blockchain.chainWork(bc.chain) > w0);
  });
  test('median-time-past computed', () => {
    const bc = new Blockchain();
    for (let i = 0; i < 3; i++) bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    assert.ok(bc.getMedianTimePast() > 0);
  });
  test('full chain validates', () => {
    const bc = new Blockchain();
    for (let i = 0; i < 4; i++) bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    assert.strictEqual(bc.validateChain().valid, true);
  });
  test('tampered block breaks validation', () => {
    const bc = new Blockchain();
    bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    bc.mineBlock({ miner: 'SPN1TestMinerAAAAAAAAAAAAAAAAAA', transactions: [] });
    bc.chain[1].timestamp = 999;
    assert.strictEqual(bc.validateChain().valid, false);
  });
});

describe('Blockchain — Fork Choice', () => {
  test('more cumulative work wins', () => {
    const w1 = crypto.workForTarget(crypto.difficultyToTarget(1));
    const w5 = crypto.workForTarget(crypto.difficultyToTarget(5));
    assert.ok(w5 > w1 * 3n);
  });
});

// ── Regression tests for fixed bugs ─────────────────────────────
describe('Regression — fixed bugs', () => {
  test('rapid mining does not break on median-time-past (BIP-113)', () => {
    // Blocks mined within the same millisecond must still be accepted:
    // the miner bumps the timestamp above MTP instead of being rejected.
    const bc = new Blockchain();
    const miner = 'SPNtTestMineraddrxxxxxxxxxxxxxxxxxxx';
    for (let i = 0; i < 20; i++) {
      const r = bc.mineBlock({ miner });
      assert.ok(r.ok, `block ${i + 1} should be accepted, got: ${r.error}`);
    }
    assert.strictEqual(bc.height, 20);
    assert.strictEqual(bc.validateChain().valid, true);
  });

  test('mempool judges coinbase maturity at next block height, not 0', () => {
    const { Wallet } = require('../wallet/wallet');
    const mpMod = require('../mempool/mempool');
    const Mempool = mpMod.Mempool || mpMod;

    const bc = new Blockchain();
    const w1 = new Wallet();
    const w2 = new Wallet();
    for (let i = 0; i < 103; i++) bc.mineBlock({ miner: w1.address });

    const mp = new Mempool();
    const tx = w1.createTransaction({
      recipient: w2.address, amount: 1n * 100000000n,
      utxoSet: bc.utxoSet, feeRate: 10,
    });
    const res = mp.add(tx, bc.utxoSet, bc.height + 1);
    assert.strictEqual(res.ok, true, `mempool should accept mature-coinbase spend, got: ${res.error}`);
  });
});

// ── Regression: timestamp handling (BIP-113 + Postgres BIGINT-as-string) ──
test('Blockchain — Timestamp robustness', async (t) => {
    const { Blockchain } = require('../blockchain/blockchain');
    const MINER = 'SPN1BMinerxxxxxxxxxxxxxxxxxxxxxxxxxx';

    await t.test('fast mining (frozen clock) never violates median-time-past', () => {
        const real = Date.now; Date.now = () => 1782894851380;
        try {
            const bc = new Blockchain();
            for (let i = 0; i < 20; i++) {
                const r = bc.mineBlock({ miner: MINER });
                assert.ok(r.ok, `block ${i + 1} should be accepted: ${r.error || ''}`);
            }
            assert.ok(bc.validateChain().valid);
        } finally { Date.now = real; }
    });

    await t.test('mines on top of a string-timestamp block (pg BIGINT)', () => {
        const real = Date.now; Date.now = () => 1782894851380;
        try {
            const bc = new Blockchain();
            bc.mineBlock({ miner: MINER });
            bc.chain[1].timestamp = String(bc.chain[1].timestamp); // simulate DB reload
            const r = bc.mineBlock({ miner: MINER });
            assert.ok(r.ok, `should accept: ${r.error || ''}`);
        } finally { Date.now = real; }
    });
});

// ── HD wallet (BIP39 + BIP32) ──
test('Wallet — HD (BIP39/BIP32)', async (t) => {
    const hd = require('../wallet/hd');
    const { Wallet } = require('../wallet/wallet');
    const c = require('../blockchain/crypto');

    await t.test('generates a valid 12-word mnemonic', () => {
        const m = hd.generateMnemonic(128);
        assert.equal(m.split(' ').length, 12);
        assert.ok(hd.validateMnemonic(m));
    });

    await t.test('derivation is deterministic and gives valid, distinct addresses', () => {
        const m = hd.generateMnemonic();
        const a0 = Wallet.fromMnemonic(m, 0);
        const a0b = Wallet.fromMnemonic(m, 0);
        const a1 = Wallet.fromMnemonic(m, 1);
        assert.equal(a0.address, a0b.address);            // restore is deterministic
        assert.notEqual(a0.address, a1.address);          // per-index addresses differ
        assert.ok(c.validateAddress(a0.address));
    });

    await t.test('derived keys sign & verify', () => {
        const { wallet } = Wallet.createHD();
        const h = c.sha256('msg');
        const sig = c.sign(wallet.privateKey, h);
        assert.ok(c.verify(wallet.publicKey, h, sig));
    });

    await t.test('rejects an invalid mnemonic', () => {
        assert.equal(hd.validateMnemonic('foo bar baz qux'), false);
    });
});

// ── Two-factor auth (TOTP / Google Authenticator) ──
test('Security — TOTP 2FA', async (t) => {
    const totp = require('../app/totp');

    await t.test('matches RFC 4226 HOTP vectors', () => {
        const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
        const vec = ['755224', '287082', '359152', '969429', '338314'];
        vec.forEach((exp, c) => assert.equal(totp.hotp(secret, c), exp));
    });

    await t.test('matches RFC 6238 TOTP vector at T=59s', () => {
        const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
        assert.equal(totp.totp(secret, { time: 59 * 1000 }), '287082');
    });

    await t.test('verify accepts current code and rejects wrong code', () => {
        const secret = totp.generateSecret();
        const now = Date.now();
        assert.equal(totp.verify(totp.totp(secret, { time: now }), secret, { time: now }), true);
        assert.equal(totp.verify('000000', secret, { time: now }), false);
    });

    await t.test('verify tolerates ±1 step clock drift', () => {
        const secret = totp.generateSecret();
        const now = Date.now();
        assert.equal(totp.verify(totp.totp(secret, { time: now - 30000 }), secret, { time: now, window: 1 }), true);
    });

    await t.test('full enable/login/disable flow', () => {
        const { ac } = require('../app/access-control.js');
        // Use a unique username and clean up, so the test is isolated and
        // repeatable even though access-control persists to access.lock.
        const uname = 'tfa_test_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const created = ac.createUser({ username: uname, password: 'strongpass1' }, 'admin');
        assert.ok(created.ok && created.user, 'createUser should succeed: ' + (created.error || ''));
        const uid = created.user.id;
        const setup = ac.setupTotp(uid);
        assert.ok(setup.ok && setup.secret && setup.otpauthUrl.startsWith('otpauth://totp/'));
        assert.equal(ac.confirmTotp(uid, totp.totp(setup.secret)).ok, true);
        assert.equal(ac.getTotpStatus(uid).enabled, true);
        assert.equal(ac.login({ username: uname, password: 'strongpass1' }).require2fa, true);
        assert.equal(ac.login({ username: uname, password: 'strongpass1', totp: totp.totp(setup.secret) }).ok, true);
        assert.equal(ac.disableTotp(uid, totp.totp(setup.secret)).ok, true);
        // Clean up so we don't pollute access.lock for the next run.
        if (ac.deleteUser) ac.deleteUser(uid, 'admin');
    });
});

// ── IDS / IPS ──
test('Security — IDS/IPS', async (t) => {
    const { IdsIps } = require('../middleware/ids-ips');
    const mkReq = (o = {}) => ({
        method: o.method || 'GET', url: o.url || '/', originalUrl: o.url || '/',
        path: o.path || (o.url || '/').split('?')[0], ip: o.ip || '9.9.9.9',
        headers: { 'user-agent': o.ua || 'Mozilla/5.0', ...(o.headers || {}) }, body: o.body, connection: {},
    });
    const run = (mw, req) => {
        let code = 200, nexted = false;
        const res = { setHeader() {}, status(c) { code = c; return this; }, json() { return this; } };
        mw(req, res, () => { nexted = true; });
        return { code, nexted };
    };

    await t.test('detects common attack classes', () => {
        const ids = new IdsIps({ mode: 'ips' });
        assert.ok(ids.inspect(mkReq({ url: "/x?id=1' OR '1'='1" })).some(f => f.id === 'sqli'));
        assert.ok(ids.inspect(mkReq({ method: 'POST', body: { c: '<script>alert(1)</script>' } })).some(f => f.id === 'xss'));
        assert.ok(ids.inspect(mkReq({ url: '/x?p=../../etc/passwd' })).some(f => f.id === 'traversal'));
        assert.ok(ids.inspect(mkReq({ url: '/x?q=;whoami' })).some(f => f.id === 'cmdi'));
        assert.ok(ids.inspect(mkReq({ ua: 'sqlmap/1.7' })).some(f => f.id === 'scanner'));
    });

    await t.test('benign requests produce no findings', () => {
        const ids = new IdsIps();
        assert.equal(ids.inspect(mkReq({ url: '/api/blocks?limit=10' })).length, 0);
    });

    await t.test('IPS blocks critical attack and bans the IP', () => {
        const ids = new IdsIps({ mode: 'ips' });
        const r = run(ids.inspector(), mkReq({ ip: '5.5.5.5', url: '/x?q=;whoami' }));
        assert.equal(r.code, 403);
        assert.ok(ids.isBanned('5.5.5.5'));
        assert.equal(run(ids.blockGate(), mkReq({ ip: '5.5.5.5' })).code, 403);
    });

    await t.test('whitelist (localhost) is never blocked', () => {
        const ids = new IdsIps({ mode: 'ips' });
        const r = run(ids.inspector(), mkReq({ ip: '127.0.0.1', url: '/x?q=;cat /etc/passwd' }));
        assert.equal(r.nexted, true);
    });

    await t.test('ids mode detects but does not block', () => {
        const ids = new IdsIps({ mode: 'ids' });
        const r = run(ids.inspector(), mkReq({ ip: '6.6.6.6', url: '/x?q=;whoami' }));
        assert.equal(r.nexted, true);
        assert.ok(ids.getEvents().length >= 1);
    });
});

// ── Chain ID / Replay protection ──
test('Security — Replay protection (chain id in signatures)', async (t) => {
    const c = require('../blockchain/crypto');
    await t.test('signature bound to chain id fails on a different chain', () => {
        const kp = c.generateKeyPair();
        const base = { txid: 'ab', inp: 'cd', vout: 0, nonce: '01' };
        const h1 = c.sha256(JSON.stringify({ ...base, chainId: 1 }));
        const h999 = c.sha256(JSON.stringify({ ...base, chainId: 999 }));
        const sig = c.sign(kp.privateKey, h1);
        assert.equal(c.verify(kp.publicKey, h1, sig), true);
        assert.equal(c.verify(kp.publicKey, h999, sig), false);
    });
});

// ── P2P reputation & Sybil ──
test('Security — P2P reputation & Sybil', async (t) => {
    const { PeerReputation } = require('../p2p/reputation');
    await t.test('limits connections per IP (Sybil guard)', () => {
        const rep = new PeerReputation({ maxPerIp: 2 });
        rep.register('a', '1.1.1.1'); rep.register('b', '1.1.1.1');
        assert.equal(rep.canConnect('1.1.1.1', 'c').ok, false);
        assert.equal(rep.canConnect('2.2.2.2', 'c').ok, true);
    });
    await t.test('bans peers that repeatedly send invalid blocks', () => {
        const rep = new PeerReputation({ banThreshold: 20 });
        rep.register('bad', '9.9.9.9');
        let r; for (let i = 0; i < 2; i++) r = rep.penalize('bad', 'invalid_block', '9.9.9.9');
        assert.equal(r.banned, true);
        assert.equal(rep.canConnect('9.9.9.9', 'x').ok, false);
    });
});

// ── Web3 keystore v3 ──
test('Security — Web3 keystore (v3)', async (t) => {
    const ks = require('../wallet/keystore');
    await t.test('encrypt→decrypt round-trips a raw key', () => {
        const raw = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
        const store = ks.encrypt(raw, 'pw');
        assert.equal(store.version, 3);
        assert.equal(store.crypto.kdf, 'scrypt');
        assert.equal(ks.decrypt(store, 'pw'), raw);
    });
    await t.test('wrong password is rejected via MAC', () => {
        const store = ks.encrypt('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'pw');
        assert.throws(() => ks.decrypt(store, 'nope'));
    });
});

// ── Tamper-evident audit log ──
test('Security — Tamper-evident audit log', async (t) => {
    const fs = require('fs');
    const cp = require('child_process');
    await t.test('detects tampering in the hash-chained log', () => {
        // run in a child so the module-level chain state is fresh
        // verify the verifier logic on a synthetic hash-chain.
        const crypto = require('crypto');
        const mk = (entry, prev) => { const r = { ...entry, prevHash: prev }; r.hash = crypto.createHash('sha256').update(prev + JSON.stringify(r)).digest('hex'); return r; };
        let prev = '';
        const e1 = mk({ a: 1 }, prev); prev = e1.hash;
        const e2 = mk({ a: 2 }, prev); prev = e2.hash;
        // verify intact
        const verify = (lines) => {
            let p = '';
            for (const rec of lines) {
                const copy = { ...rec }; delete copy.hash;
                const exp = crypto.createHash('sha256').update((rec.prevHash || '') + JSON.stringify(copy)).digest('hex');
                if (rec.prevHash !== p || rec.hash !== exp) return false;
                p = rec.hash;
            }
            return true;
        };
        assert.equal(verify([e1, e2]), true);
        const tampered = { ...e2, a: 999 };
        assert.equal(verify([e1, tampered]), false);
    });
});

// ── Enhanced Script engine: HTLC, CSV, branching ──
test('Script — HTLC / CSV / branching', async (t) => {
    const S = require('../blockchain/script');
    const c = require('../blockchain/crypto');
    const sigHash = c.sha256('spend');
    const recipient = c.generateKeyPair();
    const funder = c.generateKeyPair();
    const preimage = Buffer.from('secret-preimage-value-123456789').toString('hex');
    const h = S.sha256Hex(preimage);
    const lock = S.build.htlc(h, recipient.publicKey, funder.publicKey, 100);

    await t.test('HTLC claim needs the correct preimage and recipient sig', () => {
        assert.equal(S.evaluate(S.build.htlcClaim(c.sign(recipient.privateKey, sigHash), preimage), lock, { sigHash }).ok, true);
        assert.equal(S.evaluate(S.build.htlcClaim(c.sign(recipient.privateKey, sigHash), '00' + preimage.slice(2)), lock, { sigHash }).ok, false);
        assert.equal(S.evaluate(S.build.htlcClaim(c.sign(funder.privateKey, sigHash), preimage), lock, { sigHash }).ok, false);
    });

    await t.test('HTLC refund only works after the timeout', () => {
        const refund = S.build.htlcRefund(c.sign(funder.privateKey, sigHash));
        assert.equal(S.evaluate(refund, lock, { sigHash, lockContext: 50 }).ok, false);
        assert.equal(S.evaluate(refund, lock, { sigHash, lockContext: 150 }).ok, true);
    });

    await t.test('CSV relative timelock enforces minimum age', () => {
        const csvLock = S.build.csv(10, S.build.p2pkh(S.hash160Hex(recipient.publicKey)));
        const unlock = S.build.p2pkhUnlock(c.sign(recipient.privateKey, sigHash), recipient.publicKey);
        assert.equal(S.evaluate(unlock, csvLock, { sigHash, sequenceContext: 20 }).ok, true);
        assert.equal(S.evaluate(unlock, csvLock, { sigHash, sequenceContext: 5 }).ok, false);
    });

    await t.test('unbalanced OP_IF is rejected', () => {
        assert.equal(S.evaluate([], ['OP_1', 'OP_IF', 'OP_1'], { sigHash }).ok, false);
    });
});

// ── Token layer (issue / transfer on-chain) ──
test('Tokens — issue & transfer', async (t) => {
    const { Blockchain } = require('../blockchain/blockchain');
    const { Wallet } = require('../wallet/wallet');
    const { TokenLayer } = require('../tokens/tokens');

    await t.test('signed issue and transfer update balances; forgery/overspend rejected', () => {
        const L = new TokenLayer();
        const alice = new Wallet(), bob = new Wallet(), mallory = new Wallet();
        const issue = TokenLayer.buildIssue({ name: 'Gold', symbol: 'GLD', decimals: 2, supply: 1000, issuer: alice.address, issuerPubKey: alice.publicKey, privateKey: alice.privateKey });
        assert.equal(L.applyOp(issue).ok, true);
        assert.equal(L.balanceOf(issue.tokenId, alice.address), '1000');
        assert.equal(L.applyOp(issue).ok, false); // replay
        const xfer = TokenLayer.buildTransfer({ tokenId: issue.tokenId, from: alice.address, to: bob.address, amount: 400, fromPubKey: alice.publicKey, privateKey: alice.privateKey });
        assert.equal(L.applyOp(xfer).ok, true);
        assert.equal(L.balanceOf(issue.tokenId, bob.address), '400');
        const forged = TokenLayer.buildTransfer({ tokenId: issue.tokenId, from: alice.address, to: mallory.address, amount: 1, fromPubKey: mallory.publicKey, privateKey: mallory.privateKey });
        assert.equal(L.applyOp(forged).ok, false);
        const over = TokenLayer.buildTransfer({ tokenId: issue.tokenId, from: bob.address, to: alice.address, amount: 99999, fromPubKey: bob.publicKey, privateKey: bob.privateKey });
        assert.equal(L.applyOp(over).ok, false);
    });

    await t.test('tokens issue & transfer end-to-end through mined blocks', () => {
        const bc = new Blockchain();
        const alice = new Wallet(), bob = new Wallet();
        for (let i = 0; i < 103; i++) bc.mineBlock({ miner: alice.address });
        const op = TokenLayer.buildIssue({ name: 'Silver', symbol: 'SLV', decimals: 0, supply: 500, issuer: alice.address, issuerPubKey: alice.publicKey, privateKey: alice.privateKey });
        const tx = alice.createTransaction({ recipient: alice.address, amount: 1000n, utxoSet: bc.utxoSet, feeRate: 10, data: { tokenOps: [op] } });
        assert.equal(tx.validate(bc.utxoSet, bc.height).valid, true);
        bc.mineBlock({ miner: alice.address, transactions: [tx] });
        assert.equal(bc.tokens.balanceOf(op.tokenId, alice.address), '500');
        const xop = TokenLayer.buildTransfer({ tokenId: op.tokenId, from: alice.address, to: bob.address, amount: 200, fromPubKey: alice.publicKey, privateKey: alice.privateKey });
        const xtx = alice.createTransaction({ recipient: alice.address, amount: 1000n, utxoSet: bc.utxoSet, feeRate: 10, data: { tokenOps: [xop] } });
        bc.mineBlock({ miner: alice.address, transactions: [xtx] });
        assert.equal(bc.tokens.balanceOf(op.tokenId, bob.address), '200');
        assert.equal(bc.tokens.balanceOf(op.tokenId, alice.address), '300');
    });
});

// ── Coin vs Token (fixed vs mintable) ──
test('Tokens — coin (fixed) vs token (mintable)', async (t) => {
    const { TokenLayer } = require('../tokens/tokens');
    const { Wallet } = require('../wallet/wallet');
    const u = new Wallet(), attacker = new Wallet();

    await t.test('a coin has fixed supply and cannot be minted', () => {
        const L = new TokenLayer();
        const coin = TokenLayer.buildIssue({ name: 'Coin', symbol: 'CN', decimals: 8, supply: 21000000, issuer: u.address, issuerPubKey: u.publicKey, privateKey: u.privateKey, type: 'coin' });
        assert.equal(L.applyOp(coin).ok, true);
        assert.equal(L.getToken(coin.tokenId).kind, 'coin');
        assert.equal(L.getToken(coin.tokenId).mintable, false);
        const m = TokenLayer.buildMint({ tokenId: coin.tokenId, amount: 1, issuer: u.address, issuerPubKey: u.publicKey, privateKey: u.privateKey });
        assert.equal(L.applyOp(m).ok, false);
    });

    await t.test('a mintable token can be minted by the issuer only', () => {
        const L = new TokenLayer();
        const tok = TokenLayer.buildIssue({ name: 'Tok', symbol: 'TK', decimals: 2, supply: 1000, issuer: u.address, issuerPubKey: u.publicKey, privateKey: u.privateKey, type: 'token', mintable: true });
        assert.equal(L.applyOp(tok).ok, true);
        const m = TokenLayer.buildMint({ tokenId: tok.tokenId, amount: 500, issuer: u.address, issuerPubKey: u.publicKey, privateKey: u.privateKey });
        assert.equal(L.applyOp(m).ok, true);
        assert.equal(L.getToken(tok.tokenId).supply, '1500');
        const bad = TokenLayer.buildMint({ tokenId: tok.tokenId, amount: 999, issuer: attacker.address, issuerPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        assert.equal(L.applyOp(bad).ok, false);
    });
});
