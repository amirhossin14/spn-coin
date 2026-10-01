/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  🗄️ PostgreSQL Database + KYC Module
//  Features: Connection Pool، Migrations، KYC Verification
// ════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const crypto   = require('crypto');

// ── Database password ───────────────────────────────────────
// Never ship a hard-coded default like 'changeme'. If DB_PASSWORD is not set,
// generate a strong random one at startup and warn loudly. In production you
// MUST set DB_PASSWORD explicitly (and match it in your Postgres/compose config)
// so the value is stable across restarts.
function resolveDbPassword() {
    const pw = process.env.DB_PASSWORD;
    if (pw && pw.length >= 12 && pw !== 'changeme') return pw;
    if (pw === 'changeme') {
        console.warn('⚠️  [DB] DB_PASSWORD is set to the insecure default "changeme" — change it before production!');
        return pw;
    }
    // No password provided: generate a strong ephemeral one so we never fall
    // back to a known weak default. This will differ each restart, so set
    // DB_PASSWORD in the environment for a real deployment.
    const generated = crypto.randomBytes(24).toString('base64url');
    console.warn('⚠️  [DB] DB_PASSWORD not set — generated a strong ephemeral password for this run.');
    console.warn('⚠️  [DB] Set DB_PASSWORD in your environment for a stable, secure deployment.');
    return generated;
}

// ── Connection Pool ─────────────────────────────────────────
const pool = new Pool({
    host:               process.env.DB_HOST     || 'postgres',
    port:               parseInt(process.env.DB_PORT) || 5432,
    database:           process.env.DB_NAME     || 'spncoin',
    user:               process.env.DB_USER     || 'spncoin',
    password:           resolveDbPassword(),
    max:                parseInt(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis:  30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== 'true' } : false,
});

pool.on('error', (err) => console.error('❌ [DB] Pool Error:', err.message));

async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const dur = Date.now() - start;
        if (dur > 1000) console.warn(`⚠️ [DB]  کند (${dur}ms): ${text.slice(0, 80)}`);
        return res;
    } catch (err) {
        console.error('❌ [DB] Query Error:', err.message, '\nSQL:', text);
        throw err;
    }
}

async function getClient() {
    return pool.connect();
}

