# SPN Coin — Technical Whitepaper

**Version 1.0 · 2026**
**An educational, Bitcoin-inspired blockchain implemented from scratch in Node.js**

---

## Important Notice

This whitepaper describes an **educational and experimental** blockchain
implementation. It is written to be **technically accurate and honest**. Please
read the following before continuing:

- **SPN Coin has no monetary value.** It is not a currency, security, or
  investment product, and it is not offered for sale.
- **There is no live, distributed network.** The software is complete, but it
  has not been deployed as a public multi-node network.
- **No promises of profit or returns are made anywhere in this document.**
- This paper describes *how the software works*, not a financial opportunity.

If you are evaluating SPN Coin, evaluate it as a **software engineering project**
and a **learning tool** — which is what it is.

---

## Abstract

SPN Coin is a complete, working implementation of a Bitcoin-style cryptocurrency
written entirely in Node.js. It was built to demonstrate — honestly and without
shortcuts — how the core mechanisms of a proof-of-work blockchain actually work:
the UTXO ledger, real 256-bit proof-of-work, cumulative-work fork choice,
peer-to-peer gossip networking, a Stratum mining pool, and a token layer for
issuing assets on top of the base chain.

This document explains the design and the reasoning behind each component, and
is deliberately transparent about the project's limitations.

---

## 1. Introduction

### 1.1 Motivation

Most people who use cryptocurrencies never see how they work internally. Many
"educational" blockchain projects fake the hard parts — using a difficulty rule
that just counts leading zeros, skipping real fork choice, or omitting a genuine
P2P layer. SPN Coin was built to avoid those shortcuts and implement each
mechanism the way a production chain would, so that the code itself is a
faithful teaching reference.

### 1.2 What SPN Coin is — and is not

**It is:** a faithful, from-scratch implementation of Bitcoin-style consensus
and networking, with a modern web interface, a token layer, and production-grade
software engineering practices (tests, CI/CD, security hardening).

