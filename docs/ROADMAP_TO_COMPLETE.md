# SPN Coin — Roadmap to Completion and Checklist for a Full Blockchain

> A document for taking SPN Coin from a functional core (~80–85%) to a production-ready network.
> This document has two parts: (1) what was added in this stage, (2) the remaining work to reach 100%.

---

## Part 1 — What Was Implemented and Added in This Stage

Five new modules were built in the `p2p/` directory and wired into the server in a safe and optional way. All of these modules are verified by 19 unit tests and 8 integration tests, and they work without modifying the core code.

### 1.1 Advanced Peer Discovery — `p2p/addrman.js`
An address manager inspired by Bitcoin:
- Separation of the "tried" table (verified peers) from the "new" table (heard of but not yet verified).
- Scoring based on success/failure and exponential backoff to avoid repeatedly reconnecting to a bad peer.
- Spreading connections across network groups (/16) for resistance to **Eclipse attacks**.
- Save/restore capability (JSON) so the peer table survives a restart.

### 1.2 Network DoS Protection — `p2p/netguard.js`
- **Token-bucket rate limiter** per peer and per message type (INV, GETDATA, BLOCK, etc.).
- **Misbehavior scoring system** (like Bitcoin's Ban Score): each violation adds a penalty; at the threshold of 100, the peer is banned for 24 hours.
- Gradual score decay with good behavior (hourly decay) and persistence of the ban list.

### 1.3 Fast Sync (Headers-First) — `p2p/syncmanager.js`
- First only the header chain is downloaded (small; PoW and links are validated).
- Then block bodies are fetched **in parallel, using a sliding window** (up to 16 concurrent requests) from multiple peers.
- Detection and re-request of stalled blocks with a 30-second timeout.
- Reporting of sync progress percentage.

### 1.4 Storage Optimization — `p2p/pruner.js`
- **Optional pruning**: after the UTXO set is built, the bodies of blocks older than the retention window are deleted (headers remain). An archival node can keep everything.
- **Compact header codec**: each header is stored/transmitted in 80 binary bytes (Bitcoin layout) instead of bulky JSON.

### 1.5 Integration Layer — `p2p/net-enhance.js`
- A single call to `enhanceNode(node, opts)` installs all of the above on a node.
- "Degrade gracefully" design: if the current transport lacks a method, that hook is silently skipped (rather than crashing).
- A maintenance loop that keeps the number of connections above the minimum, runs pruning, and aggregates statistics.

### Activation
It is wired into `server.js` automatically and safely, and controlled via environment variables:

```bash
MIN_PEERS=4        # minimum number of active connections
MAX_PEERS=8        # connection cap
PRUNE=1            # enable pruning (default off)
PRUNE_KEEP=288     # number of full blocks to keep
```

---

## Part 2 — Full Checklist to 100%

Status of each item: ✅ complete · 🟡 basic/incomplete · ⬜ not done

### A) Chain Core (Consensus & Core)
- ✅ UTXO model with apply/undo
- ✅ Proof of Work with compact nBits
- ✅ Difficulty adjustment (retarget) with 4x clamp
- ✅ Halving and block reward
- ✅ Merkle tree and Merkle proofs
- ✅ Chain reorg based on most work
- ✅ Script engine (P2PKH, multisig, timelock)
- 🟡 Standalone header validation (`validateHeader`) — the hook is ready, the full logic is needed
- ⬜ SegWit (segregated witness) — fundamental change, optional
- ⬜ Taproot / Schnorr signatures — advanced, optional

### B) Networking
- ✅ P2P over raw sockets + HTTP version
- ✅ Advanced peer discovery (this stage)
- ✅ DoS protection and ban score (this stage)
- ✅ Headers-first synchronization (this stage)
- 🟡 Connecting to a real network with hundreds of nodes — requires lengthy field testing
- ⬜ Automatic discovery via DNS seeds
- ⬜ Tor support / node privacy

### C) Storage and Scalability
- ✅ Persistence with PostgreSQL
- ✅ Basic pruning + compact header codec (this stage)
- 🟡 Initial Block Download (IBD) — logic ready, needs testing at scale
- ⬜ Fast-sync with UTXO snapshot
- ⬜ Efficient indexing for the explorer at large scale

### D) Security
- ✅ JWT, 2FA (TOTP)
- ✅ IDS/IPS, rate limiting, role-based access control
- ✅ Basic KYC
- 🔴 **Server-side signing** — the user's private key is sent to the server; this **must** be changed to client-side signing (critical)
- ⬜ **Independent security audit** by a specialized firm — a prerequisite for holding real money
- ⬜ Bug bounty program

### E) Ecosystem
- ✅ Web explorer, dashboard, threat radar
- ✅ CLI wallet with HD (BIP39)
- ✅ Token layer (coin/token issuance)
- ⬜ Mobile wallet (iOS/Android)
- ⬜ Browser wallet / extension
- ⬜ Exchange integration
- ⬜ SDK and complete developer documentation
- ⬜ Stable public testnet + faucet

---

## Part 3 — Suggested Prioritization (Three Phases)

**Phase 1 — Core Security (urgent):**
1. Move signing to the client side (fix the critical private-key issue).
2. Complete `validateHeader` for full header-chain validation.
3. Launch a public testnet for field testing the new network.

**Phase 2 — Network Maturity:**
4. DNS seeds for automatic discovery.
5. Test the new modules with dozens of real nodes.
6. Fast-sync with snapshot.

**Phase 3 — Production Ready:**
7. Independent security audit.
8. Bug bounty.
9. Ecosystem (mobile wallet, SDK, exchange).

---

## Important Security Note

The 🔴 item (server-side signing) is the only current **critical** flaw. As long as the user's private key leaves their device and is sent to the server, this system must not be used with real money. The rest of the ⬜ items are needed for "completeness" but pose no direct risk.

---

*© 2026 SPN Coin Project. This document describes the state of the project at the time of writing.*
