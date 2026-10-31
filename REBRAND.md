# Rebrand: MyCoin → SPN Coin

The entire project was changed from MyCoin (MYC) to **SPN Coin (SPN)**.

## What changed
- The coin identity in `config.js`: name → `SPN Coin`, symbol → `SPN`, website.
- **Addresses**: prefix `MYC1`/`MYCt` → `SPN1`/`SPNt`; Bech32 HRP `myc`/`tmyc` → `spn`/`tspn`.
  (example: `SPN1BL2xEkvx...`)
- All display strings, the banner, the UIs (dashboard/wallet/send/miner/explorer/…), the CLI,
  the address validation regexes, the Prometheus metric names (`spncoin_*`), the DB tables
  (`spncoin_*`), the database name, the testnet scripts, the Docker/env files, and the LICENSE.
- The token contract: `MyCoinToken` → `SpnCoinToken` (file, code and package).
- Package names: `spn-coin-node`, `spn-coin-token`.

## Verification
- ✅ Addresses are now generated and validated as `SPN1...`/`SPNt...`.
- ✅ `/api/coin-info` and `/api/stats` → name `SPN Coin`, symbol `SPN`.
- ✅ Startup banner: "SPN Coin (SPN) Full Node v6.0.0".
- ✅ `npm test` → 28 tests pass, `npm run lint` with no errors, the server boots cleanly.

## ⚠️ Important: consensus-breaking
Changing the address prefix/format invalidates the old addresses and chain data. Before
running, delete the `./data` folder so the chain is rebuilt from a fresh genesis with the SPN identity.

---

## Fixing the "identity change error" — no more manual deletion needed
Previously, changing the address prefix/format caused the old chain data (with the MYC identity) to be
incompatible with the new chain. The node now handles this **automatically**:

- At startup, a "network identity fingerprint" (`SYMBOL|prefix|format|pow|chainId`)
  is stored in the database and checked.
- If the stored data belongs to a different identity (e.g. MYC before the rebrand), the node, instead of
  raising an error, moves the old blocks to an archive table (`spncoin_blocks_legacy_<time>`) and
  empties the main table, then starts from a **fresh SPN genesis** — without losing the
  old data and without manual intervention.
- In no-database (in-memory) mode there is no stale data at all and it always starts from a
  fresh genesis.

> Correction note: this project's persistence is **database-backed (PostgreSQL)**, not the
> `./data` folder. So there is no folder to delete; just run the node.

---

## Adding 2FA (Google Authenticator) — login security
TOTP-based two-factor authentication (compatible with Google Authenticator) was added to the backend:
- The `app/totp.js` module (RFC 6238/4226, dependency-free) — verified with the official test vectors.
- The `setupTotp`/`confirmTotp`/`disableTotp`/`getTotpStatus` methods in AccessControl.
- A 2FA gate in `login` (requires a valid code when enabled; timing-safe comparison).
- Compatible with the existing 2FA UIs in `admin.html`/`dashboard.html`.
- 34 tests pass, lint with no errors.
