/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  hd-account.js — Full BIP-44 account layer over wallet/hd.js
 *
 *  The existing hd.js derives a single external chain
 *  (m/44'/0'/0'/0/i). A complete BIP-44 wallet also needs:
 *
 *    • Accounts:        m/44'/coin'/account'/…
 *    • Two chains each: 0 = external (receive), 1 = internal (change)
 *    • Gap-limit discovery: scan addresses until `gapLimit` unused ones
 *      are seen in a row, so a restored wallet finds all its coins.
 *
 *  This module adds those without touching hd.js.
 */

'use strict';

const hd = require('./hd');

const COIN_TYPE = parseInt(process.env.HD_COIN_TYPE, 10) || 0; // 0 = bitcoin-like
const GAP_LIMIT = 20;

const CHAIN = { EXTERNAL: 0, INTERNAL: 1 };

/** Full BIP-44 path: m / 44' / coin' / account' / change / index */
function path(account, change, index) {
    return `m/44'/${COIN_TYPE}'/${account}'/${change}/${index}`;
}

/** Derive a project keypair at a precise BIP-44 location. */
function deriveKey(seed, { account = 0, change = CHAIN.EXTERNAL, index = 0 } = {}) {
    const node = hd.derivePath(seed, path(account, change, index));
    // hd.js exposes compressedPub/keyFromMnemonic; reuse its project-key builder
    return hd.buildProjectKey ? hd.buildProjectKey(node.key)
        : { privateKey: node.key.toString('hex'), chainCode: node.chainCode?.toString('hex') };
}

/** Next receive address (external chain). */
function receiveAddress(seed, account, index, toAddress) {
    const k = deriveKey(seed, { account, change: CHAIN.EXTERNAL, index });
    return { ...k, address: toAddress ? toAddress(k) : k.address, index, change: CHAIN.EXTERNAL };
}

/** Next change address (internal chain). */
function changeAddress(seed, account, index, toAddress) {
    const k = deriveKey(seed, { account, change: CHAIN.INTERNAL, index });
    return { ...k, address: toAddress ? toAddress(k) : k.address, index, change: CHAIN.INTERNAL };
}

/**
 * Gap-limit discovery. `isUsed(address)` should return true if the
 * address has any on-chain history. Scans an account's external chain
 * (and optionally internal) until GAP_LIMIT consecutive unused
 * addresses are found.
 *
 * @returns {{ used: object[], nextIndex:number }}
 */
function discover(seed, { account = 0, change = CHAIN.EXTERNAL, isUsed, toAddress, gapLimit = GAP_LIMIT }) {
    const used = [];
    let consecutiveUnused = 0;
    let index = 0;
    let lastUsedIndex = -1;

    while (consecutiveUnused < gapLimit) {
        const k = deriveKey(seed, { account, change, index });
        const address = toAddress ? toAddress(k) : k.address;
        if (isUsed(address)) {
            used.push({ address, index, change });
            lastUsedIndex = index;
            consecutiveUnused = 0;
        } else {
            consecutiveUnused++;
        }
        index++;
        if (index > 100_000) break; // hard safety cap
    }
    return { used, nextIndex: lastUsedIndex + 1 };
}

/**
 * Discover how many accounts a wallet uses: BIP-44 says stop after the
 * first account with no transactions on its external chain.
 */
function discoverAccounts(seed, { isUsed, toAddress, maxAccounts = 25 }) {
    const accounts = [];
    for (let a = 0; a < maxAccounts; a++) {
        const first = deriveKey(seed, { account: a, change: CHAIN.EXTERNAL, index: 0 });
        const addr = toAddress ? toAddress(first) : first.address;
        if (!isUsed(addr) && a > 0) break; // account gap → done
        const ext = discover(seed, { account: a, change: CHAIN.EXTERNAL, isUsed, toAddress });
        const int = discover(seed, { account: a, change: CHAIN.INTERNAL, isUsed, toAddress });
        if (!ext.used.length && a > 0) break;
        accounts.push({ account: a, external: ext, internal: int });
    }
    return accounts;
}

module.exports = { path, deriveKey, receiveAddress, changeAddress,
    discover, discoverAccounts, CHAIN, COIN_TYPE, GAP_LIMIT };
