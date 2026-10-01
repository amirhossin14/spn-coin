/*
 * db/optimize.js — database performance maintenance & scaling helpers.
 *
 * Provides:
 *   • analyze()      — refresh planner statistics (run periodically)
 *   • tableStats()   — row counts + table sizes for capacity planning
 *   • indexUsage()   — which indexes are actually used (find dead indexes)
 *
 * SCALING NOTES (read before reaching for sharding):
 *
 *   Postgres on a single node comfortably handles tens of millions of rows
 *   with the composite indexes defined in database.js. Before sharding —
 *   which adds a lot of operational complexity — exhaust the cheaper wins:
 *
 *   1. Indexes (done): composite indexes on (from_addr, ts) and (to_addr, ts)
 *      make address-history queries fast regardless of table size.
 *   2. ANALYZE regularly so the planner has fresh statistics (analyze() below).
 *   3. Time-based PARTITIONING of the big append-only tables (transactions,
 *      access_logs) once they pass ~10–50M rows. Partition by month on `ts`
 *      so old partitions can be detached/archived cheaply. See
 *      docs/DATABASE_SCALING.md for the exact DDL.
 *   4. A read replica for the explorer's heavy read traffic.
 *   5. Only then consider horizontal sharding (e.g. by address prefix), which
 *      is rarely necessary for a chain of this size.
 */
'use strict';

let pool = null;
try { pool = require('./database').pool || null; } catch { pool = null; }

async function q(text, params) {
    if (!pool) return null;
    try { return await pool.query(text, params); } catch (e) {
        console.warn('[db/optimize]', e.message);
        return null;
    }
}

// Refresh planner statistics on the hot tables. Cheap; safe to run on a timer.
async function analyze() {
    for (const t of ['transactions', 'blocks', 'access_logs']) {
        await q(`ANALYZE ${t}`);
    }
    return true;
}

// Row counts + on-disk size per table — useful for capacity planning.
async function tableStats() {
    const r = await q(`
        SELECT relname AS table,
               n_live_tup AS rows,
               pg_size_pretty(pg_total_relation_size(relid)) AS size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
    `);
    return r ? r.rows : [];
}

// Index usage — scans per index. Zero scans on a large table = candidate to drop.
async function indexUsage() {
    const r = await q(`
        SELECT indexrelname AS index, idx_scan AS scans,
               pg_size_pretty(pg_relation_size(indexrelid)) AS size
        FROM pg_stat_user_indexes
        ORDER BY idx_scan ASC
    `);
    return r ? r.rows : [];
}

module.exports = { analyze, tableStats, indexUsage };
