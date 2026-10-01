'use strict';
const { describe, test } = require('node:test');
require('./_expect');

const { TokenLayer } = require('../tokens/tokens');
const { VSOps, installVestingStaking, vestedAmount } = require('../tokens/vesting-staking');
const { generateKeyPair, publicKeyToAddress } = require('../blockchain/crypto');

const acct = () => { const k = generateKeyPair(); return { ...k, address: publicKeyToAddress(k.publicKey) }; };
function setup() {
    const tokens = installVestingStaking(new TokenLayer());
    const iss = acct();
    const op = TokenLayer.buildIssue({ name: 'Lock', symbol: 'LCK', decimals: 0, supply: '100000',
        issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey, type: 'token', mintable: false });
    tokens.applyOp(op);
    return { tokens, iss, tokenId: op.tokenId };
}

describe('vesting math', () => {
    test('nothing before cliff, linear after, full at end', () => {
        const v = { amount: 1000n, startHeight: 100, cliffBlocks: 10, durationBlocks: 100, released: 0n };
        expect(vestedAmount(v, 100).toString()).toBe('0');   // start
        expect(vestedAmount(v, 105).toString()).toBe('0');   // before cliff
        expect(vestedAmount(v, 150).toString()).toBe('500'); // halfway
        expect(vestedAmount(v, 200).toString()).toBe('1000');// end
        expect(vestedAmount(v, 999).toString()).toBe('1000');// after end
    });
});

describe('vesting ops', () => {
    test('create locks funds; release pays out vested amount over time', () => {
        const { tokens, iss, tokenId } = setup();
        const ben = acct();
        const create = VSOps.buildCreateVesting({ tokenId, beneficiary: ben.address, amount: '1000',
            startHeight: 0, cliffBlocks: 0, durationBlocks: 100,
            funder: iss.address, funderPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(create, { blockHeight: 0 }).ok).toBe(true);
        expect(tokens.balanceOf(tokenId, iss.address)).toBe('99000'); // 100000 - 1000 locked

        // at height 50 → 500 vested, release it
        const rel = VSOps.buildReleaseVesting({ vestingId: create.vestingId, beneficiary: ben.address,
            beneficiaryPubKey: ben.publicKey, privateKey: ben.privateKey });
        const r = tokens.applyOp(rel, { blockHeight: 50 });
        expect(r.ok).toBe(true);
        expect(r.released).toBe('500');
        expect(tokens.balanceOf(tokenId, ben.address)).toBe('500');
    });

    test('release before cliff fails', () => {
        const { tokens, iss, tokenId } = setup();
        const ben = acct();
        const create = VSOps.buildCreateVesting({ tokenId, beneficiary: ben.address, amount: '1000',
            startHeight: 0, cliffBlocks: 50, durationBlocks: 100,
            funder: iss.address, funderPubKey: iss.publicKey, privateKey: iss.privateKey });
        tokens.applyOp(create, { blockHeight: 0 });
        const rel = VSOps.buildReleaseVesting({ vestingId: create.vestingId, beneficiary: ben.address,
            beneficiaryPubKey: ben.publicKey, privateKey: ben.privateKey });
        expect(tokens.applyOp(rel, { blockHeight: 20 }).ok).toBe(false); // before cliff
    });

    test('only beneficiary can release', () => {
        const { tokens, iss, tokenId } = setup();
        const ben = acct(), attacker = acct();
        const create = VSOps.buildCreateVesting({ tokenId, beneficiary: ben.address, amount: '1000',
            startHeight: 0, cliffBlocks: 0, durationBlocks: 10,
            funder: iss.address, funderPubKey: iss.publicKey, privateKey: iss.privateKey });
        tokens.applyOp(create, { blockHeight: 0 });
        const rel = VSOps.buildReleaseVesting({ vestingId: create.vestingId, beneficiary: attacker.address,
            beneficiaryPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        expect(tokens.applyOp(rel, { blockHeight: 100 }).ok).toBe(false);
    });
});

describe('staking ops', () => {
    test('stake locks funds, unstake returns principal + reward', () => {
        const { tokens, iss, tokenId } = setup();
        const staker = acct();
        // give staker some tokens
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: staker.address,
            amount: '10000', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        // issuer funds the reward pool: rewardPerBlock scaled by 1e6 in formula
        const fund = VSOps.buildFundRewardPool({ tokenId, amount: '50000', rewardPerBlock: '1000000', lockBlocks: 0,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(fund, { blockHeight: 0 }).ok).toBe(true);

        const stakeOp = VSOps.buildStake({ tokenId, amount: '1000', staker: staker.address,
            stakerPubKey: staker.publicKey, privateKey: staker.privateKey });
        expect(tokens.applyOp(stakeOp, { blockHeight: 100 }).ok).toBe(true);
        expect(tokens.balanceOf(tokenId, staker.address)).toBe('9000'); // 10000 - 1000 staked

        // unstake 10 blocks later: reward = 1000 * 10 * 1e6 / 1e6 = 10000, capped by pool
        const unstake = VSOps.buildUnstake({ tokenId, stakeId: stakeOp.stakeId, staker: staker.address,
            stakerPubKey: staker.publicKey, privateKey: staker.privateKey });
        const r = tokens.applyOp(unstake, { blockHeight: 110 });
        expect(r.ok).toBe(true);
        expect(BigInt(r.principal)).toBe(1000n);
        expect(BigInt(r.reward)).toBeGreaterThan(0n);
        // staker got principal + reward back
        expect(BigInt(tokens.balanceOf(tokenId, staker.address))).toBe(9000n + 1000n + BigInt(r.reward));
    });

    test('unstake respects lock period', () => {
        const { tokens, iss, tokenId } = setup();
        const staker = acct();
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: staker.address,
            amount: '5000', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        tokens.applyOp(VSOps.buildFundRewardPool({ tokenId, amount: '10000', rewardPerBlock: '1000000', lockBlocks: 50,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey }), { blockHeight: 0 });
        const stakeOp = VSOps.buildStake({ tokenId, amount: '1000', staker: staker.address,
            stakerPubKey: staker.publicKey, privateKey: staker.privateKey });
        tokens.applyOp(stakeOp, { blockHeight: 100 });
        const unstake = VSOps.buildUnstake({ tokenId, stakeId: stakeOp.stakeId, staker: staker.address,
            stakerPubKey: staker.publicKey, privateKey: staker.privateKey });
        expect(tokens.applyOp(unstake, { blockHeight: 120 }).ok).toBe(false); // only 20 < 50 lock
        expect(tokens.applyOp(unstake, { blockHeight: 160 }).ok).toBe(true);  // 60 >= 50
    });

    test('only issuer can fund reward pool', () => {
        const { tokens, tokenId } = setup();
        const attacker = acct();
        const fund = VSOps.buildFundRewardPool({ tokenId, amount: '100', rewardPerBlock: '1', lockBlocks: 0,
            issuer: attacker.address, issuerPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        expect(tokens.applyOp(fund, { blockHeight: 0 }).ok).toBe(false);
    });
});
