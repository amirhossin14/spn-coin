/**
 * stratum-btc.js — a STANDARD Bitcoin Stratum TCP server (Phase 2/3).
 *
 * Speaks the real ckpool/cpuminer wire protocol so an actual SHA-256 ASIC
 * (Whatsminer, Antminer, …) can connect: mining.subscribe / mining.authorize /
 * mining.set_difficulty / mining.notify / mining.submit. The byte-exact work is
 * done by stratum-btc-core.js (proven against Bitcoin genesis + a simulated
 * miner). This file is the transport + session + vardiff layer around it.
 *
 * Requires Block.BINARY_HEADER mode (Bitcoin-binary consensus). Enable with
 * BINARY_HEADER=1. Until a real ASIC has verified interop, treat as experimental.
 */
'use strict';
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const S = require('./stratum-btc-core');
const btc = require('../blockchain/btc-serialize');

// Bitcoin "difficulty-1" target (share difficulty is diff1 / D).
const DIFF1 = BigInt('0x00000000FFFF0000000000000000000000000000000000000000000000000000');
const EXTRANONCE2_SIZE = 4;

const CFG = {
    startDiff:    parseFloat(process.env.STRATUM_START_DIFF) || 1,
    vardiffTargetSec: parseInt(process.env.STRATUM_VARDIFF_SEC, 10) || 15, // aim: 1 share / 15s
    minDiff:      parseFloat(process.env.STRATUM_MIN_DIFF) || 1,
    maxDiff:      parseFloat(process.env.STRATUM_MAX_DIFF) || 1e12,
    poolAddress:  process.env.POOL_ADDRESS || '',
};

/** Encode a block hash (display hex) into Stratum mining.notify prevhash format:
 *  internal (LE) order, then bytes swapped within each 4-byte word. This is the
 *  ckpool/cpuminer convention. ⚠️ Verify against a real ASIC before production. */
function prevhashToStratum(displayHex) {
    const internal = Buffer.from(displayHex, 'hex').reverse(); // full LE
    const out = Buffer.alloc(32);
    for (let i = 0; i < 8; i++) {
        const w = internal.subarray(i * 4, i * 4 + 4);
        Buffer.from(w).reverse().copy(out, i * 4);
    }
    return out.toString('hex');
}
/** Inverse of prevhashToStratum → the 32-byte header prevhash field (internal hex). */
function stratumPrevhashToInternal(stratumHex) {
    const b = Buffer.from(stratumHex, 'hex');
    const out = Buffer.alloc(32);
    for (let i = 0; i < 8; i++) {
        const w = b.subarray(i * 4, i * 4 + 4);
        Buffer.from(w).reverse().copy(out, i * 4);
    }
    return Buffer.from(out).reverse().toString('hex');
}

/** share difficulty → 256-bit target (BigInt). */
function diffToTarget(diff) {
    if (diff <= 0) return DIFF1;
    // scale to keep integer math precise for fractional diffs
    return (DIFF1 * 1000000n) / BigInt(Math.max(1, Math.round(diff * 1000000)));
}

class StratumBtcServer extends EventEmitter {
    constructor({ blockchain, mempool, port = 3333, poolAddress } = {}) {
        super();
        this.blockchain = blockchain;
        this.mempool = mempool;
        this.port = port;
        this.poolAddress = poolAddress || CFG.poolAddress;
        this.conns = new Set();
        this._en1 = 0;
        this._jobId = 0;
        this.jobs = new Map();          // jobId → job template
    }

    start() {
        this.server = net.createServer((sock) => this._onConn(sock));
        this.server.listen(this.port, () => this.emit('listening', this.port));
        // Don't let the listener alone keep the process alive (matters for tests
        // and clean shutdown). In production the HTTP server keeps the loop up.
        if (this.server.unref) this.server.unref();
        return this;
    }
    stop() { try { this.server && this.server.close(); } catch {} for (const c of this.conns) try { c.socket.destroy(); } catch {} }

    _nextEN1() { this._en1 = (this._en1 + 1) >>> 0; return this._en1.toString(16).padStart(8, '0'); }

    _onConn(socket) {
        const conn = {
            socket, extraNonce1: this._nextEN1(), authorized: false, address: null,
            difficulty: CFG.startDiff, buf: '', seen: new Set(), shareTimes: [], job: null,
        };
        this.conns.add(socket);
        if (socket.unref) socket.unref(); // never keep the process alive on its own
        socket.on('data', (d) => {
            conn.buf += d.toString('utf8');
            let i;
            while ((i = conn.buf.indexOf('\n')) >= 0) {
                const line = conn.buf.slice(0, i).trim();
                conn.buf = conn.buf.slice(i + 1);
                if (line) { try { this._handle(conn, JSON.parse(line)); } catch (e) { /* ignore bad line */ } }
            }
        });
        socket.on('error', () => {});
        socket.on('close', () => this.conns.delete(socket));
    }

    _send(conn, obj) { try { conn.socket.write(JSON.stringify(obj) + '\n'); } catch {} }
    _result(conn, id, result, error = null) { this._send(conn, { id, result, error }); }

    _handle(conn, msg) {
        switch (msg.method) {
            case 'mining.subscribe': {
                const subId = crypto.randomBytes(4).toString('hex');
                this._result(conn, msg.id, [
                    [['mining.set_difficulty', subId], ['mining.notify', subId]],
                    conn.extraNonce1, EXTRANONCE2_SIZE,
                ]);
                break;
            }
            case 'mining.authorize': {
                const user = (msg.params && msg.params[0]) || '';
                conn.address = String(user).split('.')[0]; // "SPN1addr.worker" → address
                conn.authorized = !!conn.address;
                this._result(conn, msg.id, conn.authorized);
                if (conn.authorized) { this._setDifficulty(conn); this._notify(conn, true); }
                break;
            }
            case 'mining.submit': {
                this._onSubmit(conn, msg.id, msg.params || []);
                break;
            }
            default:
                if (msg.id != null) this._result(conn, msg.id, true);
        }
    }

