'use strict';
const { describe, test } = require('node:test');
require('./_expect');

const { TokenLayer } = require('../tokens/tokens');
const { extendTokenLayer } = require('../tokens/token-extensions');
const { AirdropOps, installAirdrops, buildMerkle, merkleProof, verifyProof } = require('../tokens/airdrop');
const { generateKeyPair, publicKeyToAddress } = require('../blockchain/crypto');

function acct() { const k = generateKeyPair(); return { ...k, address: publicKeyToAddress(k.publicKey) }; }
function setup() {
    const tokens = installAirdrops(extendTokenLayer(new TokenLayer()));
    const iss = acct();
    const op = TokenLayer.buildIssue({ name: 'Drop', symbol: 'DRP', decimals: 0, supply: '10000',
        issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey, type: 'token', mintable: false });
    tokens.applyOp(op);
    return { tokens, iss, tokenId: op.tokenId };
}

describe('merkle helpers', () => {
    test('proof verifies for every leaf', () => {
        const leaves = [{ address: 'A', amount: '10' }, { address: 'B', amount: '20' },
            { address: 'C', amount: '30' }, { address: 'D', amount: '40' }, { address: 'E', amount: '50' }];
        const { root } = buildMerkle(leaves);
        leaves.forEach((l, i) => {
            const proof = merkleProof(leaves, i);
            expect(verifyProof(l.address, l.amount, proof, root)).toBe(true);
        });
    });
    test('wrong amount fails proof', () => {
        const leaves = [{ address: 'A', amount: '10' }, { address: 'B', amount: '20' }];
        const { root } = buildMerkle(leaves);
        const proof = merkleProof(leaves, 0);
        expect(verifyProof('A', '999', proof, root)).toBe(false);
    });
});

