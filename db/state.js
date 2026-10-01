/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  💾 SPN Coin Persistent State v2.0
//
//  Saves blockchain state so Vercel cold starts don't lose
//  all data. Uses PostgreSQL (Neon.tech free tier) or
//  falls back to in-memory storage.
//
//  Setup (Vercel):
//   1. Sign up at https://neon.tech (free)
//   2. Create a database, copy the connection string
//   3. Add to Vercel env:  DATABASE_URL=postgresql://...
//
//  How it works:
//   - On startup: load last known chain state from DB
//   - Every new block: persist to DB in background
//   - On Vercel cold start: restore from DB instantly
// ════════════════════════════════════════════════════════════
"use strict";

const crypto = require("crypto");

// Network identity — used to detect when persisted data belongs to a
// different chain (e.g. after a rebrand or an address-format change).
const { COIN, ADDRESS, BLOCKCHAIN, CHAIN_ID } = require("../config");
function networkFingerprint() {
    const algo = (BLOCKCHAIN && BLOCKCHAIN.POW_ALGORITHM) || "sha256d";
    const fmt  = (ADDRESS && ADDRESS.FORMAT) || "base58check";
    const pfx  = (ADDRESS && ADDRESS.PREFIX_MAINNET) || "";
    // Genesis epoch — bump this whenever the genesis block changes (e.g. the
    // 2026 fair-launch reset that removed the premine). Changing it makes the
    // node treat any previously-persisted chain as a different network, archive
    // it, and start fresh from the new genesis on next boot.
    const genesisEpoch = "g3-canonical-sigs";
    return `${COIN.SYMBOL}|${pfx}|${fmt}|${algo}|chain${CHAIN_ID}|${genesisEpoch}`;
}

// ── Try to load pg, fall back gracefully ─────────────────────
let pool = null;
try {
    const { Pool } = require("pg");
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString:        process.env.DATABASE_URL,
            ssl:                     { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "true" },
            max:                     5,
            idleTimeoutMillis:       30_000,
            connectionTimeoutMillis: 5_000,
        });
        pool.on("error", err => console.error("❌ [DB] Pool error:", err.message));
    }
} catch {
    console.warn("⚠️  [State] pg module not available — using in-memory storage");
}

// ── In-memory fallback ────────────────────────────────────────
const memory = {
    chain:  null,    // serialized chain JSON
    users:  null,    // users JSON
    logs:   [],      // log entries
    kyc:    [],      // kyc records
};

