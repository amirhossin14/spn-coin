/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
const net          = require('net');
const crypto       = require('crypto');
const EventEmitter = require('events');
const { sha256d, merkleRoot, powHash } = require('../blockchain/crypto');
const { Block }    = require('../blockchain/blockchain');
const { Transaction } = require('../utxo/utxo');
const { buildTemplate, buildCandidate } = require('./blocktemplate');

// ── تنظیمات ────────────────────────────────────────────────
const CFG = {
    POOL_FEE:          parseFloat(process.env.POOL_FEE)        || 0.01, // 1%
    POOL_ADDRESS:      process.env.POOL_ADDRESS                || 'POOL_WALLET_ADDRESS',
    VARDIFF_MIN:       parseInt(process.env.VARDIFF_MIN)       || 1,
    VARDIFF_MAX:       parseInt(process.env.VARDIFF_MAX)       || 32,
    VARDIFF_TARGET_MS: parseInt(process.env.VARDIFF_TARGET_MS) || 15_000, // هدف: هر 15 ثانیه یک share
    VARDIFF_WINDOW:    parseInt(process.env.VARDIFF_WINDOW)    || 10,    // count share برای محاسبه
    JOB_EXPIRY_MS:     parseInt(process.env.JOB_EXPIRY_MS)    || 300_000,// 5 دقیقه
    MAX_SHARES_PER_SEC:parseInt(process.env.MAX_SHARES_SEC)   || 20,
    BAN_INVALID_SHARES:parseInt(process.env.BAN_INVALID)      || 10,   // بعد از X share Invalid
    BAN_DURATION_MS:   parseInt(process.env.BAN_DURATION)     || 600_000,// 10 دقیقه
    TIMEOUT_MS:        parseInt(process.env.MINER_TIMEOUT_MS) || 300_000,// 5 دقیقه بدون activity
    MAX_CONNECTIONS:   parseInt(process.env.MAX_MINERS)        || 1000,
    EXTRANONCE1_SIZE:  4,
    EXTRANONCE2_SIZE:  4,
    PPLNS_WINDOW:      parseInt(process.env.PPLNS_WINDOW)     || 100_000,// آخرین N share
};

// ── Share Database ───────────────────────────────────────────
class ShareDB {
    constructor() {
        this.shares      = [];         // { workerId, shareHash, diff, ts, valid, blockFound }
        this.maxShares   = CFG.PPLNS_WINDOW * 10;
        this.totalValid  = 0;
        this.totalInvalid= 0;
    }

    add(share) {
        this.shares.push({ ...share, ts: Date.now() });
        if (share.valid) this.totalValid++;
        else             this.totalInvalid++;
        if (this.shares.length > this.maxShares) this.shares.shift();
    }

    // محاسبه PPLNS — سهم هر User در آخرین N share
    calcPPLNS(reward) {
        const window    = this.shares.slice(-CFG.PPLNS_WINDOW).filter(s => s.valid);
        if (!window.length) return {};

        const byWorker  = {};
        let totalDiff   = 0;
        for (const s of window) {
            byWorker[s.workerId] = (byWorker[s.workerId] || 0) + s.diff;
            totalDiff += s.diff;
        }

        const payouts = {};
        // Fee & payout math stays in BigInt (satoshi). Converting the reward to a
        // JS Number (as before) silently loses precision above 2^53 and rounds
        // payouts wrongly. POOL_FEE (a float fraction) becomes integer basis points.
        const feeBps    = BigInt(Math.max(0, Math.min(10000, Math.round(CFG.POOL_FEE * 10000))));
        const feeAmt    = (reward * feeBps) / 10000n;
        const netReward = reward - feeAmt;

        // Scale possibly-fractional share difficulties to integers for BigInt split.
        const SCALE = 1_000_000;
        let totalScaled = 0n;
        const scaled = {};
        for (const [worker, diff] of Object.entries(byWorker)) {
            const sd = BigInt(Math.max(0, Math.round(diff * SCALE)));
            scaled[worker] = sd;
            totalScaled += sd;
        }

        let distributed = 0n;
        if (totalScaled > 0n) {
            for (const [worker, sd] of Object.entries(scaled)) {
                const share = (netReward * sd) / totalScaled;
                payouts[worker] = share;
                distributed += share;
            }
        }
        // Any integer-division remainder (dust) goes to the pool along with the fee,
        // so the sum of payouts always equals `reward` exactly (no lost satoshis).
        const remainder = netReward - distributed;
        payouts[CFG.POOL_ADDRESS] = (payouts[CFG.POOL_ADDRESS] || 0n) + feeAmt + remainder;

        return payouts;
    }

