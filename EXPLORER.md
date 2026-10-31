# The Assay — SPN Coin Explorer

An explorer dashboard for your own blockchain (not a TronScan clone) with a completely distinct visual
identity: **"Mint / Certificate of Purity" (Assay)** — a deep petroleum background, a golden brass
accent (because it is a "coin"), certificate-like typography (Fraunces serif + JetBrains mono for
data), and a **mint seal** engraved with a guilloché motif that shows the current block
height like a coin die.

## Access
After running the node:
```
http://localhost:3000/explorer        (or /explorer.html)
```
File: `public/explorer.html` (the node itself serves it; no build is needed).

## Connected to your blockchain
All data comes from your own node's public APIs and refreshes every 12 seconds:
- `/api/health`, `/api/stats`, `/api/coin-info`
- `/api/blocks`, `/api/block/:ref`, `/api/tx/:txid`, `/api/address/:addr`, `/api/search/:q`

## What it shows
- A live block-height seal + network status (mainnet/testnet, health, peers).
- Circulating supply (accounting for halving), difficulty + bits, **PoW algorithm** (sha256d/scrypt),
  block reward, mempool size, peers.
- Latest blocks and latest transactions (mint/transfer), clickable for details.
- A "block tempo" chart (transactions per block) drawn with hand-made SVG (no library).
- Search by height/block hash/txid/address with an in-page detail card.

## Side additions
- The `/api/stats` endpoint now also returns `powAlgorithm`.
- A clean `/explorer` route was added.

It is read-only and holds no keys.
