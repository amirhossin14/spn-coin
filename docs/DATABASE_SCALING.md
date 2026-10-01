# Database Scaling Guide — Sepanta (SPN)

This guide explains, in order of when you actually need them, how to keep the
Postgres database fast as the chain grows. Do the cheap things first; only
reach for partitioning and sharding when real data volume demands it.

## 0. Where you are now

The schema already has the indexes that matter for a growing chain:

- `transactions`: `(from_addr, ts DESC)`, `(to_addr, ts DESC)`, `status`, `ts`
- `blocks`: `hash`, `miner`, `timestamp DESC`, `prev_hash`

These make the explorer and wallet queries fast well into the tens of millions
of rows on a single node. Set a strong `DB_PASSWORD` in the environment (the
app no longer ships a weak default) and you have a solid production baseline.

## 1. Keep statistics fresh (always)

Run `ANALYZE` periodically so the query planner picks good plans. The helper
`db/optimize.js` exposes `analyze()`; call it from a scheduled job (e.g. hourly):

```js
const { analyze } = require('./db/optimize');
setInterval(() => analyze().catch(() => {}), 60 * 60 * 1000);
```

You can also inspect growth with `tableStats()` and find unused indexes with
`indexUsage()` (zero-scan indexes on big tables are candidates to drop).

## 2. Time-based partitioning (~10–50M rows)

`transactions` and `access_logs` are append-only and grow forever, which makes
them the first tables to partition. Partition by month on the timestamp column
so old months can be archived or detached cheaply, and so queries that filter by
date only scan the relevant partitions.

Example: convert `transactions` to a partitioned table (do this during a
maintenance window; migrate existing rows into the first partition):

```sql
-- 1. New partitioned parent
CREATE TABLE transactions_p (
    id          VARCHAR(128) NOT NULL,
    block_hash  VARCHAR(128),
    from_addr   VARCHAR(128),
    to_addr     VARCHAR(128),
    amount      BIGINT,
    fee         BIGINT DEFAULT 0,
    signature   TEXT,
    status      VARCHAR(20) DEFAULT 'confirmed',
    ts          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- 2. Monthly partitions (create ahead of time, e.g. with a cron job)
CREATE TABLE transactions_2026_01 PARTITION OF transactions_p
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE transactions_2026_02 PARTITION OF transactions_p
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- 3. Re-create the same indexes on the parent (they cascade to partitions)
CREATE INDEX ON transactions_p (from_addr, ts DESC);
CREATE INDEX ON transactions_p (to_addr,   ts DESC);
CREATE INDEX ON transactions_p (status);

-- 4. Copy old data, then swap names
INSERT INTO transactions_p SELECT * FROM transactions;
ALTER TABLE transactions        RENAME TO transactions_old;
ALTER TABLE transactions_p      RENAME TO transactions;
```

Automate partition creation: a small monthly job that runs
`CREATE TABLE ... PARTITION OF ...` for next month keeps you ahead of inserts.

Archiving old data becomes a cheap metadata operation:

```sql
ALTER TABLE transactions DETACH PARTITION transactions_2026_01;
-- then dump/compress/drop transactions_2026_01 at your leisure
```

## 3. Read replica (heavy explorer traffic)

The explorer is read-heavy. Add a streaming read replica and point read-only
queries (block/tx lookups, address history) at it, keeping the primary for
writes (new blocks/txs). This scales reads without touching the schema.

## 4. Horizontal sharding (rarely needed)

Only if a single primary can no longer keep up with writes. For a UTXO chain,
the natural shard key is an **address prefix** (e.g. first byte of `from_addr`),
splitting `transactions` across N databases. This adds cross-shard query
complexity (address history for a counterparty may span shards) and an
application-level router, so treat it as a last resort after partitioning and
replicas. Most chains of this size never need it.

## Quick checklist

- [ ] `DB_PASSWORD` set to a strong secret in the environment
- [ ] `ANALYZE` scheduled (via `db/optimize.js`)
- [ ] Composite indexes present (shipped in `db/database.js`)
- [ ] Partition `transactions` / `access_logs` past ~10–50M rows
- [ ] Add a read replica when explorer read load grows
- [ ] Consider sharding only after the above are exhausted