// ── DB initialization ─────────────────────────────────────────
async function initDB() {
    if (!pool) return false;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS spncoin_state (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS spncoin_blocks (
                height      INTEGER PRIMARY KEY,
                hash        CHAR(64) NOT NULL,
                block_json  TEXT NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS spncoin_logs (
                id          BIGSERIAL PRIMARY KEY,
                ts          BIGINT NOT NULL,
                action      TEXT,
                username    TEXT,
                ip          VARCHAR(45),
                path        TEXT,
                details     JSONB,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_ts ON spncoin_logs(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_logs_username ON spncoin_logs(username);
        `);
        // Issuance-fee income ledger — one row per coin/token creation fee paid.
        // Durable across restarts (independent of chain replay). txid is unique so
        // the same fee is never double-recorded.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS spncoin_fees (
                id          BIGSERIAL PRIMARY KEY,
                token_id    TEXT,
                symbol      TEXT,
                name        TEXT,
                kind        TEXT,
                issuer      TEXT,
                fee_sat     NUMERIC(40,0) NOT NULL DEFAULT 0,
                treasury    TEXT,
                txid        TEXT UNIQUE,
                at          BIGINT NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_fees_at ON spncoin_fees(at DESC);`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS spncoin_kyc (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     TEXT NOT NULL,
                status      VARCHAR(20) DEFAULT 'pending',
                data        JSONB,
                reviewed_by TEXT,
                reason      TEXT,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log("✅ [DB] Tables initialized");
        return true;
    } catch (e) {
        console.error("❌ [DB] Init failed:", e.message);
        return false;
    }
}

// ── Save key-value state ──────────────────────────────────────
async function setState(key, value) {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO spncoin_state (key, value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            `, [key, json]);
            return true;
        } catch (e) {
            console.error("❌ [DB] setState error:", e.message);
        }
    }
    memory[key] = json;
    return false;
}

// ── Get key-value state ───────────────────────────────────────
async function getState(key) {
    if (pool) {
        try {
            const r = await pool.query("SELECT value FROM spncoin_state WHERE key = $1", [key]);
            if (r.rows.length > 0) {
                try { return JSON.parse(r.rows[0].value); }
                catch { return r.rows[0].value; }
            }
            return null;
        } catch (e) {
            console.error("❌ [DB] getState error:", e.message);
        }
    }
    if (memory[key]) {
        try { return JSON.parse(memory[key]); }
        catch { return memory[key]; }
    }
    return null;
}

// ── Persist a block ───────────────────────────────────────────
async function saveBlock(block) {
    if (!pool) return;
    try {
        const blockJson = typeof block.toJSON === "function"
            ? JSON.stringify(block.toJSON())
            : JSON.stringify(block);
        await pool.query(`
            INSERT INTO spncoin_blocks (height, hash, block_json)
            VALUES ($1, $2, $3)
            ON CONFLICT (height) DO UPDATE SET hash = $2, block_json = $3
        `, [block.height, block.hash, blockJson]);
    } catch (e) {
        console.error("❌ [DB] saveBlock error:", e.message);
    }
}

// ── Load full chain from DB ───────────────────────────────────
async function loadChain() {
    if (!pool) return null;
    try {
        const r = await pool.query(
            "SELECT block_json FROM spncoin_blocks ORDER BY height ASC"
        );
        if (r.rows.length === 0) return null;
        const blocks = r.rows.map(row => {
            try { return JSON.parse(row.block_json); }
            catch { return null; }
        }).filter(Boolean);
        console.log(`📦 [DB] Loaded ${blocks.length} blocks from database`);
        return blocks;
    } catch (e) {
        console.error("❌ [DB] loadChain error:", e.message);
        return null;
    }
}

// ── Log operations ────────────────────────────────────────────
const LogRepo = {
    async add({ username, action, ip, path, details } = {}) {
        const entry = { ts: Date.now(), action, username, ip, path, details };
        if (pool) {
            try {
                await pool.query(`
                    INSERT INTO spncoin_logs (ts, action, username, ip, path, details)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [entry.ts, action, username, ip, path, JSON.stringify(details || {})]);
                return;
            } catch (e) {
                console.error("❌ [DB] log insert error:", e.message);
            }
        }
        memory.logs.push(entry);
        if (memory.logs.length > 5000) memory.logs = memory.logs.slice(-5000);
    },

    async list({ username, action, limit = 200 } = {}) {
        if (pool) {
            try {
                let q   = "SELECT ts, action, username, ip, path, details FROM spncoin_logs";
                const p = [];
                const w = [];
                if (username) { w.push(`username = $${p.length+1}`); p.push(username); }
                if (action)   { w.push(`action LIKE $${p.length+1}`); p.push(`${action}%`); }
                if (w.length)   q += ` WHERE ${w.join(" AND ")}`;
                q += ` ORDER BY ts DESC LIMIT $${p.length+1}`;
                p.push(Math.min(limit, 1000));
                const r = await pool.query(q, p);
                return { logs: r.rows };
            } catch (e) {
                console.error("❌ [DB] log list error:", e.message);
            }
        }
        let logs = [...memory.logs].reverse();
        if (username) logs = logs.filter(l => l.username === username);
        if (action)   logs = logs.filter(l => (l.action || "").startsWith(action));
        return { logs: logs.slice(0, limit) };
    },
};

// ── KYC operations ────────────────────────────────────────────
const KYC = {
    async getStatus(userId) {
        if (pool) {
            try {
                const r = await pool.query(
                    "SELECT status FROM spncoin_kyc WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
                    [userId]
                );
                return r.rows[0]?.status || null;
            } catch {}
        }
        const entry = memory.kyc.find(k => k.userId === userId);
        return entry?.status || null;
    },

    async getLimits(userId) {
        const status = await KYC.getStatus(userId);
        return {
            dailyLimit:   status === "approved" ? 100_000 : 1_000,
            monthlyLimit: status === "approved" ? 1_000_000 : 10_000,
            status,
        };
    },

    async submit(userId, data) {
        const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
        if (pool) {
            try {
                await pool.query(
                    "INSERT INTO spncoin_kyc (id, user_id, data) VALUES ($1, $2, $3)",
                    [id, userId, JSON.stringify(data)]
                );
                return { id };
            } catch {}
        }
        memory.kyc.push({ id, userId, data, status: "pending", createdAt: Date.now() });
        return { id };
    },

    async getPending() {
        if (pool) {
            try {
                const r = await pool.query(
                    "SELECT * FROM spncoin_kyc WHERE status = $1 ORDER BY created_at ASC",
                    ["pending"]
                );
                return r.rows;
            } catch {}
        }
        return memory.kyc.filter(k => k.status === "pending");
    },

    async review(id, reviewedBy, approved, reason) {
        const status = approved ? "approved" : "rejected";
        if (pool) {
            try {
                await pool.query(
                    "UPDATE spncoin_kyc SET status=$1, reviewed_by=$2, reason=$3, updated_at=NOW() WHERE id=$4",
                    [status, reviewedBy, reason, id]
                );
                return { id, status };
            } catch {}
        }
        const entry = memory.kyc.find(k => k.id === id);
        if (entry) { entry.status = status; entry.reviewedBy = reviewedBy; entry.reason = reason; }
        return { id, status };
    },
};

// ── Blockchain persistence hook ────────────────────────────────
// Call this after your Blockchain class is initialized
async function bindBlockchain(blockchain) {
    if (!pool) return;

    // ── Network-identity guard ────────────────────────────────
    // If the persisted chain belongs to a different network identity
    // (e.g. it was mined as "MYC" before a rebrand to "SPN", or the
    // address format changed), don't error and don't mix it into the
    // new chain. Archive the old blocks and start fresh from genesis.
    const currentFp = networkFingerprint();
    let storedFp;
    try { storedFp = await getState('network_fingerprint'); } catch { storedFp = null; }

    const blocks = await loadChain();
    // The DB stores only MINED blocks (height ≥ 1); genesis lives only in memory
    // and is never written by saveBlock. The old code assumed blocks[0] was
    // genesis and dropped it (slice(1)) — which silently discarded the first real
    // block on every restart, resetting the chain. Treat every persisted row as a
    // post-genesis block.
    const mined = (blocks || [])
        .filter(b => b && Number(b.height) >= 1)
        .sort((a, b) => Number(a.height) - Number(b.height));
    const hasPersisted = mined.length >= 1;
    const identityChanged = hasPersisted && storedFp !== currentFp;

    if (identityChanged) {
        const archive = `spncoin_blocks_legacy_${Date.now()}`;
        console.warn('⚠️  [DB] Persisted chain belongs to a different network identity.');
        console.warn(`     stored: ${storedFp || '(none)'}  →  current: ${currentFp}`);
        try {
            await pool.query(`CREATE TABLE ${archive} (height INTEGER, hash TEXT, block_json TEXT, created_at TIMESTAMPTZ)`);
            await pool.query(`INSERT INTO ${archive} (height, hash, block_json, created_at)
                              SELECT height, hash, block_json, created_at FROM spncoin_blocks`);
            console.warn(`     Old blocks archived to "${archive}".`);
        } catch (e) {
            console.warn(`     (Could not archive old blocks: ${e.message} — clearing them anyway.)`);
        }
        try { await pool.query('TRUNCATE spncoin_blocks'); }
        catch { await pool.query('DELETE FROM spncoin_blocks'); }
        console.warn('     Starting a fresh chain from the new genesis.');
        await setState('network_fingerprint', currentFp);
        // Fall through with no restore — the in-memory genesis is the new chain.
    } else if (hasPersisted) {
        console.log(`🔄 [DB] Restoring ${mined.length} blocks...`);
        try {
            const { Block } = require("../blockchain/blockchain");
            // Genesis is the trusted in-memory block; append every persisted
            // (mined) block after it — they are heights 1..N, never genesis.
            const candidate = [blockchain.chain[0]];
            for (const b of mined) candidate.push(new Block(b));

            // SECURITY: never trust DB blocks blindly. Validate the whole chain
            // (genesis anchor, PoW, difficulty, links, tx integrity) before we
            // adopt it. A tampered or corrupted DB must NOT poison the node.
            const { valid, errors } = blockchain.validateChain(candidate);
            if (!valid) {
                console.error('❌ [DB] Persisted chain failed validation:', errors[0]);
                console.warn('     Keeping the fresh in-memory chain instead of the DB chain.');
            } else {
                for (let i = 1; i < candidate.length; i++) {
                    const block = candidate[i];
                    if (!blockchain.getBlock(block.hash)) {
                        blockchain.chain.push(block);
                        blockchain.blockIndex.set(block.hash, block);
                        blockchain.utxoSet.applyBlock(block, block.height);
                        // Also rebuild the TOKEN ledger (tokens, balances, and the
                        // issuance-fee history) from the persisted chain — so token
                        // data and the admin fee log survive restarts, not just UTXOs.
                        if (blockchain.tokens && blockchain.tokens.applyBlock) {
                            blockchain.tokens.applyBlock(block);
                        }
                    }
                }
                blockchain.bestHash = blockchain.tip.hash;
                console.log(`✅ [DB] Restored & validated chain to height ${blockchain.height}`);
            }
        } catch (e) {
            console.error("❌ [DB] Chain restore error:", e.message);
        }
    }

    // Tag this database with the current network identity for next boot.
    if (storedFp !== currentFp) await setState('network_fingerprint', currentFp);

    // Hook: save each new block as it arrives
    const origAdd = blockchain.addBlock.bind(blockchain);
    blockchain.addBlock = function(block) {
        const result = origAdd(block);
        if (result.ok) saveBlock(block).catch(e => console.error("❌ saveBlock:", e.message));
        return result;
    };
}

// ── Issuance-fee income ledger (durable across restarts) ──────
const FeeRepo = {
    // Record one fee payment. Idempotent by txid (ON CONFLICT DO NOTHING), so
    // replaying the chain after a restart never double-counts a fee.
    async add(rec = {}) {
        if (!pool) return false;
        try {
            await pool.query(`
                INSERT INTO spncoin_fees (token_id, symbol, name, kind, issuer, fee_sat, treasury, txid, at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (txid) DO NOTHING
            `, [rec.tokenId || null, rec.symbol || null, rec.name || null, rec.kind || null,
                rec.issuer || null, String(rec.feeSat || '0'), rec.treasury || null,
                rec.txid || null, rec.at || Date.now()]);
            return true;
        } catch (e) { console.error("❌ [DB] fee insert error:", e.message); return false; }
    },

    // Recent payments (newest first) plus totals — for the admin panel.
    async summary(limit = 200) {
        if (!pool) return null;
        try {
            const rows = await pool.query(
                `SELECT token_id, symbol, name, kind, issuer, fee_sat, treasury, txid, at
                 FROM spncoin_fees ORDER BY at DESC LIMIT $1`, [Math.min(500, limit)]);
            const agg = await pool.query(
                `SELECT COUNT(*)::int AS count, COALESCE(SUM(fee_sat),0)::text AS total FROM spncoin_fees`);
            const payments = rows.rows.map(r => ({
                tokenId: r.token_id, symbol: r.symbol, name: r.name, kind: r.kind,
                issuer: r.issuer, feeSat: String(r.fee_sat), feeSPN: Number(r.fee_sat) / 1e8,
                treasury: r.treasury, txid: r.txid, at: Number(r.at),
            }));
            const totalSat = agg.rows[0].total || '0';
            return { payments, count: agg.rows[0].count || 0, totalSat, totalSPN: Number(totalSat) / 1e8 };
        } catch (e) { console.error("❌ [DB] fee summary error:", e.message); return null; }
    },
};

module.exports = {
    initDB, setState, getState,
    saveBlock, loadChain, bindBlockchain,
    LogRepo, KYC, FeeRepo,
    pool,
    // Re-export UserRepo alias
    UserRepo: LogRepo,
};