    getWorkerStats(workerId, windowMs = 3600_000) {
        const since   = Date.now() - windowMs;
        const myShares= this.shares.filter(s => s.workerId === workerId && s.ts >= since);
        return {
            valid:    myShares.filter(s => s.valid).length,
            invalid:  myShares.filter(s => !s.valid).length,
            hashrate: this._calcHashrate(myShares.filter(s => s.valid), windowMs),
        };
    }

    _calcHashrate(validShares, windowMs) {
        if (!validShares.length) return 0;
        const totalDiff = validShares.reduce((s, sh) => s + sh.diff, 0);
        return Math.round(totalDiff * Math.pow(2, 32) / (windowMs / 1000));
    }

    getPoolStats() {
        const hourAgo   = Date.now() - 3600_000;
        const recent    = this.shares.filter(s => s.ts >= hourAgo);
        const valid     = recent.filter(s => s.valid);
        const totalDiff = valid.reduce((s, sh) => s + sh.diff, 0);
        return {
            validShares:   this.totalValid,
            invalidShares: this.totalInvalid,
            hashrate1h:    Math.round(totalDiff * Math.pow(2, 32) / 3600),
        };
    }
}

// ── Miner Connection ─────────────────────────────────────────
class MinerConnection {
    constructor(socket, extraNonce1) {
        this.socket      = socket;
        this.ip          = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
        this.id          = crypto.randomBytes(4).toString('hex');
        this.extraNonce1 = extraNonce1;
        this.workerId    = null;
        this.address     = null;
        this.authorized  = false;
        this.difficulty  = CFG.VARDIFF_MIN;
        this.shareTimes  = [];     // برای Vardiff
        this.seenShares  = new Set(); // Duplicate protection
        this.invalidCount= 0;
        this.shareCount  = 0;      // Rate limiting
        this.shareWindow = [];     // timestamp share های اخیر
        this.subscribed  = false;
        this.lastActivity= Date.now();
        this._buf        = '';
        this._timeoutTimer = null;
        this._vardiffTimer = null;
    }

    startTimers() {
        // Timeout disconnect
        this._timeoutTimer = setInterval(() => {
            if (Date.now() - this.lastActivity > CFG.TIMEOUT_MS) {
                this.destroy('timeout');
            }
        }, 60_000);

        // Vardiff adjustment هر 30 ثانیه
        this._vardiffTimer = setInterval(() => this._adjustDiff(), 30_000);
    }

    _adjustDiff() {
        const recent = this.shareTimes.filter(t => t > Date.now() - CFG.VARDIFF_WINDOW * CFG.VARDIFF_TARGET_MS);
        if (recent.length < 3) return;

        const avgMs  = (recent[recent.length-1] - recent[0]) / (recent.length - 1);
        const ratio  = avgMs / CFG.VARDIFF_TARGET_MS;
        let newDiff  = Math.round(this.difficulty * ratio);
        newDiff      = Math.max(CFG.VARDIFF_MIN, Math.min(CFG.VARDIFF_MAX, newDiff));

        if (newDiff !== this.difficulty) {
            this.difficulty = newDiff;
            this.shareTimes = [];
            this.send({ id: null, method: 'mining.set_difficulty', params: [newDiff] });
            console.log(`📊 [Vardiff] ${this.workerId}: difficulty → ${newDiff}`);
        }
    }