**It is not:** a live cryptocurrency, a financial product, or a network with
real economic value. It has one primary node (the author's) and no deployed
distributed network.

---

## 2. System Architecture

SPN Coin is organized into clearly separated layers:

### 2.1 Consensus layer

- **Proof-of-Work.** Full 256-bit integer targets (not a "count the zeros"
  approximation). Block validity requires the block hash to be numerically below
  the current target.
- **Cumulative-work fork choice.** The chain with the most total work wins — the
  correct Nakamoto consensus rule — rather than simply the longest chain.
- **Median-Time-Past (BIP-113).** Block timestamps are validated against the
  median of recent blocks, preventing timestamp manipulation.
- **Difficulty retargeting.** The difficulty adjusts to keep block production
  near the target interval.

### 2.2 Ledger layer

- **UTXO model.** Balances are represented as unspent transaction outputs,
  exactly like Bitcoin, rather than account balances.
- **secp256k1 signatures.** Real ECDSA cryptography for transaction signing and
  verification.
- **Base58Check addresses.** Human-facing addresses use the `SPN1…` prefix
  (mainnet) and `SPNt…` (testnet), derived from HASH160 of the public key.

### 2.3 Network layer

- **P2P gossip.** Blocks and transactions propagate between nodes; nodes sync
  the chain from peers.
- **Peer management.** Address manager, reputation scoring, and DNS-seed-based
  discovery, following patterns from Bitcoin Core.

### 2.4 Application layer

- **Stratum mining pool** (Vardiff, PPLNS) over WebSocket.
- **Token layer** for issuing assets on top of the base chain, with a shared
  transport model comparable to ERC-20 / TRC-20.
- **REST + WebSocket APIs**, a block explorer, wallet, and dashboards.

---

## 3. Monetary Policy (Simulated)

> These parameters mirror Bitcoin's design for educational fidelity. Because SPN
> has no market and no value, they are a **simulation** of monetary policy, not
> an economic claim.

| Parameter            | Value                                   |
|----------------------|-----------------------------------------|
| Ticker               | SPN                                     |
| Smallest unit        | 1 satoshi = 10⁻⁸ SPN                     |
| Initial block reward | 50 SPN                                   |
| Halving interval     | 210,000 blocks                          |
| Target block time    | 10 minutes                              |
| Maximum supply       | 21,000,000 SPN (asymptotic)             |
| Consensus            | SHA-256d Proof-of-Work                   |
| Minimum fee          | 1,000 satoshi (0.00001 SPN)             |
| Fee model            | Size-based, ~10 satoshi/byte            |

The block reward halves every 210,000 blocks, so the total supply approaches but
never exceeds 21,000,000 SPN — the same emission curve as Bitcoin.

---

## 4. Token Layer

SPN Coin includes a layer for issuing custom tokens on top of the base chain.

- **Shared transport.** Token operations are carried inside base-chain
  transactions (like ERC-20 on Ethereum or TRC-20 on TRON), so tokens inherit
  the security of the base chain rather than running a separate network.
- **Per-token contract identity.** Each token receives a deterministic,
  forge-proof identity (contract address, contract ID, fingerprint, checksum)
  derived from its immutable fields.
- **Rich metadata.** Logo, description, and verified social links, stored
  on-chain with the token.
- **Operations.** Issue, mint (if mintable), transfer, burn, freeze/unfreeze,
  and metadata updates — each authorized by the issuer's signature.

---

## 5. Security

SPN Coin applies production-grade security engineering:

- **Transport:** TLS, security headers, CSRF protection.
- **Application:** rate limiting, a DDoS guard (per-IP caps, burst auto-ban,
  global shedding), and an IDS/IPS signature engine that inspects requests for
  SQLi, XSS, path traversal, command injection, and scanner tools.
- **Access control:** role-based access control (RBAC) for node administration,
  with scrypt-hashed credentials, AES-256-GCM encryption, TOTP two-factor
  authentication, and login lockout.
- **Assurance:** 198 automated tests, CI/CD with CodeQL scanning, and a
  documented dependency-security process.

Note the deliberate two-layer design: the **chain** is permissionless (anyone
with a valid key and signature can transact, like Bitcoin), while the **node
admin panel** uses RBAC (like any professional server application). RBAC governs
who can operate *a node*, not who can use *the chain*.

---

## 6. Limitations and Honest Assessment

This section is intentionally candid.

- **No live network.** SPN runs as a single node. A real blockchain derives its
  security and value from a large, independent, distributed set of nodes and
  hash power. SPN has neither yet.
- **No economic value.** There is no market, liquidity, exchange listing, or
  community of users. The coin cannot be bought, sold, or exchanged for anything.
- **Not audited for real funds.** While the code applies strong security
  practices, it has not undergone the independent, professional security audits
  that handling real money would require.
- **Single-author project.** Building a real, valuable cryptocurrency requires a
  distributed network, an active community, liquidity, legal structure, and
  years of trust-building — none of which can be produced by code alone.

These are not flaws in the implementation; they are the difference between
*blockchain software* and a *live cryptocurrency network*.

---

## 7. What SPN Coin Is Good For

- **Learning:** a faithful, readable reference for how a Bitcoin-style chain
  works end to end.
- **Teaching:** a basis for an educational testnet for a small community.
- **Demonstration:** a portfolio-grade example of full-stack and systems
  engineering — consensus, cryptography, networking, security, and UI.

---

## 8. Roadmap (Non-Financial)

The roadmap is expressed in terms of **software and community**, not price or
markets:

1. **Public release.** Open-source the project and publish clear documentation.
2. **Educational testnet.** Stand up a small multi-node testnet with independent
   operators, for learning and experimentation.
3. **Community.** Grow a group of contributors and learners around the codebase.
4. **Continued engineering.** Optional protocol features (e.g. on-chain
   governance), performance work, and additional documentation.

There is deliberately **no token sale, fundraising, or profit mechanism** in
this roadmap.

---

## 9. Conclusion

SPN Coin demonstrates that the core machinery of a Bitcoin-style blockchain —
proof-of-work, UTXO accounting, cumulative-work consensus, P2P networking, and a
token layer — can be implemented faithfully and completely in Node.js, with
professional software-engineering practices around it. It is offered as an
**educational and portfolio project**, described honestly, with no claims of
monetary value.

---

*This document is for educational and informational purposes only. It is not
financial, investment, or legal advice, and it is not an offer to sell or
solicit any asset. SPN Coin has no monetary value.*
