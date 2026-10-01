#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — Vanity address generator
 *  Brute-forces keypairs until the address matches a desired pattern.
 *  Works with whatever ADDRESS.FORMAT is active in config.js.
 *
 *  Usage:
 *    node tools/vanity.js <pattern> [--testnet] [--ignore-case] [--regex]
 *
 *  Examples:
 *    node tools/vanity.js SPN1Cool          # base58: address starts with SPN1Cool
 *    node tools/vanity.js spn1cool --regex  # match anywhere via regex
 *
 *  WARNING: each extra fixed character multiplies the work ~33–58×.
 *  3–4 chars: seconds. 5–6: minutes-to-hours. 7+: impractical single-threaded.
 *  The matched PRIVATE KEY is printed — keep it secret.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const c = require("../blockchain/crypto");
const { ADDRESS } = require("../config");

const args = process.argv.slice(2);
const pattern = args.find((a) => !a.startsWith("--"));
const testnet = args.includes("--testnet");
const ignoreCase = args.includes("--ignore-case");
const useRegex = args.includes("--regex");

if (!pattern) {
    console.error("Usage: node tools/vanity.js <pattern> [--testnet] [--ignore-case] [--regex]");
    process.exit(1);
}

// Build a matcher.
let matcher;
if (useRegex) {
    const re = new RegExp(pattern, ignoreCase ? "i" : "");
    matcher = (addr) => re.test(addr);
} else {
    const target = ignoreCase ? pattern.toLowerCase() : pattern;
    matcher = (addr) => (ignoreCase ? addr.toLowerCase() : addr).startsWith(target);
}

// Rough difficulty estimate (charset size depends on format).
const charsetSize = ADDRESS.FORMAT === "bech32" ? 32 : 58;
const brand = testnet ? ADDRESS.PREFIX_TESTNET : ADDRESS.PREFIX_MAINNET;
let variableChars = pattern.length;
if (!useRegex && ADDRESS.FORMAT === "base58check" && pattern.startsWith(brand)) {
    variableChars = pattern.length - brand.length; // brand prefix is free
}
const estimate = Math.pow(charsetSize, Math.max(0, variableChars));

console.log(`🔎 Searching for "${pattern}"  (format=${ADDRESS.FORMAT}, ${testnet ? "testnet" : "mainnet"})`);
console.log(`   ~${estimate.toLocaleString()} attempts expected on average.`);
if (estimate > 5e7) console.log("   ⚠️  This may take a very long time. Consider fewer fixed chars.");
if (!useRegex && ADDRESS.FORMAT === "base58check") {
    console.log("   ℹ️  Note: with a fixed version byte the FIRST char after the brand");
    console.log("      prefix is constrained (often a single value). If no match appears,");
    console.log("      your target may be unsatisfiable — try a different next character.");
}

const maxArg = args.find((a) => a.startsWith("--max="));
const MAX_ATTEMPTS = maxArg ? parseInt(maxArg.split("=")[1], 10) : 5_000_000;

let tries = 0;
const started = Date.now();
let found = null;

while (tries < MAX_ATTEMPTS) {
    const kp = c.generateKeyPair();
    const addr = c.publicKeyToAddress(kp.publicKey, testnet);
    tries++;
    if (matcher(addr)) { found = { addr, kp }; break; }
    if (tries % 20000 === 0) {
        const rate = Math.round(tries / ((Date.now() - started) / 1000));
        process.stdout.write(`\r   tried ${tries.toLocaleString()} (${rate.toLocaleString()}/s)…   `);
    }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
if (found) {
    console.log(`\n\n✅ Found after ${tries.toLocaleString()} tries in ${secs}s\n`);
    console.log(`   Address    : ${found.addr}`);
    console.log(`   Public key : ${found.kp.publicKey}`);
    console.log(`   PRIVATE KEY: ${found.kp.privateKey}`);
    console.log(`\n   ⚠️  Store the private key securely. Anyone with it controls the address.`);
} else {
    console.log(`\n\n❌ No match in ${MAX_ATTEMPTS.toLocaleString()} attempts (${secs}s).`);
    console.log(`   The pattern may be unsatisfiable (see the note above) or just rare.`);
    console.log(`   Raise the cap with --max=20000000, or pick an easier pattern.`);
    process.exitCode = 1;
}
