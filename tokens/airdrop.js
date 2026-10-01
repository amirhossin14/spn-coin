/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  airdrop.js — Token airdrops (two models)
 *
 *   A) Batch airdrop  — the issuer signs ONE op containing many
 *      (address, amount) recipients; balances move atomically when
 *      the carrying tx confirms. Great for small/known lists.
 *
 *   B) Merkle claim airdrop — the issuer commits to a merkle root of
 *      all (address, amount) leaves and escrows the total. Recipients
 *      later submit a signed CLAIM with a merkle proof; each address
 *      can claim exactly once. Scales to huge lists (only the root is
 *      on-chain) and is the standard modern airdrop design.
 *
 *  Both are signed + replay-protected like every other token op.
 */

'use strict';

const crypto = require('crypto');
const { sha256, sign, verify } = require('../blockchain/crypto');
const { CHAIN_ID } = require('../config');

function canon(body) { return JSON.stringify(body, Object.keys(body).sort()); }
function opHash(op) { const { sig, ...b } = op; return sha256(canon(b)); }

// ── merkle helpers over (address|amount) leaves ──────────────
function leafHash(address, amount) {
    return sha256(`airdrop-leaf:${address}:${amount}`);
}
function hashPair(a, b) {
    // order-independent pairing so proofs don't need left/right flags to be
    // canonicalized by the caller: we sort the two hashes.
    return a <= b ? sha256(a + b) : sha256(b + a);
}
function buildMerkle(leaves) {
    // leaves: [{address, amount}] → { root, layers, index map }
    if (!leaves.length) return { root: sha256('empty'), leaves: [], layerList: [] };
    let layer = leaves.map(l => leafHash(l.address, String(l.amount)));
    const layerList = [layer];
    while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2) {
            const a = layer[i];
            const b = i + 1 < layer.length ? layer[i + 1] : layer[i]; // duplicate last
            next.push(hashPair(a, b));
        }
        layer = next;
        layerList.push(layer);
    }
    return { root: layer[0], layerList };
}
function merkleProof(leaves, index) {
    const { layerList } = buildMerkle(leaves);
    const proof = [];
    let idx = index;
    for (let l = 0; l < layerList.length - 1; l++) {
        const layer = layerList[l];
        const pairIdx = idx ^ 1;
        const sibling = pairIdx < layer.length ? layer[pairIdx] : layer[idx];
        proof.push(sibling);
        idx = Math.floor(idx / 2);
    }
    return proof;
}
function verifyProof(address, amount, proof, root) {
    let h = leafHash(address, String(amount));
    for (const sib of proof) h = hashPair(h, sib);
    return h === root;
}

