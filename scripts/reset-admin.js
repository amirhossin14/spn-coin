#!/usr/bin/env node
/*
 * scripts/reset-admin.js
 *
 * Recover access when you've lost the admin username/password that was printed
 * only once on first run.
 *
 * Usage:
 *   node scripts/reset-admin.js --list
 *       Show the current admin usernames (password can't be shown — it's hashed).
 *
 *   node scripts/reset-admin.js --set <username> <newPassword>
 *       Set (or reset) an admin's password to one you choose.
 *
 *   node scripts/reset-admin.js --new <username> <password>
 *       Create a brand-new admin account with a known username/password.
 *
 * IMPORTANT: run this with the SAME ACCESS_KEY (or .access-key file) as the
 * server, otherwise it can't read the existing access.lock. If you use a .env,
 * load it first, e.g.:  node -r dotenv/config scripts/reset-admin.js --list
 */
'use strict';

process.env.CHAIN_ID = process.env.CHAIN_ID || '3';
const { ac } = require('../app/access-control');

const args = process.argv.slice(2);
const cmd = args[0];

function listAdmins() {
    const users = ac.getUsers ? ac.getUsers() : [];
    console.log('\n👤 Current accounts:\n');
    users.forEach(u => {
        console.log('   ' + (u.role === 'admin' ? '⭐ ' : '   ') + u.username + '  (role: ' + u.role + ', active: ' + (u.active !== false) + ')');
    });
    console.log('\n⚠️  Passwords are hashed and cannot be displayed.');
    console.log('   To set a new password:  node scripts/reset-admin.js --set <username> <newPassword>\n');
}

function setPassword(username, newPass) {
    if (!username || !newPass) { console.error('Usage: --set <username> <newPassword>'); process.exit(1); }
    if (newPass.length < 8) { console.error('❌ Password must be at least 8 characters.'); process.exit(1); }
    const users = ac.getUsers();
    const user = users.find(u => u.username === username);
    if (!user) { console.error('❌ No user named "' + username + '". Run --list to see users.'); process.exit(1); }
    const r = ac.updateUser ? ac.updateUser(user.id, { password: newPass }) : null;
    if (r && (r.ok || r.username)) {
        console.log('\n✅ Password updated for "' + username + '".');
        console.log('   You can now log in with this username and your new password.\n');
    } else {
        console.error('❌ Could not update password:', r && r.error ? r.error : 'unknown error');
        process.exit(1);
    }
}

function newAdmin(username, pass) {
    if (!username || !pass) { console.error('Usage: --new <username> <password>'); process.exit(1); }
    if (pass.length < 8) { console.error('❌ Password must be at least 8 characters.'); process.exit(1); }
    const r = ac.createUser ? ac.createUser({ username, password: pass, role: 'admin' }) : null;
    if (r && (r.ok || r.username || r.id)) {
        console.log('\n✅ New admin created:');
        console.log('   Username: ' + username);
        console.log('   Password: ' + pass);
        console.log('   Save these somewhere safe.\n');
    } else {
        console.error('❌ Could not create admin:', r && r.error ? r.error : 'unknown error');
        process.exit(1);
    }
}

console.log('╔══════════════════════════════════════════╗');
console.log('║   SPN Coin — Admin Account Recovery       ║');
console.log('╚══════════════════════════════════════════╝');

if (cmd === '--list') listAdmins();
else if (cmd === '--set') setPassword(args[1], args[2]);
else if (cmd === '--new') newAdmin(args[1], args[2]);
else {
    console.log('\nCommands:');
    console.log('  --list                          show accounts');
    console.log('  --set <username> <newPassword>  reset a password');
    console.log('  --new <username> <password>     create a new admin\n');
    console.log('⚠️  Run with the SAME ACCESS_KEY as your server.\n');
}
