# SPN Coin Public Testnet Setup Guide

This document turns the current node (`SPN Coin_v6`) into a **public testnet** that others
can connect to, mine on, and send transactions to. The goal is to build technical
credibility and test the network — not to hold real value.

> On a testnet no coin has value. Announce this clearly everywhere.

---

## 1. Testnet Network Settings

In `.env` on every server running a node:

```bash
NODE_ENV=production
NETWORK=testnet
HTTP_PORT=3000
JWT_SECRET=<a strong, unique random string>
ACCESS_KEY=<a strong key>
# list of seed nodes (comma-separated), filled in step 2
PEERS=
```

After the first run, the `access.lock` file is created and random usernames/passwords are
printed. Keep them safe and change them immediately.

## 2. Seed Nodes (The Backbone of the Network)

A seed node is simply an always-on node with a fixed IP/domain that new nodes connect to
in order to discover the rest. For a healthy testnet, set up at least **2 to 3** seeds,
preferably on different providers.

On each seed, run the node and list the other seeds in `PEERS`:

```bash
# seed-1
PEERS=http://seed-2.testnet.spncoin.example:3000,http://seed-3.testnet.spncoin.example:3000 npm start
```

User nodes list only one seed in `PEERS` and discover the rest automatically.
Recommendation: put each seed behind HTTPS (a reverse proxy such as Nginx/Caddy).

### Stable Operation with systemd (Example)

```ini
# /etc/systemd/system/spncoin.service
[Unit]
Description=SPN Coin testnet node
After=network.target
[Service]
WorkingDirectory=/opt/spncoin
EnvironmentFile=/opt/spncoin/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

Or use `docker/docker-compose.testnet.yml`, which is already included in the project.

## 3. Block Explorer

The project already includes a public explorer (`public/tx.html`, `public/dashboard.html`)
fed by unauthenticated endpoints:
`/api/blocks`, `/api/block/:ref`, `/api/tx/:txid`, `/api/address/:addr`, `/api/stats`.
You just need to publish one of the seeds on a public domain, for example
`https://explorer.testnet.spncoin.example`.

## 4. Faucet (Test Coin Distribution)

The faucet service in `testnet/faucet.js` is ready. This service authenticates with a node
account that has the `transact:send` permission and sends coins, with rate limiting (cooldown).

```bash
NODE_URL=http://localhost:3000 \
FAUCET_USER=<node user> \
FAUCET_PASS=<password> \
FAUCET_AMOUNT=10 \
COOLDOWN_MS=86400000 \
npm run faucet
# Simple UI at http://localhost:3010  (file testnet/faucet.html)
```

Faucet notes:
- The faucet account must have enough coin (a mining node accumulates coinbase).
- The cooldown is applied by both address and IP (in memory; for high scale use Redis
  and, behind a reverse proxy, configure `trust proxy` correctly).
- Run this service only on the testnet.

## 5. Documentation for Users (The Minimum)

Publish a short public README that includes:
- How to run a node and connect (`PEERS=<seed>`)
- The seed, explorer, and faucet address(es)
- Network parameters: `NETWORK=testnet`, chainId, PoW algorithm, block reward, halving
- How to create a wallet and mine (`npm run cli`, miner, stratum)
- An explicit notice: "Testnet coin has no value and the network may be reset."

## 6. Health and Monitoring

- Prometheus metrics are enabled at `/metrics`; stand up a simple Grafana.
- View chain height, peer count, and mempool on the dashboard.
- Have a **reset** policy for the testnet (testnets are usually reset periodically).

---

Related file: `docs/PRELAUNCH_CHECKLIST.md`.
