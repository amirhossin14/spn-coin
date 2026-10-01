/**
 * Full standard-Stratum wire test: a fake miner connects over a REAL TCP socket
 * and runs subscribe → authorize → notify → mine → submit, exactly like a real
 * ASIC. Proves the server speaks the protocol and reconstructs the share.
 * Run: node --test test/stratum-btc-server.test.js
 */
'use strict';
process.env.CHAIN_ID = '3';
process.env.STRATUM_START_DIFF = '0.0000001';  // tiny share diff so the test is instant

const { describe, test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { StratumBtcServer, prevhashToStratum, stratumPrevhashToInternal } = require('../mining-pool/stratum-btc');
const S = require('../mining-pool/stratum-btc-core');
const { Wallet } = require('../wallet/wallet');

// Minimal blockchain mock: one tip, an easy nbits (huge target).
function mockChain() {
    const tip = { hash: 'ab'.repeat(32), difficulty: 1, bits: '207fffff', timestamp: Date.now() };
    return {
        tip, height: 0,
        getNextDifficulty: () => 1,
        getNextBits: () => '207fffff',
        constructor: { getReward: () => 5000000000n },
    };
}

describe('Standard Stratum TCP server', () => {

    test('prevhash stratum encoding round-trips to internal order', () => {
        const display = 'ab'.repeat(32);
        const strat = prevhashToStratum(display);
        assert.strictEqual(stratumPrevhashToInternal(strat), S.toInternalHex(display));
    });

    test('a fake ASIC completes subscribe→authorize→notify→submit and finds a block', async () => {
        const srv = new StratumBtcServer({ blockchain: mockChain(), mempool: {}, port: 0 }).start();
        await new Promise(res => srv.on('listening', res));
        const port = srv.server.address().port;
        const minerAddr = new Wallet().address;

        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout')), 12000);
            let sock;
            srv.once('block', (b) => { clearTimeout(timer); try { sock.destroy(); } catch {} resolve(b); });

            sock = net.connect(port, '127.0.0.1');
            let buf = '', en1 = null, id = 1, submitted = false;
            sock.on('connect', () => sock.write(JSON.stringify({ id: id++, method: 'mining.subscribe', params: [] }) + '\n'));
            sock.on('error', reject);
            sock.on('data', (d) => {
                buf += d.toString();
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                    if (!line) continue;
                    const msg = JSON.parse(line);
                    if (msg.id === 1 && Array.isArray(msg.result)) {
                        en1 = msg.result[1];
                        sock.write(JSON.stringify({ id: id++, method: 'mining.authorize', params: [minerAddr + '.w1', 'x'] }) + '\n');
                    } else if (msg.method === 'mining.notify' && !submitted) {
                        const [jobId, prevStrat, cb1, cb2, branch, verHex, nbitsHex, ntimeHex] = msg.params;
                        // Exactly what an ASIC does: assemble coinbase, fold merkle
                        // branch, build the 80-byte header, ROLL THE NONCE.
                        const coinbase = S.assembleCoinbase(cb1, en1, '00000000', cb2);
                        const root = S.merkleRootFromBranch(S.coinbaseHash(coinbase), branch);
                        const prevInternal = stratumPrevhashToInternal(prevStrat);
                        const ntime = parseInt(ntimeHex, 16), nbits = parseInt(nbitsHex, 16), version = parseInt(verHex, 16);
                        for (let nonce = 0; nonce < 3000000; nonce++) {
                            const hash = S.headerHash({ version, prevHashInternalHex: prevInternal,
                                merkleRootInternal: root, ntime, nbits, nonce });
                            if (hash.startsWith('000')) {   // clears the tiny share target
                                submitted = true;
                                sock.write(JSON.stringify({ id: id++, method: 'mining.submit',
                                    params: [minerAddr + '.w1', jobId, '00000000', ntimeHex,
                                             nonce.toString(16).padStart(8, '0')] }) + '\n');
                                break;
                            }
                        }
                    }
                }
            });
        });

        assert.ok(result && /^[0-9a-f]{64}$/.test(result.hash), 'server emitted a block with a valid hash');
        assert.strictEqual(result.address, minerAddr, 'block credits the connecting miner');
        srv.stop();
    });
});
