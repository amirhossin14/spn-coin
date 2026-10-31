# SPN Coin — Added Bitcoin-Style Features

This document explains eight Bitcoin-like features added to the project. They all live in the `bitcoin/` directory (and `wallet/hd-account.js`), as additions without modifying the core code, and are verified by 16 jest tests (`test/bitcoin.test.js`).

## 1. SegWit — Witness Separation (`bitcoin/segwit.js`)
- `txid` is computed without the witness → **malleability fix** (transaction malleability).
- `wtxid` is computed with the witness.
- **Witness commitment** in the coinbase: the Merkle root of all wtxids, so that the witness is also committed to by PoW.

## 2. Fee Rate-Based Fees (`bitcoin/feerate.js`)
- Computes `vsize` (virtual size) with a **witness discount** (weight = base×3 + total, per BIP-141).
- Fee rate = satoshis per virtual byte (sat/vB).
- A fee estimator based on recent mempool contents.

## 3. Advanced Mempool + Transaction Selection (`bitcoin/feemempool.js`)
- **Block selection** greedily based on ancestor fee rate.
- **Eviction**: when memory fills up, the lowest-fee packages are removed and the dynamic min-fee rises.
- **Dynamic min-relay-fee** that increases as the mempool fills (anti-spam).

## 4. RBF and CPFP (`bitcoin/feemempool.js`)
- **RBF (BIP-125)**: the replacement transaction must have both a higher absolute fee and a higher rate than all conflicting transactions.
- **CPFP**: a high-fee child pulls a low-fee parent into the block with it (based on package rate).

## 5. Compact Blocks (`bitcoin/compactblock.js`)
- Block transfer using a **six-byte shortID** instead of full transactions (BIP-152).
- Reconstructs the block from the recipient's mempool and requests only the missing transactions.
- Dramatically reduces block propagation latency (reduces orphans).

## 6. Full BIP-32/44 HD Wallet (`wallet/hd-account.js`)
- Full **account** structure: `m/44'/coin'/account'/change/index`.
- Separation of the **external (receive)** and **internal (change)** chains.
- **Discovery with gap-limit**: scans addresses up to 20 consecutive unused addresses, for full wallet recovery.
- Multi-account discovery.

## 7. Bloom Filter and SPV (`bitcoin/spv.js`)
- **Bloom filter (BIP-37)**: a light wallet sends a filter of its addresses.
- **Merkle proof (SPV)**: the node sends only the matching transactions + proof of their presence in the block; the light wallet confirms presence using the header (which is valid by PoW) without downloading the entire block.

## 8. Advanced Coin Selection (`bitcoin/coinselect.js`)
- **Branch and Bound**: finding an exact set of UTXOs with no change output (cheaper, more private).
- **Knapsack** as a fallback with change.
- **Fee-aware**: the effective value of each coin = value − (input bytes × fee rate); dust coins are removed.

---

## Testing
```bash
npx jest test/bitcoin.test.js     # 16 tests for these modules
npx jest test/network.test.js     # 11 network tests from the previous stage
```

## Note
These are **correct, functional model** implementations on the project's JSON format — they have the same Bitcoin security properties (malleability fix, witness discount, anti-spam, etc.), but do not depend on Bitcoin's exact binary serialization. To fully wire them into the consensus path (for example, actually using the witness commitment in block validation), the next step is to connect these modules to `blockchain/blockchain.js`.

*© 2026 SPN Coin Project.*
