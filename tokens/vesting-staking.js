/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  vesting-staking.js — Two on-chain token capabilities:
 *
 *   • VESTING  — lock tokens that release gradually over time.
 *     The issuer/holder creates a schedule (total, start, cliff,
 *     duration). The beneficiary can `release` whatever has vested
 *     so far. Linear vesting after an optional cliff.
 *
 *   • STAKING  — lock tokens to earn rewards. A holder `stake`s an
 *     amount; rewards accrue per block at a configured rate; the
 *     holder can `unstake` (after an optional lock period) to get
 *     principal + accrued reward back (reward minted from the
 *     issuer-funded reward pool).
 *
 *  Time is measured in block height (deterministic across nodes),
 *  taken from the apply context. All ops are signed + replay-safe.
 */

'use strict';

const crypto = require('crypto');
const { sha256, sign, verify } = require('../blockchain/crypto');
const { CHAIN_ID } = require('../config');

function canon(b) { return JSON.stringify(b, Object.keys(b).sort()); }
function opHash(op) { const { sig, ...b } = op; return sha256(canon(b)); }

// ── signed op builders (client side) ─────────────────────────
const VSOps = {
    // Vesting
    buildCreateVesting({ tokenId, beneficiary, amount, startHeight, cliffBlocks, durationBlocks,
                         funder, funderPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const vestingId = sha256(`vest:${tokenId}:${beneficiary}:${amount}:${nonce}`).slice(0, 32);
        const body = { type: 'vesting-create', tokenId, vestingId, beneficiary, amount: String(amount),
            startHeight: Number(startHeight) || 0, cliffBlocks: Number(cliffBlocks) || 0,
            durationBlocks: Number(durationBlocks) || 1, funder, funderPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildReleaseVesting({ vestingId, beneficiary, beneficiaryPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'vesting-release', vestingId, beneficiary, beneficiaryPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },

    // Staking
    buildFundRewardPool({ tokenId, amount, rewardPerBlock, lockBlocks, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'stake-fund', tokenId, amount: String(amount),
            rewardPerBlock: String(rewardPerBlock), lockBlocks: Number(lockBlocks) || 0,
            issuer, issuerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildStake({ tokenId, amount, staker, stakerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const stakeId = sha256(`stake:${tokenId}:${staker}:${amount}:${nonce}`).slice(0, 32);
        const body = { type: 'stake', tokenId, stakeId, amount: String(amount), staker, stakerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildUnstake({ tokenId, stakeId, staker, stakerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'unstake', tokenId, stakeId, staker, stakerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
};

function vestedAmount(v, height) {
    const total = v.amount;
    if (height < v.startHeight + v.cliffBlocks) return 0n;
    const elapsed = height - v.startHeight;
    if (elapsed >= v.durationBlocks) return total;
    // linear: total * elapsed / duration
    return (total * BigInt(elapsed)) / BigInt(v.durationBlocks);
}

function installVestingStaking(tokens) {
    if (!tokens || tokens.__vs) return tokens;
    tokens.__vs = true;
    tokens._vesting = new Map();       // vestingId -> schedule
    tokens._stakes = new Map();        // stakeId -> stake
    tokens._rewardPool = new Map();    // tokenId -> { pool, rewardPerBlock, lockBlocks }

    const verifyOp = (op) => {
        if (!op || !op.sig || !op.type) return 'malformed op';
        if (Number(op.chainId) !== Number(CHAIN_ID)) return 'wrong chain id';
        const pub = op.funderPubKey || op.beneficiaryPubKey || op.issuerPubKey || op.stakerPubKey;
        if (!pub) return 'missing pubkey';
        let ok = false;
        try { ok = verify(pub, opHash(op), op.sig); } catch { ok = false; }
        return ok ? null : 'bad signature';
    };
    const height = (ctx) => Number(ctx?.blockHeight ?? ctx?.height ?? tokens.currentHeight ?? 0);
    const bal = (t, a) => t.balances.get(a) || 0n;
    const credit = (t, a, amt) => t.balances.set(a, bal(t, a) + amt);
    const debit = (t, a, amt) => { const b = bal(t, a); if (b < amt) return false; t.balances.set(a, b - amt); if (t.balances.get(a) === 0n) t.balances.delete(a); return true; };

    const prev = tokens.applyOp.bind(tokens);
    const VS = ['vesting-create', 'vesting-release', 'stake-fund', 'stake', 'unstake'];

    tokens.applyOp = function (op, ctx = {}) {
        if (!VS.includes(op?.type)) return prev(op, ctx);
        const err = verifyOp(op); if (err) return { ok: false, error: err };
        const h = opHash(op);
        if (tokens.seenOps.has(h)) return { ok: false, error: 'duplicate op (replay)' };
        const H = height(ctx);

        // ── VESTING ──
        if (op.type === 'vesting-create') {
            const t = tokens.tokens.get(op.tokenId); if (!t) return { ok: false, error: 'no such token' };
            if (tokens._vesting.has(op.vestingId)) return { ok: false, error: 'vesting id exists' };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: 'bad amount' }; }
            if (amt <= 0n) return { ok: false, error: 'amount must be > 0' };
            if (!debit(t, op.funder, amt)) return { ok: false, error: 'insufficient balance to fund vesting' };
            tokens._vesting.set(op.vestingId, {
                tokenId: op.tokenId, beneficiary: op.beneficiary, amount: amt,
                startHeight: op.startHeight, cliffBlocks: op.cliffBlocks, durationBlocks: op.durationBlocks,
                released: 0n, created: H,
            });
            tokens.seenOps.add(h);
            return { ok: true, vestingId: op.vestingId };
        }
        if (op.type === 'vesting-release') {
            const v = tokens._vesting.get(op.vestingId); if (!v) return { ok: false, error: 'no such vesting' };
            if (v.beneficiary !== op.beneficiary) return { ok: false, error: 'not the beneficiary' };
            const t = tokens.tokens.get(v.tokenId);
            const vested = vestedAmount(v, H);
            const releasable = vested - v.released;
            if (releasable <= 0n) return { ok: false, error: 'nothing to release yet' };
            v.released += releasable;
            credit(t, v.beneficiary, releasable);
            tokens.seenOps.add(h);
            return { ok: true, released: releasable.toString(), totalReleased: v.released.toString() };
        }

        // ── STAKING ──
        if (op.type === 'stake-fund') {
            const t = tokens.tokens.get(op.tokenId); if (!t) return { ok: false, error: 'no such token' };
            if (t.meta.issuer !== op.issuer) return { ok: false, error: 'only issuer can fund rewards' };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: 'bad amount' }; }
            if (!debit(t, op.issuer, amt)) return { ok: false, error: 'insufficient balance to fund pool' };
            const cur = tokens._rewardPool.get(op.tokenId) || { pool: 0n, rewardPerBlock: 0n, lockBlocks: 0 };
            cur.pool += amt;
            cur.rewardPerBlock = BigInt(op.rewardPerBlock || cur.rewardPerBlock);
            cur.lockBlocks = op.lockBlocks || cur.lockBlocks;
            tokens._rewardPool.set(op.tokenId, cur);
            tokens.seenOps.add(h);
            return { ok: true, pool: cur.pool.toString() };
        }
        if (op.type === 'stake') {
            const t = tokens.tokens.get(op.tokenId); if (!t) return { ok: false, error: 'no such token' };
            if (tokens._stakes.has(op.stakeId)) return { ok: false, error: 'stake id exists' };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: 'bad amount' }; }
            if (amt <= 0n) return { ok: false, error: 'amount must be > 0' };
            if (!debit(t, op.staker, amt)) return { ok: false, error: 'insufficient balance to stake' };
            tokens._stakes.set(op.stakeId, { tokenId: op.tokenId, staker: op.staker, amount: amt, startHeight: H });
            tokens.seenOps.add(h);
            return { ok: true, stakeId: op.stakeId, startHeight: H };
        }
        if (op.type === 'unstake') {
            const s = tokens._stakes.get(op.stakeId); if (!s) return { ok: false, error: 'no such stake' };
            if (s.staker !== op.staker) return { ok: false, error: 'not the staker' };
            const cfg = tokens._rewardPool.get(op.tokenId) || { pool: 0n, rewardPerBlock: 0n, lockBlocks: 0 };
            if (H - s.startHeight < cfg.lockBlocks) return { ok: false, error: `locked for ${cfg.lockBlocks - (H - s.startHeight)} more blocks` };
            const t = tokens.tokens.get(op.tokenId);
            const blocks = BigInt(Math.max(0, H - s.startHeight));
            // reward proportional to amount * blocks * rewardPerBlock / 1e6 (scaled)
            let reward = (s.amount * blocks * cfg.rewardPerBlock) / 1000000n;
            if (reward > cfg.pool) reward = cfg.pool;   // cap by available pool
            cfg.pool -= reward;
            tokens._rewardPool.set(op.tokenId, cfg);
            credit(t, s.staker, s.amount + reward);      // principal + reward
            tokens._stakes.delete(op.stakeId);
            tokens.seenOps.add(h);
            return { ok: true, principal: s.amount.toString(), reward: reward.toString(), blocks: blocks.toString() };
        }
        return { ok: false, error: 'unknown vesting/staking op' };
    };

    // ── read helpers ──
    tokens.getVesting = function (id, height) {
        const v = tokens._vesting.get(id); if (!v) return null;
        const H = Number(height ?? tokens.currentHeight ?? 0);
        const vested = vestedAmount(v, H);
        return { vestingId: id, tokenId: v.tokenId, beneficiary: v.beneficiary,
            amount: v.amount.toString(), released: v.released.toString(),
            vested: vested.toString(), releasable: (vested - v.released).toString(),
            startHeight: v.startHeight, cliffBlocks: v.cliffBlocks, durationBlocks: v.durationBlocks };
    };
    tokens.listVestings = (beneficiary = null) => {
        const out = [];
        for (const [id, v] of tokens._vesting)
            if (!beneficiary || v.beneficiary === beneficiary) out.push(tokens.getVesting(id));
        return out;
    };
    tokens.getStake = (id) => {
        const s = tokens._stakes.get(id); if (!s) return null;
        return { stakeId: id, tokenId: s.tokenId, staker: s.staker, amount: s.amount.toString(), startHeight: s.startHeight };
    };
    tokens.listStakes = (staker = null) => {
        const out = [];
        for (const [id, s] of tokens._stakes)
            if (!staker || s.staker === staker) out.push(tokens.getStake(id));
        return out;
    };
    tokens.getRewardPool = (tokenId) => {
        const c = tokens._rewardPool.get(tokenId);
        return c ? { pool: c.pool.toString(), rewardPerBlock: c.rewardPerBlock.toString(), lockBlocks: c.lockBlocks } : null;
    };

    return tokens;
}

module.exports = { VSOps, installVestingStaking, vestedAmount };
