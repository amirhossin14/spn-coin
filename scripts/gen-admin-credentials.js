#!/usr/bin/env node
/*
 * scripts/gen-admin-credentials.js
 *
 * Generates a strong, random admin username + password and prints ready-to-use
 * environment variable lines. Nothing is written to the repo — you copy the
 * output into your own .env / secrets manager, which is where credentials
 * belong (never hard-coded in source).
 *
 * Usage:
 *   node scripts/gen-admin-credentials.js            # admin only
 *   node scripts/gen-admin-credentials.js --all      # admin + miner + viewer
 *   node scripts/gen-admin-credentials.js --len 40   # longer password
 */
'use strict';

const crypto = require('crypto');

function strongPassword(len = 32) {
    // Ambiguity-free alphabets (no I/O/l/0/1) plus symbols → easy to copy, hard to guess.
    const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower  = 'abcdefghijkmnpqrstuvwxyz';
    const digit  = '23456789';
    const symbol = '!@#$%^&*()-_=+[]{}';
    const all = upper + lower + digit + symbol;
    let pw = [
        upper[crypto.randomInt(upper.length)],
        lower[crypto.randomInt(lower.length)],
        digit[crypto.randomInt(digit.length)],
        symbol[crypto.randomInt(symbol.length)],
    ];
    for (let i = pw.length; i < len; i++) pw.push(all[crypto.randomInt(all.length)]);
    // Fisher–Yates shuffle so the guaranteed chars aren't always at the front
    for (let i = pw.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [pw[i], pw[j]] = [pw[j], pw[i]];
    }
    return pw.join('');
}

function randUsername(prefix) {
    return prefix + crypto.randomBytes(5).toString('hex');
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const lenIdx = args.indexOf('--len');
const len = lenIdx >= 0 ? Math.max(16, parseInt(args[lenIdx + 1]) || 32) : 32;

function block(roleUpper, prefix) {
    const user = randUsername(prefix);
    const pass = strongPassword(len);
    const entropy = Math.round(pass.length * Math.log2(70));
    return { roleUpper, user, pass, entropy };
}

const creds = [block('ADMIN', 'admin_')];
if (all) {
    creds.push(block('MINER', 'miner_'));
    creds.push(block('VIEWER', 'viewer_'));
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  Strong credentials — copy into your .env (never commit)');
console.log('════════════════════════════════════════════════════════\n');

for (const c of creds) {
    console.log(`# ${c.roleUpper} — password ${c.pass.length} chars, ~${c.entropy} bits of entropy`);
    console.log(`${c.roleUpper}_USER=${c.user}`);
    console.log(`${c.roleUpper}_PASS=${c.pass}`);
    console.log('');
}

console.log('────────────────────────────────────────────────────────');
console.log('How to use:');
console.log('  1. Copy the lines above into a file named .env (gitignored).');
console.log('  2. Start the node; it will use these instead of random ones.');
console.log('  3. Store the password in a password manager as backup.');
console.log('  4. Never paste these into source code or commit them.');
console.log('────────────────────────────────────────────────────────\n');
