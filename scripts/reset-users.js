#!/usr/bin/env node
/*
 * scripts/reset-users.js
 *
 * Wipes the current access.lock so the node generates a FRESH set of admin/
 * miner/viewer accounts (with new random usernames) on next start.
 *
 * Usage:  node scripts/reset-users.js
 *
 * After running, start the node — new credentials print ONCE. Save them.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, '..', 'access.lock');
const KEY  = path.join(__dirname, '..', '.access-key');

let removed = 0;
for (const f of [LOCK, KEY]) {
    if (fs.existsSync(f)) { fs.unlinkSync(f); removed++; }
}

console.log('\n╔════════════════════════════════════════════╗');
console.log('║   SPN Coin — User Reset                     ║');
console.log('╚════════════════════════════════════════════╝\n');
if (removed > 0) {
    console.log('✅ Cleared existing accounts (' + removed + ' file(s) removed).');
    console.log('   Next `npm start` will generate NEW random admin/miner/viewer');
    console.log('   accounts and print them ONCE. Save them immediately!\n');
} else {
    console.log('ℹ️  No existing account files found — a fresh set will be');
    console.log('   created on next start anyway.\n');
}
console.log('⚠️  Note: if ADMIN_USER/ADMIN_PASS are set in your .env, those');
console.log('   fixed values are used instead of random ones.\n');
