/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  ⛏️  SPN Coin Stratum-over-WebSocket v2.0
//
//  Replaces raw TCP with WebSocket transport so miners can
//  connect via:  ws://YOUR_HOST/stratum  (or wss:// on TLS)
//
//  Works on:  Vercel ✅  | VPS ✅  | Docker ✅
//
//  Compatible clients:
//   - Any miner with WebSocket Stratum support (XMRig, CGMiner-WS)
//   - Our built-in browser miner (miner.html)
//   - Custom miners using the WebSocket bridge
//
//  JSON-RPC protocol is identical to Stratum v1 — only the
//  transport layer changes from TCP newline-framing to
//  WebSocket message framing.
// ════════════════════════════════════════════════════════════
"use strict";

const crypto       = require("crypto");
const EventEmitter = require("events");
const { WebSocketServer } = require("ws");
const { meetsTarget, powHash } = require("../blockchain/crypto");
const { Block } = require("../blockchain/blockchain");
const { buildTemplate, buildCandidate } = require("./blocktemplate");

// ── Pool configuration ────────────────────────────────────────
const CFG = {
    POOL_FEE:           parseFloat(process.env.POOL_FEE)         || 0.01,
    POOL_ADDRESS:       process.env.POOL_ADDRESS                  || "POOL_WALLET_ADDRESS",
    VARDIFF_MIN:        parseInt(process.env.VARDIFF_MIN)         || 1,
    VARDIFF_MAX:        parseInt(process.env.VARDIFF_MAX)         || 32,
    VARDIFF_TARGET_MS:  parseInt(process.env.VARDIFF_TARGET_MS)   || 15_000,
    VARDIFF_WINDOW:     parseInt(process.env.VARDIFF_WINDOW)      || 10,
    JOB_EXPIRY_MS:      parseInt(process.env.JOB_EXPIRY_MS)      || 300_000,
    MAX_SHARES_PER_SEC: parseInt(process.env.MAX_SHARES_SEC)      || 20,
    BAN_INVALID_SHARES: parseInt(process.env.BAN_INVALID)         || 10,
    BAN_DURATION_MS:    parseInt(process.env.BAN_DURATION)        || 600_000,
    TIMEOUT_MS:         parseInt(process.env.MINER_TIMEOUT_MS)    || 300_000,
    MAX_CONNECTIONS:    parseInt(process.env.MAX_MINERS)           || 1000,
    EXTRANONCE1_SIZE:   4,
    EXTRANONCE2_SIZE:   4,
    PPLNS_WINDOW:       parseInt(process.env.PPLNS_WINDOW)        || 100_000,
};

// ── Share Database ────────────────────────────────────────────
class ShareDB {
    constructor() {
        this.shares       = [];
        this.maxShares    = CFG.PPLNS_WINDOW * 10;
        this.totalValid   = 0;
        this.totalInvalid = 0;
    }
    add(share) {
        this.shares.push({ ...share, ts: Date.now() });
        if (share.valid) this.totalValid++; else this.totalInvalid++;
        if (this.shares.length > this.maxShares) this.shares.shift();
    }
    calcPPLNS(reward) {
        const window   = this.shares.slice(-CFG.PPLNS_WINDOW).filter(s => s.valid);
        if (!window.length) return {};
        const byWorker = {};
        let totalDiff  = 0;
        for (const s of window) {
            byWorker[s.workerId] = (byWorker[s.workerId] || 0) + s.diff;
            totalDiff += s.diff;
        }
        const result = {};
        for (const [w, d] of Object.entries(byWorker))
            result[w] = (BigInt(Math.round(d / totalDiff * 1e8)) * BigInt(reward)) / 100_000_000n;
        return result;
    }
}