    checkRateLimit() {
        const now = Date.now();
        this.shareWindow = this.shareWindow.filter(t => t > now - 1000);
        this.shareWindow.push(now);
        return this.shareWindow.length <= CFG.MAX_SHARES_PER_SEC;
    }

    send(obj) {
        if (this.socket.destroyed) return;
        try {
            this.socket.write(JSON.stringify(obj) + '\n');
        } catch {}
    }

    destroy(reason = '') {
        if (this._timeoutTimer) clearInterval(this._timeoutTimer);
        if (this._vardiffTimer) clearInterval(this._vardiffTimer);
        if (!this.socket.destroyed) this.socket.destroy();
        console.log(`👋 [Stratum] miner ${this.workerId || this.id} : ${reason}`);
    }
}

// ── Stratum Server ───────────────────────────────────────────
class StratumServer extends EventEmitter {

    constructor({ blockchain, mempool, wallet }) {
        super();
        this.blockchain  = blockchain;
        this.mempool     = mempool;
        this.wallet      = wallet;

        this.miners      = new Map();   // id → MinerConnection
        this.jobs        = new Map();   // jobId → job
        this.currentJob  = null;
        this.banList     = new Map();   // ip → unbanAt
        this.shareDB     = new ShareDB();
        this.server      = null;

        this._extraNonce1Counter = 0;
        this._extraNonceMap = new Map(); // ip → extraNonce1 (برای reuse در reconnect)
    }

    start(port = 3333) {
        this.server = net.createServer(socket => this._onConnect(socket));
        this.server.on('error', err => console.error(`[Stratum] ❌ ${err.message}`));
        this.server.listen(port, () => console.log(`⛏️  [Stratum]  ${port} آماده`));

        // تولید job اولیه
        setTimeout(() => this._buildJob(true), 2000);
    }