describe('batch airdrop', () => {
    test('distributes to many recipients atomically', () => {
        const { tokens, iss, tokenId } = setup();
        const r1 = acct(), r2 = acct(), r3 = acct();
        const op = AirdropOps.buildBatchAirdrop({ tokenId,
            recipients: [{ to: r1.address, amount: '100' }, { to: r2.address, amount: '200' }, { to: r3.address, amount: '300' }],
            from: iss.address, fromPubKey: iss.publicKey, privateKey: iss.privateKey });
        const res = tokens.applyOp(op);
        expect(res.ok).toBe(true);
        expect(res.recipients).toBe(3);
        expect(tokens.balanceOf(tokenId, r1.address)).toBe('100');
        expect(tokens.balanceOf(tokenId, r2.address)).toBe('200');
        expect(tokens.balanceOf(tokenId, r3.address)).toBe('300');
        expect(tokens.balanceOf(tokenId, iss.address)).toBe('9400'); // 10000 - 600
    });

    test('fails if issuer lacks balance for the total', () => {
        const { tokens, iss, tokenId } = setup();
        const big = acct();
        const op = AirdropOps.buildBatchAirdrop({ tokenId,
            recipients: [{ to: big.address, amount: '999999' }],
            from: iss.address, fromPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(op).ok).toBe(false);
    });

    test('replay is rejected', () => {
        const { tokens, iss, tokenId } = setup();
        const r = acct();
        const op = AirdropOps.buildBatchAirdrop({ tokenId, recipients: [{ to: r.address, amount: '10' }],
            from: iss.address, fromPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(op).ok).toBe(true);
        expect(tokens.applyOp(op).ok).toBe(false); // same op twice
    });
});

describe('merkle claim airdrop', () => {
    test('create escrows funds, eligible claim succeeds once', () => {
        const { tokens, iss, tokenId } = setup();
        const a = acct(), b = acct(), c = acct();
        const leaves = [{ address: a.address, amount: '100' }, { address: b.address, amount: '250' }, { address: c.address, amount: '150' }];
        const { root } = buildMerkle(leaves);
        const total = 500;

        const createOp = AirdropOps.buildCreateClaimAirdrop({ tokenId, merkleRoot: root, total,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        const cr = tokens.applyOp(createOp);
        expect(cr.ok).toBe(true);
        // issuer balance reduced by escrow
        expect(tokens.balanceOf(tokenId, iss.address)).toBe('9500'); // 10000 - 500
        const airdropId = createOp.airdropId;

        // b claims with a valid proof
        const proofB = merkleProof(leaves, 1);
        const claimB = AirdropOps.buildClaim({ tokenId, airdropId, amount: '250', proof: proofB,
            claimant: b.address, claimantPubKey: b.publicKey, privateKey: b.privateKey });
        const rb = tokens.applyOp(claimB);
        expect(rb.ok).toBe(true);
        expect(tokens.balanceOf(tokenId, b.address)).toBe('250');
        expect(tokens.hasClaimed(airdropId, b.address)).toBe(true);

        // b cannot claim twice
        const claimB2 = AirdropOps.buildClaim({ tokenId, airdropId, amount: '250', proof: proofB,
            claimant: b.address, claimantPubKey: b.publicKey, privateKey: b.privateKey });
        expect(tokens.applyOp(claimB2).ok).toBe(false);
    });

    test('claim with wrong amount / bad proof fails', () => {
        const { tokens, iss, tokenId } = setup();
        const a = acct(), b = acct();
        const leaves = [{ address: a.address, amount: '100' }, { address: b.address, amount: '200' }];
        const { root } = buildMerkle(leaves);
        const createOp = AirdropOps.buildCreateClaimAirdrop({ tokenId, merkleRoot: root, total: 300,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        tokens.applyOp(createOp);
        const airdropId = createOp.airdropId;

        // a tries to claim 999 (not their leaf amount)
        const proofA = merkleProof(leaves, 0);
        const bad = AirdropOps.buildClaim({ tokenId, airdropId, amount: '999', proof: proofA,
            claimant: a.address, claimantPubKey: a.publicKey, privateKey: a.privateKey });
        expect(tokens.applyOp(bad).ok).toBe(false);
    });

    test('ineligible address cannot claim', () => {
        const { tokens, iss, tokenId } = setup();
        const a = acct(), attacker = acct();
        const leaves = [{ address: a.address, amount: '100' }];
        const { root } = buildMerkle(leaves);
        const createOp = AirdropOps.buildCreateClaimAirdrop({ tokenId, merkleRoot: root, total: 100,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        tokens.applyOp(createOp);
        const proof = merkleProof(leaves, 0);
        // attacker uses a's proof but their own address → proof won't verify
        const bad = AirdropOps.buildClaim({ tokenId, airdropId: createOp.airdropId, amount: '100', proof,
            claimant: attacker.address, claimantPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        expect(tokens.applyOp(bad).ok).toBe(false);
    });

    test('only issuer can create an airdrop', () => {
        const { tokens, tokenId } = setup();
        const attacker = acct();
        const createOp = AirdropOps.buildCreateClaimAirdrop({ tokenId, merkleRoot: 'ab'.repeat(32), total: 10,
            issuer: attacker.address, issuerPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        expect(tokens.applyOp(createOp).ok).toBe(false);
    });

    test('getAirdrop reports remaining after a claim', () => {
        const { tokens, iss, tokenId } = setup();
        const a = acct();
        const leaves = [{ address: a.address, amount: '100' }];
        const { root } = buildMerkle(leaves);
        const createOp = AirdropOps.buildCreateClaimAirdrop({ tokenId, merkleRoot: root, total: 100,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        tokens.applyOp(createOp);
        const claim = AirdropOps.buildClaim({ tokenId, airdropId: createOp.airdropId, amount: '100',
            proof: merkleProof(leaves, 0), claimant: a.address, claimantPubKey: a.publicKey, privateKey: a.privateKey });
        tokens.applyOp(claim);
        const info = tokens.getAirdrop(createOp.airdropId);
        expect(info.remaining).toBe('0');
        expect(info.claimedCount).toBe(1);
    });
});