// ── Miner WebSocket connection ────────────────────────────────
class MinerConn {
    constructor(ws, ip, extraNonce1) {
        this.ws           = ws;
        this.ip           = ip;
        this.id           = crypto.randomBytes(8).toString("hex");
        this.extraNonce1  = extraNonce1;
        this.workerId     = null;
        this.authorized   = false;
        this.difficulty   = CFG.VARDIFF_MIN;
        this.shareTimes   = [];   // for vardiff
        this.seenShares   = new Set(); // duplicate-share protection
        this.address      = null;
        this.lastActivity = Date.now();
        this.invalidCount = 0;
        this._timeoutTimer = null;
        this._vardiffTimer = null;
    }

    send(method, params = null, id = null) {
        if (this.ws.readyState !== 1) return; // OPEN
        const msg = params !== null
            ? { jsonrpc: "2.0", method, params, id }
            : { jsonrpc: "2.0", result: params === null ? true : params, id };
        try { this.ws.send(JSON.stringify(msg)); } catch {}
    }

    respond(id, result, error = null) {
        if (this.ws.readyState !== 1) return;
        try { this.ws.send(JSON.stringify({ id, result, error })); } catch {}
    }

    startTimers() {
        this._timeoutTimer = setInterval(() => {
            if (Date.now() - this.lastActivity > CFG.TIMEOUT_MS) {
                this.destroy("timeout");
            }
        }, 30_000);

        this._vardiffTimer = setInterval(() => this._adjustDiff(), 30_000);
    }

    _adjustDiff() {
        const now    = Date.now();
        const recent = this.shareTimes.filter(t => now - t < 60_000);
        this.shareTimes = recent;
        if (recent.length < 3) return;
        const avg = (recent[recent.length-1] - recent[0]) / Math.max(recent.length-1, 1);
        if (avg < CFG.VARDIFF_TARGET_MS * 0.7 && this.difficulty < CFG.VARDIFF_MAX) {
            this.difficulty = Math.min(this.difficulty * 2, CFG.VARDIFF_MAX);
            this.send("mining.set_difficulty", [this.difficulty]);
        } else if (avg > CFG.VARDIFF_TARGET_MS * 1.4 && this.difficulty > CFG.VARDIFF_MIN) {
            this.difficulty = Math.max(Math.floor(this.difficulty / 2), CFG.VARDIFF_MIN);
            this.send("mining.set_difficulty", [this.difficulty]);
        }
    }

    destroy(_reason = "") {
        clearInterval(this._timeoutTimer);
        clearInterval(this._vardiffTimer);
        try { this.ws.close(); } catch {}
    }
}

// ══════════════════════════════════════════════════════════════
//  STRATUM-WS SERVER
// ══════════════════════════════════════════════════════════════
class StratumWSServer extends EventEmitter {
    constructor({ blockchain, mempool, wallet }) {
        super();
        this.blockchain = blockchain;
        this.mempool    = mempool;
        this.wallet     = wallet;
        this.miners     = new Map();
        this.jobs       = new Map();
        this.currentJob = null;
        this.banList    = new Map();   // ip → unbanAt
        this.shareDB    = new ShareDB();
        this.wss        = null;
        this._extraNonce1Counter = 0;
        this._extraNonceMap = new Map();
    }