// ── signed op builders (client side) ─────────────────────────
const AirdropOps = {
    // A) batch — recipients: [{ to, amount }]
    buildBatchAirdrop({ tokenId, recipients, from, fromPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const clean = (recipients || []).map(r => ({ to: r.to, amount: String(r.amount) }));
        const body = { type: 'airdrop-batch', tokenId, recipients: clean, from, fromPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },

    // B) create a merkle claim airdrop — escrows `total` from issuer
    buildCreateClaimAirdrop({ tokenId, merkleRoot, total, airdropId, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const id = airdropId || sha256(`${tokenId}|${merkleRoot}|${nonce}`).slice(0, 32);
        const body = { type: 'airdrop-create', tokenId, airdropId: id, merkleRoot,
            total: String(total), issuer, issuerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },

    // B) claim from a merkle airdrop — claimant signs, includes proof
    buildClaim({ tokenId, airdropId, amount, proof, claimant, claimantPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'airdrop-claim', tokenId, airdropId, amount: String(amount),
            proof, claimant, claimantPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
};

/**
 * Install airdrop op handling on an (already extended) TokenLayer.
 */
function installAirdrops(tokens) {
    if (!tokens || tokens.__airdrops) return tokens;
    tokens.__airdrops = true;
    tokens._airdrops = new Map(); // airdropId -> { tokenId, root, total, claimed:Set, remaining }

    const verifyOp = (op) => {
        if (!op || !op.sig || !op.type) return 'malformed op';
        if (Number(op.chainId) !== Number(CHAIN_ID)) return 'wrong chain id';
        const pub = op.fromPubKey || op.issuerPubKey || op.claimantPubKey;
        if (!pub) return 'missing pubkey';
        let ok = false;
        try { ok = verify(pub, opHash(op), op.sig); } catch { ok = false; }
        return ok ? null : 'bad signature';
    };

    const prev = tokens.applyOp.bind(tokens);
    const AIR = ['airdrop-batch', 'airdrop-create', 'airdrop-claim'];

    tokens.applyOp = function (op, ctx = {}) {
        if (!AIR.includes(op?.type)) return prev(op, ctx);

        const err = verifyOp(op);
        if (err) return { ok: false, error: err };
        const h = opHash(op);
        if (tokens.seenOps.has(h)) return { ok: false, error: 'duplicate op (replay)' };

        const t = tokens.tokens.get(op.tokenId);
        if (!t) return { ok: false, error: 'no such token' };

        // frozen-address guard (reuse if the freeze extension is present)
        const frozen = tokens._frozen?.get(op.tokenId);

        if (op.type === 'airdrop-batch') {
            if (t.meta.issuer !== op.from && !(t.balances.get(op.from) > 0n))
                return { ok: false, error: 'sender holds none of this token' };
            let total = 0n;
            const parsed = [];
            for (const r of op.recipients || []) {
                let a; try { a = BigInt(r.amount); } catch { return { ok: false, error: 'bad amount' }; }
                if (a <= 0n) return { ok: false, error: 'amounts must be > 0' };
                if (frozen && (frozen.has(op.from) || frozen.has(r.to)))
                    return { ok: false, error: 'a frozen address is involved' };
                total += a; parsed.push({ to: r.to, amount: a });
            }
            const bal = t.balances.get(op.from) || 0n;
            if (bal < total) return { ok: false, error: 'insufficient balance for airdrop total' };
            // apply atomically
            t.balances.set(op.from, bal - total);
            if (t.balances.get(op.from) === 0n) t.balances.delete(op.from);
            for (const r of parsed) t.balances.set(r.to, (t.balances.get(r.to) || 0n) + r.amount);
            tokens.seenOps.add(h);
            return { ok: true, recipients: parsed.length, total: total.toString() };
        }

        if (op.type === 'airdrop-create') {
            if (t.meta.issuer !== op.issuer) return { ok: false, error: 'only issuer can create an airdrop' };
            if (tokens._airdrops.has(op.airdropId)) return { ok: false, error: 'airdrop id exists' };
            let total; try { total = BigInt(op.total); } catch { return { ok: false, error: 'bad total' }; }
            const bal = t.balances.get(op.issuer) || 0n;
            if (bal < total) return { ok: false, error: 'insufficient balance to fund airdrop' };
            // escrow: move issuer funds into the airdrop pool
            t.balances.set(op.issuer, bal - total);
            if (t.balances.get(op.issuer) === 0n) t.balances.delete(op.issuer);
            tokens._airdrops.set(op.airdropId, {
                tokenId: op.tokenId, root: op.merkleRoot, total, remaining: total,
                claimed: new Set(), created: Date.now(),
            });
            tokens.seenOps.add(h);
            return { ok: true, airdropId: op.airdropId, escrowed: total.toString() };
        }

        if (op.type === 'airdrop-claim') {
            const drop = tokens._airdrops.get(op.airdropId);
            if (!drop) return { ok: false, error: 'no such airdrop' };
            if (drop.tokenId !== op.tokenId) return { ok: false, error: 'token mismatch' };
            if (drop.claimed.has(op.claimant)) return { ok: false, error: 'already claimed' };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: 'bad amount' }; }
            if (!verifyProof(op.claimant, op.amount, op.proof || [], drop.root))
                return { ok: false, error: 'invalid merkle proof — not eligible' };
            if (drop.remaining < amt) return { ok: false, error: 'airdrop exhausted' };
            if (frozen && frozen.has(op.claimant)) return { ok: false, error: 'claimant is frozen' };
            drop.remaining -= amt;
            drop.claimed.add(op.claimant);
            t.balances.set(op.claimant, (t.balances.get(op.claimant) || 0n) + amt);
            tokens.seenOps.add(h);
            return { ok: true, claimed: amt.toString(), remaining: drop.remaining.toString() };
        }

        return { ok: false, error: 'unknown airdrop op' };
    };

    // ── read helpers ──────────────────────────────────────────
    tokens.getAirdrop = function (airdropId) {
        const d = tokens._airdrops.get(airdropId);
        if (!d) return null;
        return { airdropId, tokenId: d.tokenId, root: d.root, total: d.total.toString(),
            remaining: d.remaining.toString(), claimedCount: d.claimed.size, created: d.created };
    };
    tokens.listAirdrops = function (tokenId = null) {
        const out = [];
        for (const [id, d] of tokens._airdrops)
            if (!tokenId || d.tokenId === tokenId)
                out.push(tokens.getAirdrop(id));
        return out;
    };
    tokens.hasClaimed = function (airdropId, address) {
        return !!tokens._airdrops.get(airdropId)?.claimed.has(address);
    };

    // ── Off-chain recipient-list registry (so the node can serve proofs) ──
    // The issuer publishes the full leaf list here after creating the
    // airdrop. Only the merkle ROOT is trustless/on-chain; this registry
    // is a convenience so eligible users can fetch their proof. A stored
    // list is accepted only if it hashes to the airdrop's on-chain root.
    tokens._airdropLeaves = new Map(); // airdropId -> [{address, amount}]

    tokens.registerAirdropList = function (airdropId, leaves) {
        const drop = tokens._airdrops.get(airdropId);
        if (!drop) return { ok: false, error: 'no such airdrop' };
        const { root } = buildMerkle(leaves || []);
        if (root !== drop.root) return { ok: false, error: 'list does not match the on-chain merkle root' };
        tokens._airdropLeaves.set(airdropId, leaves.map(l => ({ address: l.address, amount: String(l.amount) })));
        return { ok: true, count: leaves.length };
    };

    tokens.getAirdropProof = function (airdropId, address) {
        const leaves = tokens._airdropLeaves.get(airdropId);
        if (!leaves) return { ok: false, error: 'recipient list not published for this airdrop' };
        const index = leaves.findIndex(l => l.address === address);
        if (index < 0) return { ok: false, error: 'address is not in this airdrop' };
        const proof = merkleProof(leaves, index);
        return { ok: true, address, amount: leaves[index].amount, proof, airdropId };
    };

    return tokens;
}

module.exports = { AirdropOps, installAirdrops, buildMerkle, merkleProof, verifyProof, leafHash };
