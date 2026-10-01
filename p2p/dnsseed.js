/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  dnsseed.js — Peer bootstrapping via DNS seeds (Bitcoin-style)
 *
 *  A brand-new node has no peers. Bitcoin solves this with "DNS
 *  seeds": special hostnames whose A/AAAA records resolve to a
 *  rotating set of reachable full-node IPs. The node queries them
 *  once at startup to get an initial peer set, then relies on ADDR
 *  gossip (addrman) thereafter.
 *
 *  Configure seeds via the DNS_SEEDS env var (comma-separated
 *  hostnames), e.g.:
 *      DNS_SEEDS=seed1.spncoin.example,seed2.spncoin.example
 *
 *  This module resolves them and hands the resulting host:port peers
 *  to a callback (usually addrman.add + node.connect). It degrades
 *  gracefully: unresolved seeds are skipped, and a static fallback
 *  list can be supplied.
 */

'use strict';

const dns = require('dns').promises;

const DEFAULT_PORT = parseInt(process.env.P2P_PORT, 10) || 8333;

/**
 * Resolve one DNS seed hostname to a list of { ip, port }.
 */
async function resolveSeed(host, port = DEFAULT_PORT) {
    const out = [];
    // try A (IPv4) and AAAA (IPv6); ignore whichever fails
    const tryResolve = async (fn) => { try { return await fn(); } catch { return []; } };
    const [v4, v6] = await Promise.all([
        tryResolve(() => dns.resolve4(host)),
        tryResolve(() => dns.resolve6(host)),
    ]);
    for (const ip of v4) out.push({ ip, port, source: `dns:${host}` });
    for (const ip of v6) out.push({ ip, port, source: `dns:${host}` });
    return out;
}

/**
 * Resolve every configured seed and return a de-duplicated peer list.
 * @param {object} opts
 * @param {string[]} opts.seeds     hostnames (defaults to DNS_SEEDS env)
 * @param {number}   opts.port      default port for resolved peers
 * @param {string[]} opts.fallback  static "ip:port" list if DNS yields nothing
 * @param {number}   opts.timeoutMs overall timeout
 */
async function discoverSeeds({ seeds, port = DEFAULT_PORT, fallback = [], timeoutMs = 5000 } = {}) {
    const hostList = (seeds && seeds.length ? seeds
        : (process.env.DNS_SEEDS || '').split(',').map(s => s.trim()).filter(Boolean));

    const found = new Map(); // "ip:port" -> {ip,port,source}

    if (hostList.length) {
        const timeout = new Promise(res => setTimeout(() => res([]), timeoutMs));
        const results = await Promise.race([
            Promise.all(hostList.map(h => resolveSeed(h, port))),
            timeout,
        ]);
        for (const list of (results || [])) {
            for (const peer of list) found.set(`${peer.ip}:${peer.port}`, peer);
        }
    }

    // static fallback (e.g. hard-coded seed nodes shipped with the client)
    if (!found.size && fallback.length) {
        for (const entry of fallback) {
            const [ip, p] = entry.split(':');
            if (ip) found.set(entry, { ip, port: parseInt(p, 10) || port, source: 'fallback' });
        }
    }

    return [...found.values()];
}

/**
 * Bootstrap a running node: resolve seeds and feed them to the node's
 * address manager + connect(). Safe no-op if the node lacks these.
 * @returns {Promise<number>} number of peers introduced
 */
async function bootstrap(node, opts = {}) {
    const peers = await discoverSeeds(opts);
    let added = 0;
    for (const peer of peers) {
        try {
            if (node.addrman?.add) node.addrman.add(peer.ip, peer.port, peer.source);
            // let the maintenance loop dial; but also try one immediate connect
            if (typeof node.connect === 'function') node.connect(peer.ip, peer.port);
            added++;
        } catch { /* skip unreachable */ }
    }
    return added;
}

module.exports = { resolveSeed, discoverSeeds, bootstrap, DEFAULT_PORT };
