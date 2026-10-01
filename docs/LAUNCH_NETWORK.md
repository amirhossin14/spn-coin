# Launching a Real SPN Coin Network

This is the practical, step-by-step guide to going from "code on my laptop"
to "a live network other people help run." The code is ready; this is mostly
about **infrastructure and people**, which takes time — plan in weeks/months,
not hours.

> **Honest note:** a working network needs *independent* operators. Running
> many nodes yourself doesn't make it decentralized — it's still one party.
> Real security and value come from other people choosing to run nodes.

---

## Phase 1 — Stand up the first seed node (you)

A seed node is the always-on entry point new peers connect to.

1. Get a cheap VPS with a static public IP (DigitalOcean, Hetzner, Vultr — a
   $5/month box is plenty for testnet).
2. Copy the project to it, then run:
   ```bash
   bash scripts/setup-seed-node.sh
   ```
   This installs deps, generates secrets, and writes `.env`.
3. Keep it running across reboots:
   ```bash
   npm install -g pm2
   pm2 start server.js --name spn-seed
   pm2 startup && pm2 save
   ```
4. Open the port: `sudo ufw allow 3000/tcp`
5. (Recommended) Put a domain + HTTPS in front with Caddy:
   ```
   seed1.yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```

You now have a public URL like `https://seed1.yourdomain.com`. This is what
you share with everyone else.

---

## Phase 2 — Make it easy for others to join

1. **Publish the code on GitHub** (public repo). People won't run software
   they can't inspect. Replace every `OWNER/REPO` placeholder first:
   ```bash
   grep -rl 'OWNER/REPO' . --include='*.md' --include='*.txt'
   ```
2. Write clear join instructions in your README pointing to:
   ```bash
   bash scripts/join-network.sh https://seed1.yourdomain.com
   ```
3. Register 2–3 DNS seed hostnames (optional but professional) and set them
   in each node's `.env`:
   ```
   DNS_SEEDS=seed1.yourdomain.com,seed2.yourdomain.com
   ```

---

## Phase 3 — Recruit independent operators

This is the part no code can do for you. A network is only decentralized when
*other people* run nodes.

- Share the project where blockchain hobbyists gather (forums, Discord/Matrix,
  university CS clubs, r/cryptodevs-style communities).
- Emphasize it's an **educational testnet** — honest framing attracts the
  right people and avoids "get-rich" expectations.
- Help early operators personally; the first 5–10 independent nodes are the
  hardest and the most important.
- Aim for operators in **different locations and different owners**. Ten nodes
  owned by ten people beat a hundred owned by you.

---

## Phase 4 — Keep the network healthy

- Run **more than one** seed node (ask a trusted operator to run a second),
  so the network survives if yours goes down.
- Monitor with the built-in tools: `/api/peers`, `/api/p2p/status`,
  `/metrics` (Prometheus), and the Monitor page.
- Publish chain checkpoints occasionally so new nodes can trust their sync.
- Keep dependencies patched: `npm audit` (CI already enforces this).

---

## What "done" looks like

- Several seed nodes run by different people
- New nodes can join with one command and sync the full chain
- The chain keeps advancing even if any single node (including yours) is off
- A small community that inspects the code and reports issues

At that point you have a genuinely distributed educational network — the thing
that code alone can't create.

---

## Reality check on "value"

Even a healthy testnet is **educational** — it has no monetary value, and that
is the correct, honest framing. Turning a network into something with real
economic value would additionally require exchanges, liquidity, legal
compliance, and broad voluntary adoption. Those are large, mostly non-technical
undertakings and carry real legal risk (securities law). Keep SPN framed as the
impressive *technical* achievement it is.
