# Publishing to GitHub & Building a Community

A practical, step-by-step guide to open-sourcing SPN Coin and growing a small
community of learners and contributors around it.

> **Framing:** This guide treats SPN Coin as an **educational open-source
> project** and a **portfolio piece** — not a financial product. That framing is
> also what makes a project welcoming to contributors and safe to promote.

---

## Part 1 — Prepare the repository

### 1.1 Before the first push

- [ ] **Run the automated safety check:** `bash scripts/prepublish-check.sh`
      — it verifies no secrets will be committed and flags placeholders.
- [ ] Confirm no secrets are committed. `access.lock`, `certs/*.pem`, `.env`,
      and `data/` are already git-ignored — verify with `git status`.
- [ ] Rotate the default admin/miner/viewer credentials; never commit real ones.
- [ ] Replace placeholder values:
  - `OWNER/REPO` in `README.md` badges → your GitHub `user/repo`
  - `seed1.spncoin.example` in DNS-seed config → real hostnames (only when you
    actually run seed nodes)
- [ ] Read `WHITEPAPER.md` and the README disclaimer and make sure you're
      comfortable that they describe the project honestly.

### 1.2 Files that make a repo look professional

You already have most of these:

| File | Purpose | Status |
|------|---------|--------|
| `README.md` | First impression, quick start | ✅ present |
| `WHITEPAPER.md` | Technical design + honest limitations | ✅ present |
| `LICENSE` | Legal terms of use | ✅ present |
| `CONTRIBUTING.md` | How to contribute | ✅ present |
| `CODE_OF_CONDUCT.md` | Community rules | ✅ present |
| `SECURITY.md` | How to report vulnerabilities | ✅ present |
| `.github/ISSUE_TEMPLATE/` | Structured bug reports | ✅ present |
| `.github/workflows/` | CI/CD (tests, CodeQL) | ✅ present |

---

## Part 2 — Publish

### 2.1 Create the repository

1. Create a new **public** repository on GitHub (e.g. `spn-coin`).
2. Do **not** initialize it with a README (you already have one).

### 2.2 Push the code

```bash
cd SPN_Coin
git init
git add .
git commit -m "Initial public release — educational Bitcoin-style blockchain"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/spn-coin.git
git push -u origin main
```

### 2.3 Configure the repository

- **About panel:** add a one-line description and topics:
  `blockchain`, `bitcoin`, `cryptocurrency`, `nodejs`, `proof-of-work`,
  `educational`, `utxo`, `p2p`.
- **Enable:** Issues, Discussions (Settings → Features).
- **Branch protection:** require CI to pass before merging to `main`.
- **Pin** the repository on your profile so visitors see it first.

---

## Part 3 — Make it easy to run

The single biggest driver of adoption is *how fast a stranger can get it
running*. Aim for "clone → one command → it works."

- [ ] Verify the quick-start in `README.md` works on a clean machine.
- [ ] Confirm `docker-compose up` works (you ship a `Dockerfile` and
      `docker-compose.yml`).
- [ ] Add a short **"Run in 60 seconds"** section near the top of the README.
- [ ] Record a short GIF or screenshot of the dashboard/explorer — visuals
      dramatically increase engagement.

---

## Part 4 — Build a community

Communities grow from *usefulness* and *responsiveness*, not promotion.

### 4.1 Give people a place to talk

- Enable **GitHub Discussions** for Q&A and ideas.
- Optionally create a chat (Discord/Matrix/Telegram) once there's demand — don't
  create empty channels early; they look abandoned.

### 4.2 Make the first contribution easy

- Label a handful of small, well-scoped issues as `good first issue`.
- Write a clear `CONTRIBUTING.md` path: setup → run tests → open a PR.
- Respond to issues and PRs quickly and kindly, even if the answer is "not yet."

### 4.3 Share where developers actually are

Honest, technical framing works best:

- A write-up of *how you built it* (dev.to, Hashnode, your blog) — the
  engineering story is genuinely interesting.
- Relevant subreddits (e.g. r/programming, r/learnprogramming) — as a
  learning/engineering post, **not** as a coin promotion.
- Hacker News "Show HN" — again, as an educational project.

> ⚠️ Do **not** market SPN as an investment, a token sale, or a way to make
> money. That is both against this project's values and, depending on your
> jurisdiction, potentially illegal. Promote it as *software and learning*.

### 4.4 Set up an educational testnet (optional, powerful)

If you want a living network without any financial dimension:

- Follow `docs/SEED_NODE.md` / `scripts/setup-seed-node.sh` to run a seed node.
- Invite a few independent people to run their own nodes and connect.
- Document the join process (`scripts/join-network.sh`) clearly.

A small, honest, working testnet with a handful of real operators is a far
stronger portfolio signal than any claim of value.

---

## Part 5 — Use it to open doors

For a solo developer, the highest-value outcome of this project is usually
**career opportunity**, not a coin.

- Link the repo prominently in your CV and portfolio.
- In interviews, walk through a real subsystem — consensus, the UTXO set, the
  P2P layer, or the security middleware. Depth here is impressive.
- Write about specific engineering challenges you solved (fork choice, fee
  model, IDS/IPS design). This demonstrates senior-level thinking.

---

## Checklist summary

- [ ] Secrets removed, credentials rotated, placeholders replaced
- [ ] Public repo created and code pushed
- [ ] Topics, description, Issues & Discussions enabled
- [ ] Quick-start verified on a clean machine + screenshot/GIF added
- [ ] A few `good first issue`s labeled
- [ ] Honest, engineering-focused write-up published
- [ ] (Optional) educational testnet with independent operators
- [ ] Repo linked from CV/portfolio

---

*Reminder: SPN Coin is an educational project with no monetary value. Everything
in this guide assumes honest, non-financial framing.*
