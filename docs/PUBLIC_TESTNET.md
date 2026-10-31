# Launching a Public Testnet

This document explains the real path for turning SPN Coin from "a single node on a single server" into "a genuinely decentralized network." This is the first essential step for any serious cryptocurrency.

> ⚠️ Honestly: this path takes months to years and requires a real community. There are no shortcuts. The goal here is to build a transparent testnet, not to promise financial value.

---

## Step 1 — Setting Up a Seed Node

A decentralized network needs a "starting point" that new nodes can connect to. This is called a "seed node."

### On the first server (seed):
```bash
# .env
NODE_ENV=production
PORT=3000
CHAIN_ID=3                 # 3 = testnet
JWT_SECRET=<random>
JWT_REFRESH_SECRET=<random>
NODE_SECRET=<shared-secret>   # all testnet nodes share the same value
PEER_URLS=                 # the seed itself has no peers; others connect to it
```

```bash
pm2 start server.js --name spncoin-seed
```

This server must stay **always on** and have a fixed domain:
`https://seed1.spncoin-testnet.org` (example)

---

## Step 1.5 — Local Network Testing (before the public launch)

Before asking others to run a node, test the network on your own computer with 3 nodes. The tool is already available:

```bash
node testnet/launch.js
```

This command brings up 3 nodes simultaneously that sync with each other:
- node1: http://localhost:3100
- node2: http://localhost:3200
- node3: http://localhost:3300

Every 15 seconds the status of all nodes (height, difficulty, mempool) is printed. If all three reach the same height, the network is syncing correctly. ✅

This is the best way to confirm P2P health **before** inviting the community.

---

## Step 2 — Documentation for the Community

For others to run a node, they need to know how. Create a public GitHub repository with:

- The complete code (this project)
- A simple installation guide
- The address(es) of the official seed node(s)
- A clear statement: "This is an experimental testnet; SPN has no financial value"

---

## Step 3 — The Second and Third Nodes (by others)

Anyone who wants to join the network:
```bash
# their .env
CHAIN_ID=3
NODE_SECRET=<same-shared-secret>
PEER_URLS=https://seed1.spncoin-testnet.org
```

When the node comes up:
1. It connects to the seed
2. It syncs the list of blocks
3. It itself becomes a connectable peer

The more independent nodes there are, the more decentralized the network becomes.

---

## Step 4 — Independent Miners

As long as only you mine, the network is not truly decentralized. Other people must also mine with their own hardware:

```bash
# connecting a miner to a node
# see the full guide at the /miner.html page
ws://NODE_ADDRESS/stratum
```

---

## Step 4.5 — Setting Up a Faucet (testnet tap)

For people to be able to test SPN Coin, they need testnet coins. A "faucet" is a service that hands out testnet coins for free and in limited amounts. The tool is already available (`testnet/faucet.js` + `testnet/faucet.html`).

### Run:
```bash
# create an account with the transact:send permission on the node (from the admin panel)
NODE_URL=http://localhost:3000 \
FAUCET_USER=faucet-account \
FAUCET_PASS=its-password \
FAUCET_AMOUNT=10 \
node testnet/faucet.js
```

The faucet then comes up at `http://localhost:3010`. Each user can enter their testnet address and receive 10 test SPN (with a 24-hour cooldown per address and IP — anti-abuse).

> 💡 The faucet does not hold the private key itself. It only requests a send from the node's funded wallet through the node's API — a secure architecture.

### Important Note
The faucet page explicitly states: "Testnet coins have no financial value." Always keep this honesty.

---

## Step 5 — Readiness Criteria for Mainnet

Do not go to mainnet unless:

- [ ] At least 10–20 independent nodes (not on your servers) are active
- [ ] Several independent miners are mining with real hashrate
- [ ] The testnet has run for several months without a security incident
- [ ] A real community (GitHub, Discord) is active
- [ ] The code has been reviewed by independent people

---

## Step 6 — Mainnet (only after all of the above)

```bash
CHAIN_ID=1   # mainnet — real, hard PoW
```

On mainnet, the difficulty is real and security comes from collective hashrate.

---

## Important Legal Warnings

- In Iran and most countries, **selling or offering a token with a promise of profit = unlicensed securities = a crime**. Never sell SPN with a promise of price appreciation.
- Always present this project as **experimental and educational**.
- Have no hidden pre-mine — full transparency.
- Consult a lawyer before any commercial action.

---

## Reality

### Tools Ready in This Project

| Tool | File | Purpose |
|---|---|---|
| 3-node launcher | `testnet/launch.js` | Local multi-node network testing |
| Faucet (tap) | `testnet/faucet.js` | Distributing testnet coins |
| Faucet interface | `testnet/faucet.html` | Web page for requesting coins |
| Join script | `join-testnet.sh` | One-command node setup |

---

The value of a cryptocurrency comes from its **network and community**, not its code. The code (which you have) is only 5% of the work. The other 95% is building the community, trust, and a real network, which takes years and has no guarantee.