    _setDifficulty(conn) { this._send(conn, { id: null, method: 'mining.set_difficulty', params: [conn.difficulty] }); }

    // Build a job template bound to the current tip, and remember it for reconstruction.
    _buildJob(conn) {
        const tip = this.blockchain.tip;
        const height = this.blockchain.height + 1;
        const difficulty = this.blockchain.getNextDifficulty ? this.blockchain.getNextDifficulty() : tip.difficulty;
        const nbits = parseInt(this.blockchain.getNextBits ? this.blockchain.getNextBits()
                        : (typeof tip.bits === 'string' ? tip.bits : '207fffff'), 16) || 0x207fffff;
        const reward = (this.blockchain.constructor.getReward
            ? this.blockchain.constructor.getReward(height) : 5000000000n);
        const spk = btc.addressToScriptPubKey(conn.address);
        const cb = S.buildCoinbase({
            height, scriptPubKeyHex: spk, reward,
            extraNonce1Size: 4, extraNonce2Size: EXTRANONCE2_SIZE, tag: 'SPN',
        });
        const jobId = (++this._jobId).toString(16);
        const job = {
            jobId, height, version: 1, nbits,
            prevDisplay: tip.hash,
            prevInternal: S.toInternalHex(tip.hash),
            coinbase1: cb.coinbase1, coinbase2: cb.coinbase2,
            merkleBranch: [],                    // coinbase-only for now
            ntime: Math.floor(Date.now() / 1000),
            reward,
        };
        this.jobs.set(jobId, job);
        // keep only recent jobs
        if (this.jobs.size > 20) { const first = this.jobs.keys().next().value; this.jobs.delete(first); }
        conn.job = job;
        return job;
    }

    _notify(conn, cleanJobs) {
        const j = this._buildJob(conn);
        this._send(conn, {
            id: null, method: 'mining.notify',
            params: [
                j.jobId,
                prevhashToStratum(j.prevDisplay),
                j.coinbase1, j.coinbase2, j.merkleBranch,
                j.version.toString(16).padStart(8, '0'),
                j.nbits.toString(16).padStart(8, '0'),
                j.ntime.toString(16).padStart(8, '0'),
                cleanJobs,
            ],
        });
    }

    _onSubmit(conn, id, params) {
        const [, jobId, extraNonce2, ntimeHex, nonceHex] = params;
        const job = this.jobs.get(jobId);
        if (!job) return this._result(conn, id, false, [21, 'Job not found', null]);
        if (!conn.authorized) return this._result(conn, id, false, [24, 'Unauthorized', null]);

        const key = `${jobId}:${extraNonce2}:${ntimeHex}:${nonceHex}`;
        if (conn.seen.has(key)) return this._result(conn, id, false, [22, 'Duplicate share', null]);
        conn.seen.add(key);

        const ntime = parseInt(ntimeHex, 16), nonce = parseInt(nonceHex, 16);
        const coinbase = S.assembleCoinbase(job.coinbase1, conn.extraNonce1, extraNonce2, job.coinbase2);
        const root = S.merkleRootFromBranch(S.coinbaseHash(coinbase), job.merkleBranch);
        const hash = S.headerHash({ version: job.version, prevHashInternalHex: job.prevInternal,
            merkleRootInternal: root, ntime, nbits: job.nbits, nonce });
        const hashVal = BigInt('0x' + hash);

        // share difficulty gate
        if (hashVal > diffToTarget(conn.difficulty))
            return this._result(conn, id, false, [23, 'Low difficulty share', null]);

        this._result(conn, id, true);
        this._recordShare(conn);
        this.emit('share', { address: conn.address, hash, difficulty: conn.difficulty });

        // network target → real block found
        const netTarget = this._bitsToTarget(job.nbits);
        if (hashVal <= netTarget) {
            this.emit('block', { hash, job, coinbaseHex: coinbase, extraNonce2, ntime, nonce, address: conn.address });
            this._notify(conn, true); // fresh job
        }
    }

    _bitsToTarget(nbits) {
        const exp = nbits >>> 24;
        const mant = BigInt(nbits & 0x007fffff);
        return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
    }

    // ── vardiff: keep ~1 share / vardiffTargetSec ──────────────
    _recordShare(conn) {
        const now = Date.now();
        conn.shareTimes.push(now);
        conn.shareTimes = conn.shareTimes.filter(t => now - t < 60000);
        if (conn.shareTimes.length < 4) return;
        const span = (conn.shareTimes[conn.shareTimes.length - 1] - conn.shareTimes[0]) / 1000;
        const rate = span > 0 ? (conn.shareTimes.length - 1) / span : 0; // shares/sec
        const target = 1 / CFG.vardiffTargetSec;
        if (rate > target * 1.5 || rate < target * 0.5) {
            let d = conn.difficulty * (rate / target);
            d = Math.max(CFG.minDiff, Math.min(CFG.maxDiff, d));
            if (Math.abs(d - conn.difficulty) / conn.difficulty > 0.2) {
                conn.difficulty = d;
                conn.shareTimes = [];
                this._setDifficulty(conn);
                this._notify(conn, false);
            }
        }
    }
}

module.exports = { StratumBtcServer, prevhashToStratum, stratumPrevhashToInternal, diffToTarget };
