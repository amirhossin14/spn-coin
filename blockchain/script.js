/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — Minimal Script engine
 *  A small stack VM in the spirit of Bitcoin Script. Supports the
 *  building blocks needed for P2PKH, m-of-n multisig, and timelocks
 *  (OP_CHECKLOCKTIMEVERIFY).
 *
 *  Conventions:
 *   - A script is an array of tokens. A token is either an opcode
 *     string ("OP_DUP", …) or a data push as a hex string.
 *   - Public keys are SPKI-hex (the same form Wallet uses), so
 *     OP_CHECKSIG uses the project's verify(). OP_HASH160 hashes the
 *     pushed bytes as-is (internally consistent for script-P2PKH).
 *   - Signatures are verified against ctx.sigHash (a hex hash the
 *     caller computes for the spending input — i.e. SIGHASH_ALL).
 *   - OP_CHECKLOCKTIMEVERIFY compares against ctx.lockContext
 *     (the spending tx's effective locktime / block height).
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");
const { verify } = require("./crypto");

function hash160Hex(hex) {
    const buf = Buffer.from(hex, "hex");
    const sha = crypto.createHash("sha256").update(buf).digest();
    return crypto.createHash("ripemd160").update(sha).digest("hex");
}
function sha256Hex(hex) {
    return crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}
function hash256Hex(hex) {
    const a = crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest();
    return crypto.createHash("sha256").update(a).digest("hex");
}

// Numeric opcodes OP_0..OP_16 push that number as a data item.
function smallNum(op) {
    if (op === "OP_0" || op === "OP_FALSE") return 0;
    const m = /^OP_(\d{1,2})$/.exec(op);
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 16) return n; }
    if (op === "OP_TRUE") return 1;
    return null;
}

const isOpcode = (t) => typeof t === "string" && t.startsWith("OP_");
const truthy = (v) => {
    if (Buffer.isBuffer(v)) return v.length > 0 && !v.every((b) => b === 0);
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.length > 0 && v !== "00" && /[1-9a-f]/i.test(v);
    return !!v;
};

/**
 * Evaluate scriptSig (unlock) followed by scriptPubKey (lock).
 * @returns {{ok:boolean, error?:string}}
 */
function evaluate(scriptSig, scriptPubKey, ctx = {}) {
    const stack = [];
    const execStack = [];                       // conditional-branch state (OP_IF/ELSE/ENDIF)
    const executing = () => execStack.every(Boolean);

    const run = (script) => {
        for (const tok of script) {
            // ── Flow control is evaluated even inside non-executed branches ──
            if (tok === "OP_IF" || tok === "OP_NOTIF") {
                let cond = false;
                if (executing()) {
                    if (!stack.length) throw new Error(`${tok}: empty stack`);
                    cond = truthy(stack.pop());
                    if (tok === "OP_NOTIF") cond = !cond;
                }
                execStack.push(cond);
                continue;
            }
            if (tok === "OP_ELSE") {
                if (!execStack.length) throw new Error("OP_ELSE without OP_IF");
                execStack[execStack.length - 1] = !execStack[execStack.length - 1];
                continue;
            }
            if (tok === "OP_ENDIF") {
                if (!execStack.length) throw new Error("OP_ENDIF without OP_IF");
                execStack.pop();
                continue;
            }
            if (!executing()) continue;         // skip tokens in a dead branch

            const num = isOpcode(tok) ? smallNum(tok) : null;
            if (!isOpcode(tok)) { stack.push(tok); continue; }   // data push (hex)
            if (num !== null) { stack.push(num); continue; }      // OP_0..OP_16

            switch (tok) {
                case "OP_DUP": {
                    if (!stack.length) throw new Error("OP_DUP: empty stack");
                    stack.push(stack[stack.length - 1]);
                    break;
                }
                case "OP_DROP": {
                    if (!stack.length) throw new Error("OP_DROP: empty stack");
                    stack.pop();
                    break;
                }
                case "OP_SWAP": {
                    if (stack.length < 2) throw new Error("OP_SWAP: need 2 items");
                    const n = stack.length;
                    [stack[n - 1], stack[n - 2]] = [stack[n - 2], stack[n - 1]];
                    break;
                }
                case "OP_HASH160": {
                    stack.push(hash160Hex(String(stack.pop())));
                    break;
                }
                case "OP_SHA256": {
                    stack.push(sha256Hex(String(stack.pop())));
                    break;
                }
                case "OP_HASH256": {
                    stack.push(hash256Hex(String(stack.pop())));
                    break;
                }
                case "OP_EQUAL":
                case "OP_EQUALVERIFY": {
                    const a = stack.pop(), b = stack.pop();
                    const eq = String(a) === String(b);
                    if (tok === "OP_EQUALVERIFY") {
                        if (!eq) throw new Error("OP_EQUALVERIFY failed");
                    } else stack.push(eq ? 1 : 0);
                    break;
                }
                case "OP_VERIFY": {
                    if (!truthy(stack.pop())) throw new Error("OP_VERIFY failed");
                    break;
                }
                case "OP_CHECKSIG":
                case "OP_CHECKSIGVERIFY": {
                    const pubkey = String(stack.pop());
                    const sig    = String(stack.pop());
                    const ok = !!ctx.sigHash && safeVerify(pubkey, ctx.sigHash, sig);
                    if (tok === "OP_CHECKSIGVERIFY") {
                        if (!ok) throw new Error("OP_CHECKSIGVERIFY failed");
                    } else stack.push(ok ? 1 : 0);
                    break;
                }
                case "OP_CHECKMULTISIG":
                case "OP_CHECKMULTISIGVERIFY": {
                    const n = Number(stack.pop());
                    const pubkeys = [];
                    for (let i = 0; i < n; i++) pubkeys.push(String(stack.pop()));
                    const m = Number(stack.pop());
                    const sigs = [];
                    for (let i = 0; i < m; i++) sigs.push(String(stack.pop()));
                    const ok = checkMultisig(sigs, pubkeys, ctx.sigHash);
                    if (tok === "OP_CHECKMULTISIGVERIFY") {
                        if (!ok) throw new Error("OP_CHECKMULTISIGVERIFY failed");
                    } else stack.push(ok ? 1 : 0);
                    break;
                }
                case "OP_CHECKLOCKTIMEVERIFY": {
                    // Absolute timelock: top item is the required locktime (height/time).
                    if (!stack.length) throw new Error("CLTV: empty stack");
                    const required = Number(stack[stack.length - 1]);
                    const have = Number(ctx.lockContext ?? 0);
                    if (have < required)
                        throw new Error(`CLTV: locktime not met (need ${required}, have ${have})`);
                    break; // leaves the value on the stack (like Bitcoin)
                }
                case "OP_CHECKSEQUENCEVERIFY": {
                    // Relative timelock (BIP-112): input must be at least this many
                    // blocks/seconds newer than the output it spends.
                    if (!stack.length) throw new Error("CSV: empty stack");
                    const required = Number(stack[stack.length - 1]);
                    const have = Number(ctx.sequenceContext ?? 0);
                    if (have < required)
                        throw new Error(`CSV: sequence not met (need ${required}, have ${have})`);
                    break; // leaves the value on the stack
                }
                default:
                    throw new Error(`Unknown opcode: ${tok}`);
            }
        }
    };

    try {
        run(Array.isArray(scriptSig) ? scriptSig : []);
        run(Array.isArray(scriptPubKey) ? scriptPubKey : []);
        if (execStack.length) throw new Error("unbalanced OP_IF/OP_ENDIF");
    } catch (e) {
        return { ok: false, error: e.message };
    }
    if (!stack.length) return { ok: false, error: "empty stack at end" };
    return { ok: truthy(stack[stack.length - 1]), error: truthy(stack[stack.length - 1]) ? undefined : "top of stack is false" };
}

