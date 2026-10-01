# Recruiting Your First Node Operators

The single hardest — and most important — step in turning SPN Coin from a
one-node project into a real network is getting **other people to run their own
nodes**. This is exactly the step every successful blockchain went through in its
earliest days. This guide is a practical playbook for it.

> **Honest framing.** You are recruiting people to run *software* and help an
> *educational network* — not to invest or buy anything. That framing is both
> ethical and, in most places, legally safe. Never recruit with promises of
> profit.

---

## Why this is the real milestone

A network with one node (yours) is a demo. A network with **5–10 independent
operators in different places** is a genuinely decentralized system. That
transition — not any code change — is what makes the project "real."

Independence matters more than count: 5 nodes run by 5 different people on 5
different servers is far more meaningful than 20 nodes you run yourself.

---

## Who to target (in order of likelihood)

1. **Friends & peers who code.** The easiest first operators. They trust you and
   can follow technical steps.
2. **Students / learners.** People studying blockchain want hands-on experience;
   running a node is a great learning exercise.
3. **Blockchain hobbyist communities.** Reddit (r/CryptoTechnology,
   r/BlockchainDev), Discord servers, university blockchain clubs.
4. **Open-source contributors.** People who already star/fork the repo are warm
   leads — they've shown interest.

Start with group 1. Three friends running nodes is a better foundation than a
viral post that converts no one.

---

## What you must have ready first

Operators will only join if it's **easy and trustworthy**. Before recruiting:

- [ ] Public GitHub repo (see `docs/PUBLISHING_GUIDE.md`)
- [ ] At least one stable seed node running (see `docs/VPS_SEED_NODE_GUIDE.md`)
- [ ] The one-line join command tested end-to-end:
      `bash scripts/join-network.sh http://YOUR_SEED:3000`
- [ ] A short "how to join" doc with your real seed address in it
- [ ] Honest README (no value claims)

If joining takes more than a few minutes or feels risky, people won't do it.

---

## The offer (why would anyone run a node?)

Be honest about the "why." Good, truthful reasons:

- **Learn by doing** — running a real P2P blockchain node is genuinely educational.
- **Be an early contributor** — help shape a project from its earliest days.
- **Technical interest** — it's a clean, readable Bitcoin-style implementation.

Do **not** offer: money, future value, "rewards that will be worth something,"
or anything that sounds like an investment return. Those are both dishonest here
and legally risky.

If you later add a testnet faucet or contributor recognition, those are fine
non-financial incentives.

---

## Ready-to-use recruitment messages

Adapt these; keep them honest and technical.

### For a friend (direct message)

> Hey — I built a full Bitcoin-style blockchain from scratch (Node.js, ~14k
> lines, real proof-of-work, P2P, the works). I'm standing up a small
> **educational testnet** and I'd love a few people to run their own nodes so
> it's actually decentralized. It's one command to join and takes ~5 minutes.
> No money involved — purely for learning and to help the network exist. Want to
> try it? Repo: <link>

### For a community post (Reddit / forum)

> **[Educational] Help run a from-scratch Bitcoin-style testnet**
>
> I implemented a complete UTXO + proof-of-work blockchain in Node.js
> (cumulative-work fork choice, P2P gossip, Stratum pool, ~198 tests) as a
> learning project. It's open source. I'm looking for a few people who'd enjoy
> running an independent node so the testnet is genuinely decentralized.
>
> This is **not** a coin sale or investment — there's no money involved and the
> coin has no value. It's for learning how blockchains work end to end. Join is
> one command. Repo + docs: <link>

### For a Discord / chat

> Running a small educational Bitcoin-style testnet and looking for a few people
> to run independent nodes 🙂 One command to join, ~5 min, no money involved,
> purely for learning. Repo: <link> — happy to help anyone get set up.

---

## Make onboarding frictionless

The drop-off is highest at setup. Reduce it:

- Pin a **"Join the network"** section in your README with the exact command and
  your real seed address.
- Offer to **pair with the first few operators** (screen-share, walk them
  through it). Early hand-holding pays off.
- Have a place for questions (GitHub Discussions or a chat channel).
- When someone joins, **acknowledge them** — thank them, list them in a
  CONTRIBUTORS or NETWORK file. Recognition is a real, honest incentive.

---

## Watch the network grow

Use the built-in monitor to see all nodes, their sync status, and overall
network health at a glance:

```bash
# check specific nodes
node scripts/network-monitor.js http://seed1:3000 http://seed2:3000

# or list them in a file (copy scripts/nodes.example.txt to nodes.txt)
node scripts/network-monitor.js --file nodes.txt

# live refreshing dashboard
node scripts/network-monitor.js --watch --file nodes.txt
```

It flags nodes that are down or out of sync, and tells you honestly whether the
network is still a single node or genuinely decentralized. Sharing a screenshot
of a growing network is also a great, honest way to motivate new operators.

## Keep operators around

Recruiting is half the job; retention is the other half.

- Keep your seed node **stable** — if it goes down, others can't sync and lose
  interest.
- Post occasional updates (new features, network stats).
- Respond quickly when operators hit issues.
- Celebrate milestones ("we have 5 independent nodes across 3 countries").

---

## Realistic expectations

- Your first 2–3 operators will likely be people you know personally.
- Growth is slow and word-of-mouth at first — that's normal and healthy.
- A stable 5–10 node educational network is a real achievement and a strong
  portfolio signal on its own.
- This takes **weeks to months**, not days. Every real network went through
  exactly this slow start.

---

## Milestone checklist

- [ ] 1 stable seed node (you)
- [ ] 1st independent operator (a friend)
- [ ] 3 independent operators
- [ ] Operators in more than one geographic location
- [ ] 5+ independent operators
- [ ] A documented, repeatable join process others use without your help

Hitting the last box means you've built something that can grow without you in
the loop — the real definition of a decentralized network.

---

*This is an educational network. Recruit operators honestly, for learning and
contribution — never with financial promises.*
