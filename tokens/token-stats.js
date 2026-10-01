/**
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL. All Rights Reserved.
 *
 * token-stats.js — Rankings & detailed token statistics for the explorer.
 * Read-only aggregations over the token layer state.
 */
'use strict';

function installTokenStats(tokens) {
    if (!tokens || tokens.__stats) return tokens;
    tokens.__stats = true;

    // Top tokens by a metric.
    tokens.topTokens = function ({ by = 'holders', limit = 20 } = {}) {
        const list = tokens.list().map(tk => {
            const t = tokens.tokens.get(tk.tokenId);
            const holders = t ? [...t.balances.keys()].length : 0;
            return { tokenId: tk.tokenId, name: tk.name, symbol: tk.symbol,
                kind: tk.kind, supply: tk.supply, holders, created: tk.created || 0 };
        });
        const sorters = {
            holders: (a, b) => b.holders - a.holders,
            supply: (a, b) => (BigInt(b.supply) > BigInt(a.supply) ? 1 : -1),
            newest: (a, b) => b.created - a.created,
        };
        list.sort(sorters[by] || sorters.holders);
        return list.slice(0, limit);
    };

    // Top holders of a specific token.
    tokens.topHolders = function (tokenId, limit = 20) {
        const t = tokens.tokens.get(tokenId);
        if (!t) return null;
        const supply = t.supply || 1n;
        const holders = [...t.balances.entries()]
            .map(([address, bal]) => ({ address, amount: bal.toString(),
                percent: Number((bal * 10000n) / supply) / 100, raw: bal }))
            .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0))
            .slice(0, limit)
            .map(({ raw, ...rest }) => rest);
        return { tokenId, totalHolders: t.balances.size, supply: supply.toString(), holders };
    };

    // Full detail bundle for a token detail page.
    tokens.tokenDetail = function (tokenId) {
        const base = tokens.getToken?.(tokenId);
        if (!base) return null;
        const meta = tokens.getMeta ? tokens.getMeta(tokenId) : base;
        // Rich per-token contract identity (deterministic, forge-proof).
        let identity = null;
        try {
            const { deriveContractIdentity } = require('./coin-address');
            identity = deriveContractIdentity({
                tokenId, issuer: base.issuer, symbol: base.symbol,
                decimals: base.decimals, supply: base.supply, kind: base.kind,
            });
        } catch { /* identity is best-effort */ }
        return {
            ...base,
            extra: meta.extra || {},
            frozen: meta.frozen || [],
            coinAddress: meta.extra?.coinAddress || (identity && identity.contractAddress) || null,
            identity,
            topHolders: tokens.topHolders(tokenId, 10)?.holders || [],
            distribution: tokens.distribution ? tokens.distribution(tokenId, 5) : null,
            airdrops: tokens.listAirdrops ? tokens.listAirdrops(tokenId) : [],
            rewardPool: tokens.getRewardPool ? tokens.getRewardPool(tokenId) : null,
        };
    };

    // Global network token stats.
    tokens.globalStats = function () {
        const list = tokens.list();
        let totalHolders = 0, coins = 0, tokenCount = 0;
        for (const tk of list) {
            const t = tokens.tokens.get(tk.tokenId);
            if (t) totalHolders += t.balances.size;
            if (tk.kind === 'coin') coins++; else tokenCount++;
        }
        return { totalAssets: list.length, coins, tokens: tokenCount, totalHolderEntries: totalHolders };
    };

    return tokens;
}

module.exports = { installTokenStats };
