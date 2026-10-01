<div align="center">

# 🪙 SPN Coin

**A Bitcoin-inspired blockchain built from scratch in Node.js**

Fair launch · Zero premine · UTXO model · Real 256-bit Proof-of-Work · Stratum mining pool · secp256k1

[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#testing)
[![License](https://img.shields.io/badge/license-source--available-orange)](./LICENSE)
[![CI](https://github.com/amirhossin14/spn-coin/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![CodeQL](https://github.com/amirhossin14/spn-coin/actions/workflows/codeql.yml/badge.svg)](../../actions/workflows/codeql.yml)

</div>

---

> ⚠️ **Disclaimer — please read.**
> SPN Coin is an **educational / experimental blockchain**. The SPN coin has
> **no monetary value** and is **not** an investment. There is no real
> distributed network yet, no audited security for handling real money, and
> no compatibility with Bitcoin, Ethereum, or any production chain. Do **not**
> use it to store, send, or receive real funds. See [DISCLAIMER.md](./DISCLAIMER.md).

---

## 📄 Documentation

- **[WHITEPAPER.md](./WHITEPAPER.md)** — technical design & honest assessment
- **[docs/PUBLISHING_GUIDE.md](./docs/PUBLISHING_GUIDE.md)** — how to open-source this & build a community
- **[docs/VPS_SEED_NODE_GUIDE.md](./docs/VPS_SEED_NODE_GUIDE.md)** — run a real always-on seed node
- **[docs/RECRUITING_OPERATORS.md](./docs/RECRUITING_OPERATORS.md)** — grow from one node to a network
- **[NETWORK.md](./NETWORK.md)** — join the network / operator registry
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — how to contribute
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — community standards
- **[SECURITY.md](./SECURITY.md)** — reporting vulnerabilities



## What is this?

SPN Coin is a complete, working implementation of a Bitcoin-style cryptocurrency
written entirely in Node.js — built to **learn and demonstrate** how blockchains
actually work. Every core mechanism is implemented honestly, not faked:

- **UTXO ledger** — unspent-transaction-output model, like Bitcoin
- **Real Proof-of-Work** — full 256-bit integer targets (not "count the zeros")
- **Cumulative-work fork choice** — most-work chain wins (correct Nakamoto rule)
- **Median-Time-Past** — BIP-113 timestamp rule prevents manipulation
- **secp256k1 + Base58Check** — real ECDSA keys and `SPN1…` addresses
- **Fair launch — zero premine** — no founder allocation; every coin is mined from block 1
- **Stratum mining pool** — Vardiff, PPLNS, over WebSocket
- **P2P gossip network** — block & transaction propagation, chain sync
- **Script system** — P2PKH, m-of-n multisig, timelocks

## Quick start

```bash
# Requires Node.js >= 20
npm install
npm start            # dashboard at http://localhost:3000
```

```bash
npm run testnet      # local 3-node network
npm run monitor      # live network dashboard (CLI)
npm test             # run the test suite
```

## Coin parameters

| Parameter | Value |
|---|---|
| Symbol | `SPN` |
| Decimals | 8 |
| Address prefix | `SPN1…` (mainnet), `SPNt…` (testnet) |
| PoW algorithm | SHA-256d |
| Target block time | 10 minutes |
| Difficulty retarget | every 2,016 blocks |
| Block reward | 50 SPN |
| Halving interval | every 210,000 blocks |
| Max supply | 21,000,000 SPN |

## Architecture

```
blockchain/   core: blocks, PoW, crypto (secp256k1), script engine
utxo/         UTXO set, transactions, validation
mempool/      fee-priority transaction pool
mining-pool/  Stratum server (WebSocket)
p2p/          HTTP gossip network + chain sync
wallet/       key management, transaction building
app/          access control, classroom (educational mode)
middleware/   security, JWT, rate limiting
monitoring/   metrics
db/           PostgreSQL persistence (optional)
public/       web UI (dashboard, explorer, wallet, miner)
testnet/      3-node launcher + faucet
tools/        network monitor, vanity address generator
```

## Running on a public testnet

See **[docs/PUBLIC_TESTNET.md](./docs/PUBLIC_TESTNET.md)** for the full path from
a single node to a real network, and **[docs/SEED_NODE.md](./docs/SEED_NODE.md)**
to run a seed node.

```bash
./join-testnet.sh https://seed1.example.org
```

## Documentation

| Doc | Description |
|---|---|
| [DEVELOPERS.md](./docs/DEVELOPERS.md) | Architecture deep-dive for contributors |
| [PUBLIC_TESTNET.md](./docs/PUBLIC_TESTNET.md) | Launching a real testnet |
| [SEED_NODE.md](./docs/SEED_NODE.md) | Running a seed node |
| [ADDRESS_GUIDE.md](./docs/ADDRESS_GUIDE.md) | Address format & derivation |
| [SCRIPT_GUIDE.md](./docs/SCRIPT_GUIDE.md) | The script/opcode system |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to contribute |

## Testing

```bash
npm test
```

Covers PoW correctness, address generation & checksums, ECDSA signatures,
mining, cumulative-work fork choice, median-time-past, and chain validation
(including tamper detection), using Node's built-in test runner.

## License

**Source-available, not open source.** You may read, study, and audit this code, run a node,
and mine on the official SPN Coin network. You may **not** use this code to launch a separate or
competing blockchain or token. See [LICENSE](./LICENSE) for the full terms. The names "SPN Coin"
and "Sepanta" and associated logos are reserved. Third-party bundled components keep their own
licenses — see [NOTICE](./NOTICE).

© 2026 SPN Coin Project.
