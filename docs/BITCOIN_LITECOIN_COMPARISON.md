# SPN Coin Compared to Bitcoin and Litecoin

An honest technical assessment after the v6 upgrades. The goal of this document is to be
transparent about what has actually become "like" Bitcoin/Litecoin and what has not yet.

## ✅ What Is Architecturally Like Bitcoin/Litecoin
- **UTXO** model (like Bitcoin).
- **Proof-of-Work** mining with a coinbase reward and **halving**.
- **Selectable PoW algorithm**: `sha256d` (Bitcoin) or `scrypt` (Litecoin) —
  in `config.js` → `BLOCKCHAIN.POW_ALGORITHM`. This is exactly Litecoin's main
  technical difference from Bitcoin.
- **Chain selection based on cumulative chainwork** — the correct Nakamoto rule
  (not "chain length"). A real security weakness was fixed.
- Difficulty adjustment over a 2016-block window, **Merkle** tree, **SHA256d** identity hash.
- Addresses: **Base58Check** and **bech32** (configurable), **secp256k1** signatures.
- **P2P** network with reorg, **mempool**, and the **Stratum** protocol for pool mining.

## ⚠️ Known Simplifications (Not Yet at Bitcoin/Litecoin Production Level)
- **Difficulty is coarse-grained**: PoW is checked by counting leading hex zeros; each step is 16×.
  Bitcoin uses a full 256-bit target (compact nBits) with fine-grained granularity.
- **No full Script language**: Bitcoin has a scripting language (P2PKH/P2SH/multisig/timelock);
  here transfers are simple.
- **No SegWit / Taproot**, no headers-first sync, no compact block relay.
- A **full HD wallet (BIP32/39/44)** is not implemented.
- Written in **Node.js** (not C++/Rust); it has performance limits for a high-traffic full node.
- **Not independently security-audited** and not battle-tested on a high-pressure public network.

## ❌ What No Code Can Create (The Most Important Part)
Bitcoin's/Litecoin's value and security come from these, not from their code:
- **Decentralized, massive hashpower** that makes a 51% attack uneconomical.
- **Network effect**: millions of users, exchanges, wallets, liquidity.
- **Years of economic security and trust** (Bitcoin since 2009, Litecoin since 2011).

> Code feature parity ≠ becoming Bitcoin/Litecoin. After v6, this project is a
> UTXO-PoW chain with correct, selectable concepts (SHA256d/Scrypt) that is excellent for
> **learning and a public testnet**; for a mainnet carrying real value, the
> `docs/PATH_A_ROADMAP.md` path (a token on an existing chain) is more realistic and safer.

## Choosing "Bitcoin-like" or "Litecoin-like"
```js
// config.js → BLOCKCHAIN
POW_ALGORITHM: 'sha256d'   // like Bitcoin
// or
POW_ALGORITHM: 'scrypt'    // like Litecoin
```
Changing this value breaks consensus: clear `./data` and, on a fresh testnet, re-mine
the genesis.

## Next Roadmap to Get Closer (If Desired)
1. A real 256-bit target + fine-grained difficulty.
2. A minimal Script language (P2PKH/multisig/timelock).
3. HD wallet (BIP32/39).
4. Headers-first sync and efficient storage.
