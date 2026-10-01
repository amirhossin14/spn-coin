#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * ══════════════════════════════════════════════════════════════
 *  💻 Wallet CLI — ابزار خط فرمان برای مدیریت کیف‌پول
 *
 *  دستورات:
 *   wallet new                      — ساخت کیف‌پول جدید
 *   wallet import <privkey>         — Import کلید
 *   wallet balance <address>        — مشاهده balance
 *   wallet send <to> <amount>       — send transaction
 *   wallet history <address>        — تاریخچه
 *   wallet utxos <address>          — لیست UTXOها
 *   wallet info                     — اطلاعات network
 * ══════════════════════════════════════════════════════════════
 */
const readline = require('readline');
const fs       = require('fs');
const https    = require('http');

const NODE_URL = process.env.NODE_URL || 'http://localhost:3000';
const API_KEY  = process.env.API_KEY  || '';

// ── رنگ‌ها ──────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red:   '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue:  '\x1b[34m', cyan:  '\x1b[36m', gold:   '\x1b[33m',
};

function log(msg)     { console.log(msg); }
function ok(msg)      { log(`${C.green}✅ ${msg}${C.reset}`); }
function err(msg)     { log(`${C.red}❌ ${msg}${C.reset}`); }
function info(msg)    { log(`${C.cyan}ℹ  ${msg}${C.reset}`); }
function warn(msg)    { log(`${C.yellow}⚠️  ${msg}${C.reset}`); }
function header(msg)  { log(`\n${C.bold}${C.gold}══ ${msg} ══${C.reset}\n`); }