    // ── connection جدید ───────────────────────────────────────────
    _onConnect(socket) {
        const ip = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';

        // بررسی Ban
        if (this.banList.has(ip)) {
            if (Date.now() < this.banList.get(ip)) { socket.destroy(); return; }
            this.banList.delete(ip);
        }

        // بررسی ظرفیت
        if (this.miners.size >= CFG.MAX_CONNECTIONS) { socket.destroy(); return; }

        // اختصاص ExtraNonce1
        const extraNonce1 = this._extraNonceMap.get(ip)
            || (++this._extraNonce1Counter).toString(16).padStart(CFG.EXTRANONCE1_SIZE * 2, '0');
        this._extraNonceMap.set(ip, extraNonce1);

        const miner = new MinerConnection(socket, extraNonce1);
        this.miners.set(miner.id, miner);

        let buf = '';
        socket.on('data', data => {
            miner.lastActivity = Date.now();
            buf += data.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    this._handleMessage(msg, miner);
                } catch { miner.destroy('invalid json'); return; }
            }
        });

        socket.on('close', () => {
            this.miners.delete(miner.id);
            miner.destroy('socket close');
            this.emit('miner:disconnect', miner);
        });

        socket.on('error', () => miner.destroy('socket error'));
        socket.setTimeout(CFG.TIMEOUT_MS, () => miner.destroy('socket timeout'));

        miner.startTimers();
        console.log(`🔌 [Stratum] connection : ${ip} (${this.miners.size} active)`);
    }

    // ── پردازش پیام Stratum ───────────────────────────────────
    _handleMessage(msg, miner) {
        const { id, method, params } = msg;

        switch (method) {

            // ── Subscribe ─────────────────────────────────────
            case 'mining.subscribe': {
                miner.subscribed = true;
                const sessionId  = crypto.randomBytes(4).toString('hex');
                miner.send({
                    id,
                    result: [
                        [['mining.set_difficulty', sessionId], ['mining.notify', sessionId]],
                        miner.extraNonce1,
                        CFG.EXTRANONCE2_SIZE
                    ],
                    error: null
                });

                // send difficulty
                miner.send({ id: null, method: 'mining.set_difficulty', params: [miner.difficulty] });

                // send job
                if (this.currentJob) this._sendJob(miner, this.currentJob, true);
                break;
            }

            // ── Authorize ─────────────────────────────────────
            case 'mining.authorize': {
                const [workerName, password] = params || [];
                const auth = this._authorize(workerName, password, miner.ip);

                if (!auth.ok) {
                    miner.send({ id, result: false, error: [25, auth.reason, null] });
                    miner.invalidCount++;
                    if (miner.invalidCount >= 3) this._ban(miner.ip, 'auth failure');
                    return;
                }

                miner.authorized = true;
                miner.workerId   = workerName;
                miner.address    = auth.address;
                miner.send({ id, result: true, error: null });

                console.log(`✅ [Stratum] : ${workerName} از ${miner.ip}`);
                this.emit('miner:authorized', { miner, workerName });
                break;
            }

            // ── Submit Share ──────────────────────────────────
            case 'mining.submit': {
                if (!miner.authorized) {
                    miner.send({ id, result: false, error: [24, 'Unauthorized', null] });
                    return;
                }

                // Rate limit
                if (!miner.checkRateLimit()) {
                    miner.send({ id, result: false, error: [23, 'Too many shares', null] });
                    return;
                }

                // Unified protocol: submit = [workerName, jobId, nonce, nTime?]
                const [workerName, jobId, nonce, nTime] = params || [];
                const result = this._validateShare({ workerName, jobId, nonce, nTime, miner });

                miner.send({ id, result: result.ok, error: result.ok ? null : [result.code, result.error, null] });

                this.shareDB.add({
                    workerId:   miner.workerId,
                    address:    miner.address,
                    shareHash:  result.shareHash,
                    diff:       miner.difficulty,
                    valid:      result.ok,
                    blockFound: result.blockFound || false,
                });

                if (!result.ok) {
                    miner.invalidCount++;
                    if (miner.invalidCount >= CFG.BAN_INVALID_SHARES) {
                        this._ban(miner.ip, `too many invalid shares (${miner.invalidCount})`);
                        miner.destroy('banned');
                    }
                } else {
                    miner.invalidCount = 0;
                    miner.shareTimes.push(Date.now());
                }

                break;
            }

            // ── Suggest Difficulty ────────────────────────────
            case 'mining.suggest_difficulty': {
                const suggested = Math.max(CFG.VARDIFF_MIN, Math.min(CFG.VARDIFF_MAX, parseInt(params[0]) || 1));
                miner.difficulty = suggested;
                miner.send({ id, result: true, error: null });
                miner.send({ id: null, method: 'mining.set_difficulty', params: [suggested] });
                break;
            }
        }
    }

    // ── احراز هویت ──────────────────────────────────────────
    _authorize(workerName, _password, _ip) {
        if (!workerName || typeof workerName !== 'string') {
            return { ok: false, reason: 'Invalid username' };
        }

        // فرمت: ADDRESS.WORKERNAME
        const parts   = workerName.split('.');
        const address = parts[0];

        if (!address || address.length < 10) {
            return { ok: false, reason: 'address Invalid' };
        }

        // بررسی block‌لیست
        if (process.env.WORKER_BLACKLIST?.split(',').includes(address)) {
            return { ok: false, reason: 'address' };
        }

        return { ok: true, address };
    }

    // ── validation Share ─────────────────────────────────────
    // CONSENSUS-EXACT: the share is scored against a real candidate Block whose
    // header is byte-identical to what the core validates. A found block IS that
    // very candidate — no separate/legacy header, no hash substitution.
    _validateShare({ jobId, nTime, nonce, miner }) {
        // ── Job lookup + expiry ───────────────────────────────
        const job = this.jobs.get(jobId);
        if (!job) return { ok: false, code: 21, error: 'Job not found' };
        if (Date.now() - job.createdAt > CFG.JOB_EXPIRY_MS)
            return { ok: false, code: 21, error: 'Job expired' };

        // ── Wrong / unauthorized miner ────────────────────────
        if (!miner || !miner.authorized || !miner.address)
            return { ok: false, code: 24, error: 'Unauthorized miner' };

        // ── nonce format (hex, up to 32-bit) ──────────────────
        if (typeof nonce !== 'string' || !/^[0-9a-fA-F]{1,8}$/.test(nonce))
            return { ok: false, code: 20, error: 'Invalid nonce' };

        // ── optional nTime roll (bounded) ─────────────────────
        let ts = null;
        if (nTime != null && nTime !== '') {
            if (!/^[0-9a-fA-F]{1,12}$/.test(String(nTime)))
                return { ok: false, code: 20, error: 'Invalid nTime' };
            const t = parseInt(nTime, 16) * 1000;
            if (!Number.isFinite(t) || Math.abs(t - Date.now()) > 7200_000)
                return { ok: false, code: 20, error: 'nTime out of range' };
            if (t < job.tpl.baseTs) return { ok: false, code: 20, error: 'nTime below job base' };
            ts = t;
        }

        // ── Duplicate share (per miner) ───────────────────────
        const shareKey = `${jobId}:${miner.workerId}:${nonce}:${nTime || ''}`;
        if (miner.seenShares.has(shareKey))
            return { ok: false, code: 22, error: 'Duplicate share' };
        miner.seenShares.add(shareKey);
        if (miner.seenShares.size > 10_000) {
            const first = miner.seenShares.values().next().value;
            miner.seenShares.delete(first);
        }

        // ── Build the REAL candidate block for this miner + nonce ──
        const nonceInt = parseInt(nonce, 16);
        let candidate, gross;
        try {
            const built = buildCandidate(job.tpl, {
                minerAddress: miner.address, workerId: miner.workerId, jobId,
                nonce: nonceInt, timestamp: ts,
                poolFee: CFG.POOL_FEE, poolAddress: CFG.POOL_ADDRESS,
            });
            candidate = built.block;
            gross     = built.gross;
        } catch (e) {
            return { ok: false, code: 20, error: 'Cannot build candidate' };
        }

        // PoW hash of the canonical consensus header — identical to what core uses.
        const shareHash = candidate.powHash();

        // ── Share (vardiff) target ────────────────────────────
        const shareDiffTarget = this._diffToTarget(miner.difficulty);
        if (!this._hashMeetsTarget(shareHash, shareDiffTarget))
            return { ok: false, code: 23, error: 'Share below difficulty target', shareHash };

        // ── Real network block target (from the candidate's own bits) ──
        const blockFound = this._hashMeetsTarget(shareHash, candidate.target());
        if (blockFound) {
            this._submitBlock({ candidate, miner, gross });
        }
        return { ok: true, shareHash, blockFound };
    }

    // ── send block ───────────────────────────────────────────
    // `candidate` is the exact Block the miner solved. We only re-hash it with
    // the consensus hash and let addBlock() re-validate it. No rebuild, no drift.
    async _submitBlock({ candidate, miner, gross }) {
        try {
            candidate.hash = candidate.computeHash();

            const result = this.blockchain.addBlock(candidate);
            if (!result || !result.ok) {
                console.warn(`⚠️  [Stratum] block #${candidate.height} rejected by consensus — no payout. ` +
                    `Reason: ${result && result.error ? result.error : 'unknown'}`);
                return { ok: false, rejected: true, error: result && result.error };
            }

            console.log(`\n🎉 [Stratum] block #${candidate.height} accepted! miner: ${miner.workerId}`);

            this.mempool.removeConfirmed(candidate);
            this.emit('block:found', { block: candidate, miner: miner.workerId, address: miner.address });

            // PPLNS payouts — gross = subsidy + fees for this exact block.
            const payouts = this.shareDB.calcPPLNS(gross != null ? gross : Block.getReward(candidate.height));
            this.emit('payouts:ready', payouts);

            this._buildJob(true);
            return { ok: true, block: candidate };
        } catch (e) {
            console.error('[Stratum] Error send block:', e.message);
            return { ok: false, error: e.message };
        }
    }

    // ── ساخت Job ─────────────────────────────────────────────
    // One shared template per job; each miner gets its own candidate header
    // (its own coinbase → its own merkle root), so no two miners share a block.
    _buildJob(cleanJobs = false) {
        const jobId = crypto.randomBytes(4).toString('hex');
        const tpl   = buildTemplate(this.blockchain, this.mempool);
        const job = {
            id:        jobId,
            tpl,
            height:    tpl.height,
            prevHash:  tpl.prevHash,
            bits:      tpl.bits,
            difficulty: tpl.difficulty,
            cleanJobs,
            createdAt: Date.now(),
        };
        this.jobs.set(jobId, job);
        this.currentJob = job;

        for (const [id, j] of this.jobs) {
            if (Date.now() - j.createdAt > CFG.JOB_EXPIRY_MS * 2) this.jobs.delete(id);
        }

        for (const [, miner] of this.miners) {
            if (miner.authorized) this._sendJob(miner, job, cleanJobs);
        }
        return job;
    }

    // Per-miner job notify: send the canonical header fields the miner iterates
    // `nonce` over. The server can reproduce the exact block deterministically.
    _sendJob(miner, job, cleanJobs) {
        if (!miner.address) return; // header depends on the miner's coinbase
        const { block } = buildCandidate(job.tpl, {
            minerAddress: miner.address, workerId: miner.workerId, jobId: job.id,
            poolFee: CFG.POOL_FEE, poolAddress: CFG.POOL_ADDRESS,
        });
        const h = block.canonicalHeader();
        miner.send({
            id: null,
            method: 'mining.notify',
            params: [
                job.id,
                h.version, h.height, h.prevHash, h.merkleRoot,
                h.timestamp, h.bits, h.chainId,
                cleanJobs,
            ],
        });
    }

    _diffToTarget(difficulty) {
        return BigInt('0x' + 'f'.repeat(64)) >> BigInt(Math.max(0, Math.floor(difficulty)) * 4);
    }

    _hashMeetsTarget(hash, target) {
        return BigInt('0x' + hash) <= target;
    }

    // ── Ban ──────────────────────────────────────────────────
    _ban(ip, reason) {
        const until = Date.now() + CFG.BAN_DURATION_MS;
        this.banList.set(ip, until);
        console.warn(`🚫 [Stratum] ${ip} block  (${reason}) تا ${new Date(until).toISOString()}`);
    }

    unban(ip) {
        this.banList.delete(ip);
    }

    // ── API ──────────────────────────────────────────────────
    broadcastNewJob(cleanJobs = false) {
        this._buildJob(cleanJobs);
    }

    getStats() {
        const miners = [...this.miners.values()];
        const authorized = miners.filter(m => m.authorized);
        const poolStats  = this.shareDB.getPoolStats();

        return {
            connected:    miners.length,
            authorized:   authorized.length,
            bannedIPs:    this.banList.size,
            hashrate:     poolStats.hashrate1h,
            validShares:  poolStats.validShares,
            invalidShares:poolStats.invalidShares,
            currentJob:   this.currentJob?.id,
            miners: authorized.map(m => ({
                workerId:   m.workerId,
                ip:         m.ip,
                difficulty: m.difficulty,
                ...this.shareDB.getWorkerStats(m.workerId),
            })),
        };
    }

    getMiners() { return [...this.miners.values()]; }
    getBanList() { return [...this.banList.entries()].map(([ip, until]) => ({ ip, until: new Date(until) })); }
}

module.exports = { StratumServer };