function safeVerify(pubkey, sigHash, sig) {
    try { return verify(pubkey, sigHash, sig); } catch { return false; }
}

// m-of-n: each provided signature must match a distinct pubkey, in order.
function checkMultisig(sigs, pubkeys, sigHash) {
    if (!sigHash) return false;
    let pk = 0;
    for (const sig of sigs) {
        let matched = false;
        while (pk < pubkeys.length) {
            if (safeVerify(pubkeys[pk++], sigHash, sig)) { matched = true; break; }
        }
        if (!matched) return false;
    }
    return true;
}

// ── Script builders ────────────────────────────────────────────
const build = {
    // Pay-to-PubKey-Hash: lock to hash160(pubkeyHex). Unlock: [sig, pubkey].
    p2pkh: (pubkeyHashHex) =>
        ["OP_DUP", "OP_HASH160", pubkeyHashHex, "OP_EQUALVERIFY", "OP_CHECKSIG"],
    p2pkhUnlock: (sigHex, pubkeyHex) => [sigHex, pubkeyHex],

    // m-of-n multisig. Lock: OP_m <pub1..pubn> OP_n OP_CHECKMULTISIG. Unlock: sigs.
    multisig: (m, pubkeyHexes) =>
        [`OP_${m}`, ...pubkeyHexes, `OP_${pubkeyHexes.length}`, "OP_CHECKMULTISIG"],
    multisigUnlock: (sigHexes) => [...sigHexes],

    // Absolute timelock wrapping an inner spend condition (e.g. p2pkh).
    // lockValue (block height or timestamp) is pushed, checked, dropped.
    timelock: (lockValue, innerScript) =>
        [lockValue, "OP_CHECKLOCKTIMEVERIFY", "OP_DROP", ...innerScript],

    // Relative timelock (BIP-112 CSV): spendable only once the input is at
    // least `sequence` blocks/seconds newer than the output it spends.
    csv: (sequence, innerScript) =>
        [sequence, "OP_CHECKSEQUENCEVERIFY", "OP_DROP", ...innerScript],

    // Hash-Time-Locked Contract (atomic swaps / Lightning-style):
    //   • claim  path: reveal the SHA-256 preimage of `hashHex` + recipient sig
    //   • refund path: after `timeout` (absolute locktime) the funder reclaims
    // Lock:
    htlc: (hashHex, recipientPubKeyHex, refundPubKeyHex, timeout) => [
        "OP_IF",
            "OP_SHA256", hashHex, "OP_EQUALVERIFY", recipientPubKeyHex, "OP_CHECKSIG",
        "OP_ELSE",
            timeout, "OP_CHECKLOCKTIMEVERIFY", "OP_DROP", refundPubKeyHex, "OP_CHECKSIG",
        "OP_ENDIF",
    ],
    // Unlock — claim with the preimage:  [sig, preimage, OP_TRUE]
    htlcClaim: (sigHex, preimageHex) => [sigHex, preimageHex, "OP_TRUE"],
    // Unlock — refund after timeout:     [sig, OP_FALSE]
    htlcRefund: (sigHex) => [sigHex, "OP_FALSE"],
};

module.exports = { evaluate, build, hash160Hex, sha256Hex, hash256Hex, checkMultisig };