// ── HTTP Helper ──────────────────────────────────────────────
function apiCall(method, path, body = null, token = '') {
    return new Promise((resolve, reject) => {
        const url     = new URL(NODE_URL + path);
        const bodyStr = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: url.hostname, port: url.port || 80,
            path: url.pathname + url.search, method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token || API_KEY}`,
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
            }
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ error: 'Invalid response' }); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ── prompt ───────────────────────────────────────────────────
function prompt(question, hidden = false) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        if (hidden) {
            process.stdout.write(question);
            process.stdin.setRawMode?.(true);
            let answer = '';
            process.stdin.once('data', function onData(ch) {
                ch = ch.toString();
                if (ch === '\n' || ch === '\r') {
                    process.stdin.setRawMode?.(false);
                    console.log('');
                    rl.close();
                    resolve(answer);
                } else if (ch === '\u0003') {
                    process.exit();
                } else {
                    answer += ch;
                    process.stdout.write('*');
                    process.stdin.once('data', onData);
                }
            });
        } else {
            rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
        }
    });
}

// ── formatters ───────────────────────────────────────────────
function satToMYC(sat) {
    return (Number(BigInt(sat)) / 100_000_000).toFixed(8);
}

function formatDate(ts) {
    return new Date(ts).toLocaleString('fa-IR');
}

// ════════════════════════════════════════════════════════════
//  دستورات
// ════════════════════════════════════════════════════════════

async function cmdNew() {
    header('Create new wallet');

    const { Wallet } = require('../wallet/wallet');
    const wallet     = new Wallet();

    log(`${C.bold}address:${C.reset}       ${C.cyan}${wallet.address}${C.reset}`);
    log(`${C.bold}Public key:${C.reset} ${wallet.publicKey.slice(0, 40)}...`);
    log(`${C.bold}Private key:${C.reset} ${C.red}${wallet.privateKey.slice(0, 20)}...${C.reset}`);

    warn('Private key !');

    const save = await prompt('\n (y/n):');
    if (save.toLowerCase() === 'y') {
        const passphrase = await prompt('password ( = ):', true);
        const filename   = `wallet_${wallet.address.slice(0, 8)}.json`;
        wallet.save(filename, passphrase);
        ok(` شد: ${filename}`);
    }
}

async function cmdImport(privKeyHex) {
    header('Import');
    if (!privKeyHex) { err('Private key'); return; }

    const { Wallet } = require('../wallet/wallet');
    const wallet     = new Wallet(privKeyHex);

    ok(`address: ${wallet.address}`);

    const save = await prompt('(y/n):');
    if (save.toLowerCase() === 'y') {
        const passphrase = await prompt('info', true);
        wallet.save(`wallet_${wallet.address.slice(0, 8)}.json`, passphrase);
    }
}

async function cmdHDNew() {
    header('Create HD wallet (BIP39 mnemonic)');
    const { Wallet } = require('../wallet/wallet');
    const words = process.argv.includes('--24') ? 256 : 128;
    const { wallet, mnemonic } = Wallet.createHD(words, 0);

    log(`${C.bold}address:${C.reset}     ${C.cyan}${wallet.address}${C.reset}`);
    log(`${C.bold}path:${C.reset}        m/44'/0'/0'/0/0`);
    warn('Write down this recovery phrase and keep it secret & offline:');
    log(`\n${C.gold}${mnemonic}${C.reset}\n`);
    info('Restore any time with:  cli hd-restore "<your words>"');
}

async function cmdHDRestore(mnemonic) {
    header('Restore HD wallet');
    if (!mnemonic) { err('Provide the mnemonic in quotes'); return; }
    const { Wallet } = require('../wallet/wallet');
    const hd = require('../wallet/hd');
    if (!hd.validateMnemonic(mnemonic)) { err('Invalid mnemonic (checksum/words)'); return; }

    const idx = parseInt(process.argv[process.argv.indexOf(mnemonic) + 1], 10);
    const index = Number.isInteger(idx) ? idx : 0;
    const wallet = Wallet.fromMnemonic(mnemonic, index);
    ok(`address (index ${index}): ${wallet.address}`);

    const save = await prompt('Save encrypted wallet file? (y/n): ');
    if (save.toLowerCase() === 'y') {
        const passphrase = await prompt('password: ', true);
        wallet.save(`wallet_${wallet.address.slice(0, 8)}.json`, passphrase);
        ok('Saved.');
    }
}

async function cmdBalance(address) {
    if (!address) { err('address'); return; }
    header(`balance ${address.slice(0, 16)}...`);

    try {
        const data = await apiCall('GET', `/api/wallet/${address}`);
        if (data.error) { err(data.error); return; }

        log(`${C.bold}address:${C.reset}    ${C.cyan}${data.address}${C.reset}`);
        log(`${C.bold}balance:${C.reset}  ${C.green}${satToMYC(data.balance)} SPN${C.reset}`);
        log(`${C.bold}transaction:${C.reset}  ${data.transactions?.length || 0} `);
    } catch (e) {
        err(`Error: ${e.message}`);
    }
}

async function cmdUTXOs(address) {
    if (!address) { err('address'); return; }
    header(`UTXO ${address.slice(0, 16)}...`);

    try {
        const data = await apiCall('GET', `/api/utxos/${address}`);
        if (!Array.isArray(data) || !data.length) { info('UTXO Not found'); return; }

        let total = 0n;
        data.forEach((u, i) => {
            log(`  [${i+1}] ${u.txid.slice(0,16)}:${u.vout}  →  ${satToMYC(u.amount)} SPN  (block ${u.blockHeight})`);
            total += BigInt(u.amount);
        });
        log(`\n${C.bold} کل: ${satToMYC(total.toString())} SPN${C.reset} (${data.length} UTXO)`);
    } catch (e) { err(e.message); }
}

async function cmdSend(token) {
    header('send transaction');

    const walletFile = await prompt('info');
    if (!fs.existsSync(walletFile)) { err('Not found'); return; }

    const passphrase = await prompt('info', true);
    let wallet;
    try {
        const { Wallet } = require('../wallet/wallet');
        wallet = Wallet.load(walletFile, passphrase);
        ok(`‌پول بارگذاری شد: ${wallet.address}`);
    } catch (e) { err(`Error: ${e.message}`); return; }

    const recipient = await prompt('address :');
    const amountStr = await prompt('Amount (SPN): ');
    const amount    = Math.round(parseFloat(amountStr) * 100_000_000);

    if (!amount || amount <= 0) { err('Amount Invalid'); return; }

    log(`\n:`);
    log(`  :       ${wallet.address}`);
    log(`  :       ${recipient}`);
    log(`  Amount:    ${amountStr} SPN`);

    const confirm = await prompt('\n (yes):');
    if (confirm !== 'yes') { warn('Cancel'); return; }

    try {
        const { UTXOSet } = require('../utxo/utxo');
        const utxoData    = await apiCall('GET', `/api/utxos/${wallet.address}`, null, token);

        // ساخت UTXOSet محلی
        const localUTXO = new UTXOSet();
        for (const u of utxoData) {
            localUTXO.add(u.txid, u.vout, { address: u.address, amount: u.amount, pubkey: wallet.publicKey });
        }

        const tx = wallet.createTransaction({ recipient, amount: BigInt(amount), utxoSet: localUTXO });

        const result = await apiCall('POST', '/api/transact', { tx: tx.toJSON() }, token);

        if (result.error) { err(result.error); return; }
        ok(`transaction send !`);
        log(`  TXID: ${C.cyan}${result.txid}${C.reset}`);
        log(`  fee: ${satToMYC(tx.fee.toString())} SPN`);

    } catch (e) { err(`Error: ${e.message}`); }
}

async function cmdHistory(address) {
    if (!address) { err('address'); return; }
    header(` ${address.slice(0, 16)}...`);

    try {
        const data = await apiCall('GET', `/api/wallet/${address}`);
        if (!data.transactions?.length) { info('transaction Not found'); return; }

        data.transactions.slice(0, 20).forEach((tx, i) => {
            const received = tx.outputs?.filter(o => o.address === address)
                .reduce((s, o) => s + Number(o.amount), 0) || 0;
            const sent = tx.inputs?.filter(i => i.address === address)
                .reduce((s, i) => s + Number(i.amount || 0), 0) || 0;
            const net = received - sent;

            const symbol = net >= 0 ? `${C.green}+` : `${C.red}`;
            log(`  [${i+1}] ${tx.id.slice(0,16)}  ${symbol}${satToMYC(Math.abs(net).toString())} SPN${C.reset}  ${formatDate(tx.timestamp)}`);
        });
    } catch (e) { err(e.message); }
}

async function cmdInfo() {
    header('network');
    try {
        const [coin, stats] = await Promise.all([
            apiCall('GET', '/api/coin-info'),
            apiCall('GET', '/api/stats'),
        ]);

        log(`  ${C.bold}:${C.reset}      ${coin.name} (${coin.symbol})`);
        log(`  ${C.bold}height:${C.reset}    ${stats.height}`);
        log(`  ${C.bold}difficulty:${C.reset}      ${stats.difficulty}`);
        log(`  ${C.bold}Mempool:${C.reset}   ${stats.pendingTx} transaction`);
        log(`  ${C.bold}UTXO:${C.reset}      ${stats.utxoCount} `);
        log(`  ${C.bold}network:${C.reset}      ${stats.networkType}`);
    } catch (e) { err(e.message); }
}

// ════════════════════════════════════════════════════════════
//  اجرا
// ════════════════════════════════════════════════════════════
async function main() {
    const args    = process.argv.slice(2);
    const cmd     = args[0];
    const arg1    = args[1];
    const token   = process.env.AUTH_TOKEN || '';

    log(`\n${C.bold}${C.gold}⛏  SPN Coin Wallet CLI${C.reset}`);
    log(`${C.cyan}: ${NODE_URL}${C.reset}\n`);

    switch (cmd) {
        case 'new':         await cmdNew();              break;
        case 'hd-new':      await cmdHDNew();            break;
        case 'hd-restore':  await cmdHDRestore(arg1);    break;
        case 'import':      await cmdImport(arg1);       break;
        case 'balance':     await cmdBalance(arg1);      break;
        case 'utxos':       await cmdUTXOs(arg1);        break;
        case 'send':        await cmdSend(token);        break;
        case 'history':     await cmdHistory(arg1);      break;
        case 'info':        await cmdInfo();             break;
        default:
            log(` موجود:`);
            log(`  new                  —  کیف‌پول جدید`);
            log(`  hd-new [--24]        —  کیف‌پول HD با عبارت بازیابی (BIP39)`);
            log(`  hd-restore "<words>" [i] —  بازیابی از عبارت ۱۲/۲۴ کلمه‌ای`);
            log(`  import <privkey>     — Import  Private key`);
            log(`  balance <address>    —  balance`);
            log(`  utxos <address>      —  UTXO`);
            log(`  send                 — send transaction ()`);
            log(`  history <address>    —  transaction‌ها`);
            log(`  info                 —  network`);
    }
    process.exit(0);
}

main().catch(e => { err(e.message); process.exit(1); });