    // ── Attach to an existing HTTP/Express server ─────────────
    // Call this INSTEAD of start(port) when on Vercel/serverless
    attachTo(httpServer, path = "/stratum") {
        // Use noServer mode and route by path, so this can coexist with the
        // real-time feed's WebSocket server on the same HTTP server without
        // both racing on the 'upgrade' event (which corrupts frames).
        this.wss = new WebSocketServer({ noServer: true });
        httpServer.on("upgrade", (req, socket, head) => {
            let pathname = "/";
            try { pathname = new URL(req.url, "http://x").pathname; } catch {}
            if (pathname !== path) return; // not ours
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit("connection", ws, req);
            });
        });
        this._bindWSS();
        console.log(`⛏️  [Stratum-WS] Attached to HTTP server at ${path}`);
        setTimeout(() => this._buildJob(true), 1000);
    }

    // ── Standalone WebSocket server (VPS mode) ────────────────
    start(port = 3333) {
        this.wss = new WebSocketServer({ port });
        this._bindWSS();
        console.log(`⛏️  [Stratum-WS] Listening on ws://0.0.0.0:${port}`);
        setTimeout(() => this._buildJob(true), 1000);
    }

    // ── Extra dedicated WS port (for miners that use port 3333) ─
    startExtra(port) {
        if (this._extraWss) return;
        this._extraWss = new WebSocketServer({ port });
        this._extraWss.on('connection', (ws, req) => {
            const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
                       .split(',')[0].trim().replace('::ffff:','');
            this._onConnect(ws, ip);
        });
        this._extraWss.on('error', err => console.error('[Stratum-WS Extra] ❌', err.message));
        console.log(`⛏️  [Stratum-WS] Extra port ws://0.0.0.0:${port} (for legacy miners)`);
    }

    _bindWSS() {
        this.wss.on("connection", (ws, req) => {
            const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
                       .split(",")[0].trim().replace("::ffff:", "");
            this._onConnect(ws, ip);
        });
        this.wss.on("error", err => console.error("[Stratum-WS] ❌", err.message));
    }

    _onConnect(ws, ip) {
        // Ban check
        if (this.banList.has(ip)) {
            if (Date.now() < this.banList.get(ip)) { ws.close(); return; }
            this.banList.delete(ip);
        }
        if (this.miners.size >= CFG.MAX_CONNECTIONS) { ws.close(); return; }

        const extraNonce1 = this._extraNonceMap.get(ip)
            || (++this._extraNonce1Counter).toString(16).padStart(CFG.EXTRANONCE1_SIZE * 2, "0");
        this._extraNonceMap.set(ip, extraNonce1);

        const miner = new MinerConn(ws, ip, extraNonce1);
        this.miners.set(miner.id, miner);

        ws.on("message", raw => {
            miner.lastActivity = Date.now();
            let msg;
            try { msg = JSON.parse(raw.toString()); }
            catch { miner.destroy("invalid json"); return; }
            this._handleMessage(msg, miner);
        });

        ws.on("close", () => {
            this.miners.delete(miner.id);
            miner.destroy("ws close");
            this.emit("miner:disconnect", miner);
        });

        ws.on("error", () => miner.destroy("ws error"));
        miner.startTimers();
        console.log(`🔌 [Stratum-WS] Connect: ${ip} (${this.miners.size} active)`);
    }

    _handleMessage(msg, miner) {
        const { id, method, params = [] } = msg;

        switch (method) {
            case "mining.subscribe": {
                const sessionId = crypto.randomBytes(4).toString("hex");
                miner.respond(id, [
                    [["mining.set_difficulty", sessionId], ["mining.notify", sessionId]],
                    miner.extraNonce1,
                    CFG.EXTRANONCE2_SIZE
                ]);
                if (this.currentJob) this._sendJob(miner, true);
                break;
            }
            case "mining.authorize": {
                const [workerName] = params;
                const [addr] = (workerName || "").split(".");
                if (!addr || addr.length < 20) {
                    miner.respond(id, false, { code: 24, message: "Invalid address" });
                    miner.destroy("invalid address");
                    return;
                }
                miner.workerId  = workerName;
                miner.address   = addr;
                miner.authorized = true;
                miner.respond(id, true);
                miner.send("mining.set_difficulty", [miner.difficulty]);
                if (this.currentJob) this._sendJob(miner, true);
                this.emit("miner:authorized", { workerId: workerName, ip: miner.ip });
                console.log(`✅ [Stratum-WS] Auth: ${workerName} (${miner.ip})`);
                break;
            }
            case "mining.submit": {
                if (!miner.authorized) { miner.respond(id, false, { code: 24, message: "Not authorized" }); return; }
                // Unified protocol: submit = [workerName, jobId, nonce, ntime?]
                const [_workerName, jobId, nonce, ntime] = params;
                this._handleShare(miner, { jobId, nonce, ntime }, id);
                break;
            }
            case "mining.extranonce.subscribe":
                miner.respond(id, true);
                break;
            default:
                miner.respond(id, null, { code: 20, message: `Unknown method: ${method}` });
        }
    }

    _handleShare(miner, { jobId, nonce, ntime }, id) {
        const job = this.jobs.get(jobId);
        if (!job) { miner.respond(id, false, { code: 21, message: "Job not found" }); return; }
        if (Date.now() - job.createdAt > CFG.JOB_EXPIRY_MS) {
            miner.respond(id, false, { code: 21, message: "Job expired" }); return;
        }
        if (!miner.authorized || !miner.address) {
            miner.respond(id, false, { code: 24, message: "Unauthorized miner" }); return;
        }
        if (typeof nonce !== "string" || !/^[0-9a-fA-F]{1,8}$/.test(nonce)) {
            miner.respond(id, false, { code: 20, message: "Invalid nonce" }); return;
        }

        // Optional, bounded nTime roll.
        let ts = null;
        if (ntime != null && ntime !== "") {
            if (!/^[0-9a-fA-F]{1,12}$/.test(String(ntime))) { miner.respond(id, false, { code: 20, message: "Invalid nTime" }); return; }
            const t = parseInt(ntime, 16) * 1000;
            if (!Number.isFinite(t) || Math.abs(t - Date.now()) > 7200_000 || t < job.tpl.baseTs) {
                miner.respond(id, false, { code: 20, message: "nTime out of range" }); return;
            }
            ts = t;
        }

        // Rate limit
        const now = Date.now();
        miner.shareTimes = miner.shareTimes.filter(t => now - t < 1000);
        if (miner.shareTimes.length >= CFG.MAX_SHARES_PER_SEC) {
            miner.respond(id, false, { code: 22, message: "Too many shares" }); return;
        }
        miner.shareTimes.push(now);

        // Duplicate share (per miner)
        const shareKey = `${jobId}:${miner.workerId}:${nonce}:${ntime || ""}`;
        if (miner.seenShares.has(shareKey)) { miner.respond(id, false, { code: 22, message: "Duplicate share" }); return; }
        miner.seenShares.add(shareKey);
        if (miner.seenShares.size > 10_000) { const f = miner.seenShares.values().next().value; miner.seenShares.delete(f); }

        // Build the REAL candidate block (canonical consensus header) and hash it.
        let candidate, gross;
        try {
            const built = buildCandidate(job.tpl, {
                minerAddress: miner.address, workerId: miner.workerId, jobId,
                nonce: parseInt(nonce, 16), timestamp: ts,
                poolFee: CFG.POOL_FEE, poolAddress: CFG.POOL_ADDRESS,
            });
            candidate = built.block; gross = built.gross;
        } catch (e) {
            miner.respond(id, false, { code: 20, message: "Cannot build candidate" }); return;
        }
        const hash = candidate.powHash();

        // Share (vardiff) difficulty gate.
        if (!meetsTarget(hash, miner.difficulty)) {
            miner.invalidCount++;
            this.shareDB.add({ workerId: miner.workerId, shareHash: hash, diff: miner.difficulty, valid: false });
            if (miner.invalidCount >= CFG.BAN_INVALID_SHARES) {
                this.banList.set(miner.ip, Date.now() + CFG.BAN_DURATION_MS);
                miner.destroy("too many invalid shares");
            }
            miner.respond(id, false, { code: 23, message: "Low difficulty share" });
            return;
        }

        // Valid share
        this.shareDB.add({ workerId: miner.workerId, shareHash: hash, diff: miner.difficulty, valid: true });
        miner.respond(id, true);
        this.emit("share:valid", { workerId: miner.workerId, hash, difficulty: miner.difficulty });

        // Block found? Score against the candidate's REAL consensus target.
        if (this._meetsTargetBig(hash, candidate.target())) {
            this._submitBlock({ candidate, miner, gross });
        }
    }

    _meetsTargetBig(hashHex, target) {
        try { return typeof target === "bigint" && target > 0n && BigInt("0x" + hashHex) <= target; }
        catch { return false; }
    }

    async _submitBlock({ candidate, miner, gross }) {
        try {
            candidate.hash = candidate.computeHash();
            const result = this.blockchain.addBlock(candidate);
            if (!result || !result.ok) {
                console.warn(`⚠️  [Stratum-WS] block #${candidate.height} rejected by consensus — no payout. ` +
                    `Reason: ${result && result.error ? result.error : "unknown"}`);
                return;
            }
            console.log(`🎉 [Stratum-WS] block #${candidate.height} accepted by ${miner.workerId}!`);
            if (this.mempool && this.mempool.removeConfirmed) this.mempool.removeConfirmed(candidate);
            this.emit("block:found", { block: candidate, hash: candidate.hash, workerName: miner.workerId, address: miner.address });
            if (this.shareDB.calcPPLNS) {
                this.emit("payouts:ready", this.shareDB.calcPPLNS(gross != null ? gross : Block.getReward(candidate.height)));
            }
            this._buildJob(true);
        } catch (e) {
            console.error("[Stratum-WS] Error submitting block:", e.message);
        }
    }

    _buildJob(cleanJobs = false) {
        const tpl   = buildTemplate(this.blockchain, this.mempool);
        const jobId = crypto.randomBytes(4).toString("hex");
        const job   = {
            id:        jobId,
            tpl,
            prevHash:  tpl.prevHash,
            bits:      tpl.bits,
            height:    tpl.height,
            createdAt: Date.now(),
        };

        this.jobs.set(jobId, job);
        this.currentJob = job;

        // Expire old jobs
        for (const [id, j] of this.jobs) {
            if (Date.now() - j.createdAt > CFG.JOB_EXPIRY_MS) this.jobs.delete(id);
        }

        // Broadcast to all authorized miners
        let notified = 0;
        for (const miner of this.miners.values()) {
            if (miner.authorized) { this._sendJob(miner, cleanJobs); notified++; }
        }
        if (notified > 0)
            console.log(`📢 [Stratum-WS] New job ${jobId} broadcast to ${notified} miners`);
    }

    _sendJob(miner, cleanJobs) {
        const j = this.currentJob;
        if (!j || !miner.address) return;
        const { block } = buildCandidate(j.tpl, {
            minerAddress: miner.address, workerId: miner.workerId, jobId: j.id,
            poolFee: CFG.POOL_FEE, poolAddress: CFG.POOL_ADDRESS,
        });
        const h = block.canonicalHeader();
        miner.send("mining.notify", [
            j.id, h.version, h.height, h.prevHash, h.merkleRoot,
            h.timestamp, h.bits, h.chainId, cleanJobs,
        ]);
    }

    broadcastNewJob(cleanJobs = false) { this._buildJob(cleanJobs); }

    getStats() {
        const miners = [...this.miners.values()].filter(m => m.authorized);
        const totalHashrate = miners.reduce((s, m) => s + (m.difficulty * 1000 / CFG.VARDIFF_TARGET_MS * 1000), 0);
        return {
            connected:     this.miners.size,
            authorized:    miners.length,
            hashrate:      Math.round(totalHashrate),
            validShares:   this.shareDB.totalValid,
            invalidShares: this.shareDB.totalInvalid,
            currentJob:    this.currentJob?.id,
            bannedIPs:     this.banList.size,
            miners: miners.map(m => ({
                workerId:   m.workerId,
                ip:         m.ip,
                difficulty: m.difficulty,
                valid:      m.shareTimes.filter(t => Date.now()-t < 300_000).length,
                invalid:    m.invalidCount,
                hashrate:   Math.round(m.difficulty * 1000 / CFG.VARDIFF_TARGET_MS * 1000),
                since:      m.lastActivity,
            })),
        };
    }

    getBanList() {
        return [...this.banList.entries()].map(([ip, until]) => ({ ip, until }));
    }

    unban(ip) { this.banList.delete(ip); }
}

module.exports = { StratumWSServer };
