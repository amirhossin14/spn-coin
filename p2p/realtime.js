/**
 * ────────────────────────────────────────────────────────────
 *  realtime.js — public WebSocket feed for live UI updates
 * ────────────────────────────────────────────────────────────
 *
 *  Attaches a WebSocket server to the existing HTTP(S) server on the
 *  path /ws and broadcasts blockchain events (new block, new pending
 *  transaction, chain-tip changes) to connected browsers. This lets the
 *  dashboard, explorer and wallet update instantly instead of polling.
 *
 *  Protocol (JSON messages, server → client):
 *    { type: "hello",  height, network, ts }         on connect
 *    { type: "block",  height, hash, txCount, ts }   on new block
 *    { type: "tx",     txid, from, to, amount, ts }  on new pending tx
 *    { type: "mempool", size, ts }                   on mempool change
 *    { type: "pong", ts }                            reply to client ping
 *
 *  Client → server (optional):
 *    { type: "ping" }                                keep-alive
 *    { type: "subscribe", channels: ["block","tx"] } filter (default: all)
 *
 *  Zero new dependencies — reuses the `ws` package already in the project.
 */
'use strict';

const { WebSocketServer } = require('ws');

const HEARTBEAT_MS = 30_000; // ping idle clients so dead sockets are dropped

/**
 * @param {http.Server} server   the HTTP/HTTPS server to attach to
 * @param {object}      ctx      { blockchain, mempool, webhooks, network }
 */
function attachRealtime(server, ctx = {}) {
  const { blockchain, mempool, webhooks, network = 'testnet' } = ctx;

  // IMPORTANT: another WebSocketServer (Stratum) may share this HTTP server.
  // If two servers both attach with { server }, they race on the 'upgrade'
  // event and corrupt frames ("RSV1 must be clear"). So we use noServer mode
  // and route upgrades by path ourselves, leaving other paths for others.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
    if (pathname !== '/ws') return; // not ours — let Stratum (or others) handle it
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  function safeSend(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  /** Broadcast to every connected client that is subscribed to `channel`. */
  function broadcast(channel, payload) {
    const msg = JSON.stringify({ ...payload, ts: Date.now() });
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      // If the client set channel filters, honor them; otherwise send all.
      if (ws._channels && !ws._channels.has(channel)) continue;
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws._channels = null; // null = all channels
    clients.add(ws);

    // Greet with the current chain tip so the UI can sync immediately.
    safeSend(ws, {
      type: 'hello',
      height: blockchain?.height ?? null,
      network,
      clients: clients.size,
      ts: Date.now(),
    });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString().slice(0, 1000)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ping') return safeSend(ws, { type: 'pong', ts: Date.now() });
      if (m.type === 'subscribe' && Array.isArray(m.channels)) {
        // Whitelist the channels a client may filter on.
        const allowed = new Set(['block', 'tx', 'mempool']);
        ws._channels = new Set(m.channels.filter((c) => allowed.has(c)));
        safeSend(ws, { type: 'subscribed', channels: [...ws._channels], ts: Date.now() });
      }
    });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // ── Heartbeat: drop sockets that stopped responding ──
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) { clients.delete(ws); try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { clients.delete(ws); }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  // ── Wire up blockchain events → broadcasts ──
  if (webhooks && typeof webhooks.on === 'function') {
    webhooks.on('block', (b) => {
      broadcast('block', {
        type: 'block',
        height: b?.height,
        hash: b?.hash,
        txCount: b?.txCount ?? 0,
        source: b?.source,
      });
      // A block also clears/updates the mempool — nudge clients.
      broadcast('mempool', { type: 'mempool', size: mempool?.size?.() ?? mempool?.pending?.length ?? 0 });
    });
  }

  /**
   * Called by server.js when a new pending transaction is accepted, so the
   * feed reflects unconfirmed activity too. Best-effort and never throws.
   */
  function publishTx(tx) {
    try {
      const outs = tx?.outputs || [];
      broadcast('tx', {
        type: 'tx',
        txid: tx?.id || tx?.txid,
        to: outs[0]?.address || null,
        amount: outs.reduce((s, o) => s + Number(o.amount || 0), 0),
        outputs: outs.length,
      });
      broadcast('mempool', { type: 'mempool', size: mempool?.size?.() ?? 0 });
    } catch { /* best-effort */ }
  }

  console.log('🔌 [WS] Real-time feed active on /ws');

  return { wss, broadcast, publishTx, clientCount: () => clients.size };
}

module.exports = { attachRealtime };