// ════════════════════════════════════════════════════════════
//  MIGRATIONS — ساختار جداول
// ════════════════════════════════════════════════════════════
async function migrate() {
    console.log('🔄 [DB] Running migrations...');

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username    VARCHAR(64) UNIQUE NOT NULL,
            password    VARCHAR(255) NOT NULL,
            role        VARCHAR(20) NOT NULL DEFAULT 'viewer',
            active      BOOLEAN DEFAULT true,
            is_locked   BOOLEAN DEFAULT false,
            fail_count  INT DEFAULT 0,
            last_login  TIMESTAMPTZ,
            last_ip     VARCHAR(45),
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            token_hash  VARCHAR(64) UNIQUE NOT NULL,
            refresh_hash VARCHAR(64) UNIQUE,
            ip          VARCHAR(45),
            user_agent  TEXT,
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id)`);

    await query(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name        VARCHAR(128) NOT NULL,
            key_hash    VARCHAR(64) UNIQUE NOT NULL,
            key_prefix  VARCHAR(12) NOT NULL,
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            active      BOOLEAN DEFAULT true,
            last_used   TIMESTAMPTZ,
            use_count   INT DEFAULT 0,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS access_logs (
            id          BIGSERIAL PRIMARY KEY,
            user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
            username    VARCHAR(64),
            role        VARCHAR(20),
            action      VARCHAR(64),
            ip          VARCHAR(45),
            user_agent  TEXT,
            path        VARCHAR(256),
            details     JSONB DEFAULT '{}',
            ts          TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_logs_ts       ON access_logs(ts DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_logs_user     ON access_logs(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_logs_action   ON access_logs(action)`);

    // ── KYC ─────────────────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS kyc_submissions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
            status          VARCHAR(20) DEFAULT 'pending',   -- pending|approved|rejected|review
            level           SMALLINT DEFAULT 1,              -- 1=basic, 2=advanced, 3=full
            first_name      VARCHAR(128),
            last_name       VARCHAR(128),
            national_id     VARCHAR(20),
            birth_date      DATE,
            phone           VARCHAR(20),
            email           VARCHAR(128),
            address         TEXT,
            city            VARCHAR(64),
            country         VARCHAR(64) DEFAULT 'IR',
            doc_type        VARCHAR(32),    -- docational_card|passport|driver_license
            doc_front_hash  VARCHAR(64),    -- hash فایل آپلود شده
            doc_back_hash   VARCHAR(64),
            selfie_hash     VARCHAR(64),
            reject_reason   TEXT,
            reviewed_by     UUID REFERENCES users(id),
            reviewed_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_kyc_user   ON kyc_submissions(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_submissions(status)`);

    await query(`
        CREATE TABLE IF NOT EXISTS kyc_limits (
            level           SMALLINT PRIMARY KEY,
            daily_tx_limit  BIGINT,         -- حداکثر تراکنش روزانه (satoshi)
            monthly_limit   BIGINT,
            max_balance     BIGINT,
            description     VARCHAR(128)
        )
    `);

    await query(`
        INSERT INTO kyc_limits VALUES
            (0, 1000000,   5000000,   10000000,  'Confirm'),
            (1, 10000000,  50000000,  100000000, 'base confirmation'),
            (2, 100000000, 500000000, 1000000000,'Confirm'),
            (3, NULL,      NULL,      NULL,       'Confirm')
        ON CONFLICT (level) DO NOTHING
    `);

    // ── Blockchain در DB ────────────────────────────────────
    await query(`
        CREATE TABLE IF NOT EXISTS blocks (
            height      BIGINT PRIMARY KEY,
            hash        VARCHAR(128) UNIQUE NOT NULL,
            prev_hash   VARCHAR(128),
            timestamp   BIGINT,
            nonce       BIGINT,
            difficulty  INT,
            miner       VARCHAR(128),
            tx_count    INT DEFAULT 0,
            data        JSONB,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS transactions (
            id          VARCHAR(128) PRIMARY KEY,
            block_hash  VARCHAR(128) REFERENCES blocks(hash),
            from_addr   VARCHAR(128),
            to_addr     VARCHAR(128),
            amount      BIGINT,
            fee         BIGINT DEFAULT 0,
            signature   TEXT,
            status      VARCHAR(20) DEFAULT 'confirmed',
            ts          TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_tx_from  ON transactions(from_addr)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_to    ON transactions(to_addr)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_hash)`);

    // ── Performance indexes for common access patterns ──────────
    // The explorer and wallet pages sort transactions by time and filter by
    // status; block lookups happen by hash, miner, and time. These composite
    // and single-column indexes keep those queries fast as the chain grows.
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_ts          ON transactions(ts DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_status      ON transactions(status)`);
    // Composite: "my recent transactions" (address history newest-first)
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_from_ts     ON transactions(from_addr, ts DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tx_to_ts       ON transactions(to_addr, ts DESC)`);
    // Blocks: fast lookup by hash, by miner, and newest-first listing
    await query(`CREATE INDEX IF NOT EXISTS idx_blocks_hash    ON blocks(hash)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_blocks_miner   ON blocks(miner)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_blocks_ts      ON blocks(timestamp DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_blocks_prev    ON blocks(prev_hash)`);

    console.log('✅ [DB] Migrations');
}

// ════════════════════════════════════════════════════════════
//  KYC MODULE
// ════════════════════════════════════════════════════════════
const KYC = {
    async submit(userId, data) {
        const { rows } = await query(`
            INSERT INTO kyc_submissions
                (user_id, first_name, last_name, national_id, birth_date,
                 phone, email, address, city, country, doc_type, level)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (user_id) DO UPDATE SET
                status='pending', first_name=$2, last_name=$3, national_id=$4,
                birth_date=$5, phone=$6, email=$7, address=$8, city=$9,
                country=$10, doc_type=$11, level=$12, updated_at=NOW()
            RETURNING *
        `, [userId, data.firstName, data.lastName, data.nationalId,
            data.birthDate, data.phone, data.email, data.address,
            data.city, data.country || 'IR', data.docType, data.level || 1]);
        return rows[0];
    },

    async uploadDoc(submissionId, field, fileBuffer) {
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const col  = { front: 'doc_front_hash', back: 'doc_back_hash', selfie: 'selfie_hash' }[field];
        if (!col) throw new Error('Invalid');
        await query(`UPDATE kyc_submissions SET ${col}=$1, updated_at=NOW() WHERE id=$2`, [hash, submissionId]);
        return hash;
    },

    async getStatus(userId) {
        const { rows } = await query(
            `SELECT s.*, l.daily_tx_limit, l.monthly_limit, l.max_balance
             FROM kyc_submissions s
             LEFT JOIN kyc_limits l ON l.level = s.level
             WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT 1`,
            [userId]
        );
        return rows[0] || null;
    },

    async review(submissionId, reviewerId, approved, rejectReason = null) {
        const status = approved ? 'approved' : 'rejected';
        const { rows } = await query(`
            UPDATE kyc_submissions
            SET status=$1, reject_reason=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW()
            WHERE id=$4 RETURNING *
        `, [status, rejectReason, reviewerId, submissionId]);

        if (approved && rows[0]) {
            await query(`UPDATE users SET role='miner' WHERE id=$1 AND role='viewer'`, [rows[0].user_id]);
        }
        return rows[0];
    },

    async getPending(limit = 50) {
        const { rows } = await query(`
            SELECT s.*, u.username, u.email as user_email
            FROM kyc_submissions s JOIN users u ON u.id = s.user_id
            WHERE s.status='pending' ORDER BY s.created_at ASC LIMIT $1
        `, [limit]);
        return rows;
    },

    async getLimits(userId) {
        const kyc = await this.getStatus(userId);
        if (!kyc || kyc.status !== 'approved') {
            const { rows } = await query('SELECT * FROM kyc_limits WHERE level=0');
            return rows[0];
        }
        const { rows } = await query('SELECT * FROM kyc_limits WHERE level=$1', [kyc.level]);
        return rows[0];
    }
};

// ════════════════════════════════════════════════════════════
//  USER REPOSITORY
// ════════════════════════════════════════════════════════════
const UserRepo = {
    async findByUsername(username) {
        const { rows } = await query('SELECT * FROM users WHERE username=$1', [username]);
        return rows[0] || null;
    },
    async findById(id) {
        const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
        return rows[0] || null;
    },
    async create(username, passwordHash, role = 'viewer') {
        const { rows } = await query(
            'INSERT INTO users(username,password,role) VALUES($1,$2,$3) RETURNING *',
            [username, passwordHash, role]
        );
        return rows[0];
    },
    async updateLogin(id, ip) {
        await query('UPDATE users SET last_login=NOW(), last_ip=$1, fail_count=0 WHERE id=$2', [ip, id]);
    },
    async incFail(id) {
        await query(`
            UPDATE users SET fail_count=fail_count+1,
            is_locked=(fail_count+1 >= 5) WHERE id=$1
        `, [id]);
    },
    async unlock(id) {
        await query('UPDATE users SET is_locked=false, fail_count=0 WHERE id=$1', [id]);
    },
    async list() {
        const { rows } = await query('SELECT id,username,role,active,is_locked,fail_count,last_login,last_ip,created_at FROM users ORDER BY created_at DESC');
        return rows;
    },
    async update(id, updates) {
        const fields = Object.keys(updates).map((k, i) => `${k}=$${i + 2}`).join(',');
        await query(`UPDATE users SET ${fields}, updated_at=NOW() WHERE id=$1`,
            [id, ...Object.values(updates)]);
    },
    async delete(id) {
        await query('DELETE FROM users WHERE id=$1', [id]);
    }
};

// ════════════════════════════════════════════════════════════
//  LOG REPOSITORY
// ════════════════════════════════════════════════════════════
const LogRepo = {
    async add(entry) {
        await query(`
            INSERT INTO access_logs(user_id, username, role, action, ip, user_agent, path, details)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        `, [entry.userId, entry.username, entry.role, entry.action,
            entry.ip, entry.userAgent, entry.path, JSON.stringify(entry.details || {})]);
    },
    async list({ username, action, role, limit = 200 }) {
        const conds = [], params = [];
        if (username) { params.push(`%${username}%`); conds.push(`username ILIKE $${params.length}`); }
        if (action)   { params.push(action);           conds.push(`action=$${params.length}`); }
        if (role)     { params.push(role);             conds.push(`role=$${params.length}`); }
        params.push(limit);
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const { rows } = await query(
            `SELECT * FROM access_logs ${where} ORDER BY ts DESC LIMIT $${params.length}`, params);
        return rows;
    }
};

module.exports = { pool, query, getClient, migrate, KYC, UserRepo, LogRepo };
