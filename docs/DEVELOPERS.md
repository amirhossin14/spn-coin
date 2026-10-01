# Developer Guide

A deep-dive into SPN Coin's architecture for contributors.

## Module map

| Module | Responsibility |
|---|---|
| `blockchain/crypto.js` | SHA-256d, secp256k1 keys, addresses, 256-bit PoW targets, work calc |
| `blockchain/block.js` | Block structure, header serialization, mining |
| `blockchain/blockchain.js` | Chain state, validation, fork choice, difficulty, MTP |
| `blockchain/script.js` | Script engine (P2PKH, multisig, timelocks) |
| `utxo/utxo.js` | UTXO set, Transaction class, input/output validation |
| `mempool/mempool.js` | Pending tx pool with fee-rate priority & eviction |
| `mining-pool/stratum-ws.js` | Stratum protocol over WebSocket (Vardiff, PPLNS) |
| `p2p/p2p-http.js` | HTTP gossip: block/tx propagation, chain sync |
| `wallet/wallet.js` | Key storage, transaction construction & signing |

## Consensus rules (critical)

1. **Proof of Work** — a block hash, interpreted as a 256-bit integer, must be
   `<= target`. `target = BASE_TARGET / difficulty`. See `crypto.meetsTarget`.

2. **Fork choice** — the chain with the highest **cumulative work** wins, where
   `work(block) = 2^256 / (target + 1)`. Never use chain length. See
   `Blockchain.chainWork()` and `replaceChain()`.

3. **Median-Time-Past** — a block's timestamp must be greater than the median
   of the last 11 block timestamps (BIP-113). See `getMedianTimePast()`.

4. **Difficulty retarget** — every 2,016 blocks, adjusted by the ratio of
   actual vs expected time. See `getNextDifficulty()`.

5. **Block subsidy** — starts at 50 SPN, halves every 210,000 blocks. The miner
   collects `subsidy + sum(tx fees)`.

## Transaction lifecycle

```
wallet.createTransaction()
  → signs inputs with secp256k1
  → mempool.addTransaction()  (validates, checks fee rate)
  → P2P broadcast to peers
  → miner includes it in a candidate block
  → block mined & validated → UTXO set updated
```

## Adding a feature safely

- Anything touching `blockchain/` is consensus-critical. Add tests in
  `test/blockchain.test.js` that prove validation still works and tampering is
  still detected.
- Run `npm test` before and after.
- Keep runtime dependencies minimal.

## Network IDs

| CHAIN_ID | Network | PoW target |
|---|---|---|
| 1 | mainnet | hard (`MAX_TARGET`) — real security |
| 3 | testnet | easy — blocks mine in ms |

## API surface (selected)

| Endpoint | Purpose |
|---|---|
| `GET /api/stats` | chain height, difficulty, peers, mempool |
| `GET /api/blocks` | paginated block list |
| `GET /api/tx/:txid` | transaction lookup |
| `POST /api/transact` | build & broadcast a transaction (auth) |
| `GET /api/p2p/status` | node id, height, peers |
| `POST /api/p2p/message` | inbound gossip (blocks/txs) |
