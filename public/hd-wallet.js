/*
 * © 2026 SPN Coin Project — hd-wallet.js
 * FULLY CLIENT-SIDE HD wallet (BIP39 mnemonic + BIP32 derivation).
 *
 * The 12-word phrase and the private key are generated and derived ENTIRELY in
 * the browser and NEVER sent to the server. Only the PUBLIC key (not secret) is
 * sent to /api/util/pubkey-to-address to obtain the SPN address.
 *
 * Requires: `elliptic` (global.elliptic, already loaded via CDN for signing)
 *           and the BIP39 wordlist (window.SPN_BIP39_WORDS).
 * Uses the Web Crypto API (crypto.subtle) for SHA-256, HMAC-SHA512 and PBKDF2.
 */
(function () {
  'use strict';

  function ecLib() {
    if (!window.elliptic) throw new Error('elliptic library not loaded');
    return new window.elliptic.ec('secp256k1');
  }
  function words() {
    if (!window.SPN_BIP39_WORDS || window.SPN_BIP39_WORDS.length !== 2048)
      throw new Error('BIP39 wordlist not loaded');
    return window.SPN_BIP39_WORDS;
  }

  // ── hex / byte helpers ──
  function bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
  function hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function concatBytes() { let n = 0; for (const a of arguments) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arguments) { out.set(a, o); o += a.length; } return out; }

  // ── hashing / kdf via Web Crypto ──
  async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
  async function hmacSha512(keyBytes, msgBytes) {
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, msgBytes));
  }
  async function pbkdf2Sha512(passBytes, saltBytes, iterations, dkLenBytes) {
    const base = await crypto.subtle.importKey('raw', passBytes, { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' }, base, dkLenBytes * 8);
    return new Uint8Array(bits);
  }

  // ── BIP39 ──────────────────────────────────────────────────
  // Generate a 12-word mnemonic from 128 bits of CSPRNG entropy.
  async function generateMnemonic() {
    const entropy = new Uint8Array(16); // 128 bits → 12 words
    crypto.getRandomValues(entropy);
    return entropyToMnemonic(entropy);
  }

  async function entropyToMnemonic(entropy) {
    const W = words();
    const hash = await sha256(entropy);
    const csBits = entropy.length * 8 / 32;                 // 128/32 = 4 checksum bits
    // Build a bit string of entropy + checksum, then slice into 11-bit indices.
    let bits = '';
    for (const b of entropy) bits += b.toString(2).padStart(8, '0');
    let csFull = '';
    for (const b of hash) csFull += b.toString(2).padStart(8, '0');
    bits += csFull.slice(0, csBits);
    const out = [];
    for (let i = 0; i < bits.length; i += 11) out.push(W[parseInt(bits.slice(i, i + 11), 2)]);
    return out.join(' ');
  }

  // Validate a mnemonic: word membership + checksum.
  async function validateMnemonic(mnemonic) {
    try {
      const W = words();
      const list = String(mnemonic || '').trim().toLowerCase().split(/\s+/);
      if (![12, 15, 18, 21, 24].includes(list.length)) return false;
      let bits = '';
      for (const w of list) {
        const idx = W.indexOf(w);
        if (idx < 0) return false;
        bits += idx.toString(2).padStart(11, '0');
      }
      const csBits = bits.length % 32;                       // checksum length
      const entBits = bits.length - csBits;
      const entropy = new Uint8Array(entBits / 8);
      for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      const hash = await sha256(entropy);
      let csFull = '';
      for (const b of hash) csFull += b.toString(2).padStart(8, '0');
      return csFull.slice(0, csBits) === bits.slice(entBits);
    } catch (e) { return false; }
  }

  // mnemonic (+optional passphrase) → 64-byte seed (BIP39: PBKDF2-HMAC-SHA512, 2048 iters).
  async function mnemonicToSeed(mnemonic, passphrase) {
    const enc = new TextEncoder();
    const pass = enc.encode(String(mnemonic).normalize('NFKD').trim());
    const salt = enc.encode(('mnemonic' + (passphrase || '')).normalize('NFKD'));
    return pbkdf2Sha512(pass, salt, 2048, 64);
  }

  // ── BIP32 ──────────────────────────────────────────────────
  const HARDENED = 0x80000000;
  function ser32(i) { const b = new Uint8Array(4); b[0] = (i >>> 24) & 0xff; b[1] = (i >>> 16) & 0xff; b[2] = (i >>> 8) & 0xff; b[3] = i & 0xff; return b; }

  async function masterFromSeed(seed) {
    const I = await hmacSha512(new TextEncoder().encode('Bitcoin seed'), seed);
    return { key: I.slice(0, 32), chainCode: I.slice(32) };
  }

  function compressedPubFromPriv(priv32) {
    const ec = ecLib();
    return hexToBytes(ec.keyFromPrivate(bytesToHex(priv32), 'hex').getPublic(true, 'hex'));
  }

  async function deriveChild(parent, index) {
    const ec = ecLib();
    let data;
    if (index >= HARDENED) data = concatBytes(new Uint8Array([0]), parent.key, ser32(index));
    else data = concatBytes(compressedPubFromPriv(parent.key), ser32(index));
    const I = await hmacSha512(parent.chainCode, data);
    const IL = I.slice(0, 32), IR = I.slice(32);
    const N = ec.curve.n;
    const BN = window.elliptic.utils ? null : null; // use elliptic's BN via keyFromPrivate math
    const kPar = ec.keyFromPrivate(bytesToHex(parent.key), 'hex').getPrivate();
    const ilNum = ec.keyFromPrivate(bytesToHex(IL), 'hex').getPrivate();
    const ki = ilNum.add(kPar).umod(N);
    if (ki.isZero()) throw new Error('invalid child key; pick another index');
    const kiHex = ki.toString(16).padStart(64, '0');
    return { key: hexToBytes(kiHex), chainCode: IR };
  }

  async function derivePath(seed, path) {
    let node = await masterFromSeed(seed);
    const parts = String(path).replace(/^m\/?/, '').split('/').filter(Boolean);
    for (const p of parts) {
      const hardened = p.endsWith("'") || p.endsWith('h');
      const idx = parseInt(p, 10) + (hardened ? HARDENED : 0);
      node = await deriveChild(node, idx);
    }
    return node;
  }

  function accountPath(index) { return "m/44'/0'/0'/0/" + (index || 0); }

  // Fixed SPKI-DER wrapper for the UNCOMPRESSED secp256k1 public key (matches node).
  const SPKI_HEADER = '3056301006072a8648ce3d020106052b8104000a034200';
  function pubkeySPKIFromPriv(priv32) {
    const ec = ecLib();
    const uncompressed = ec.keyFromPrivate(bytesToHex(priv32), 'hex').getPublic(false, 'hex');
    return SPKI_HEADER + uncompressed;
  }

  // Build a PKCS8-DER private key (hex) in the EXACT format the node uses, so the
  // rest of the app (signing, keystore, key reveal) is unchanged — the only change
  // is that this key was derived in the browser, not fetched from the server.
  function privateKeyDERFromRaw(priv32) {
    const ec = ecLib();
    const uncompressed = ec.keyFromPrivate(bytesToHex(priv32), 'hex').getPublic(false, 'hex');
    return '308184020100301006072a8648ce3d020106052b8104000a046d306b0201010420'
      + bytesToHex(priv32) + 'a144034200' + uncompressed;
  }

  // Derive keys from a mnemonic — ALL LOCAL, nothing secret leaves the browser.
  async function deriveKeys(mnemonic, index, passphrase) {
    const seed = await mnemonicToSeed(mnemonic, passphrase || '');
    const node = await derivePath(seed, accountPath(index || 0));
    return {
      privateKeyHex: bytesToHex(node.key),        // raw 32-byte private key
      privateKeyDER: privateKeyDERFromRaw(node.key), // PKCS8 DER (node-compatible)
      publicKeySPKI: pubkeySPKIFromPriv(node.key),   // SPKI DER hex (safe to send)
      path: accountPath(index || 0),
    };
  }

  // Resolve the SPN address from the PUBLIC key only (private key stays local).
  // Uses the CSRF-aware fetch when present so the POST isn't rejected by the guard.
  async function addressFromPublicKey(publicKeySPKI, testnet) {
    const doFetch = window.csrfFetch || fetch;
    const r = await doFetch((window.SPN_COIN_API || location.origin) + '/api/util/pubkey-to-address', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: publicKeySPKI, testnet: !!testnet }),
    });
    if (!r.ok) throw new Error('could not resolve address (HTTP ' + r.status + ')');
    return (await r.json()).address;
  }

  // Full generate: mnemonic + node-compatible DER private key + address.
  async function createWallet() {
    const mnemonic = await generateMnemonic();
    const k = await deriveKeys(mnemonic, 0);
    const address = await addressFromPublicKey(k.publicKeySPKI);
    return { mnemonic, address, privateKey: k.privateKeyDER, privateKeyHex: k.privateKeyHex, publicKeySPKI: k.publicKeySPKI, path: k.path };
  }

  // Full restore from a mnemonic (no mnemonic echoed back).
  async function restoreWallet(mnemonic, index) {
    if (!(await validateMnemonic(mnemonic))) throw new Error('Invalid recovery phrase');
    const k = await deriveKeys(String(mnemonic).trim(), index || 0);
    const address = await addressFromPublicKey(k.publicKeySPKI);
    return { address, privateKey: k.privateKeyDER, privateKeyHex: k.privateKeyHex, publicKeySPKI: k.publicKeySPKI, path: k.path };
  }

  window.SPNHDWallet = {
    generateMnemonic, validateMnemonic, mnemonicToSeed,
    deriveKeys, addressFromPublicKey, createWallet, restoreWallet, accountPath,
  };
})();
