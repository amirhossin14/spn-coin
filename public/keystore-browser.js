/*
 * keystore-browser.js — encrypted keystore for the browser.
 *
 * Encrypts a raw secp256k1 private key with a user password using the browser's
 * native Web Crypto API (PBKDF2 key derivation + AES-GCM authenticated
 * encryption) and stores ONLY the ciphertext in localStorage. The raw key and
 * the password are never stored and never leave the browser.
 *
 * This mirrors the security model of MetaMask/geth keystores: the private key
 * at rest is always encrypted, and a wrong password fails to decrypt (AES-GCM
 * authentication tag mismatch) rather than yielding a wrong key.
 *
 * API (all async where noted):
 *   SPNKeystore.has()                       → bool  (is an encrypted key saved?)
 *   SPNKeystore.meta()                      → { address } | null
 *   await SPNKeystore.save(privHex, pw, address)   encrypt + persist
 *   await SPNKeystore.unlock(pw)            → privHex   (throws on bad password)
 *   SPNKeystore.remove()                    delete the saved keystore
 */
(function () {
  'use strict';

  var LS_KEY = 'spn_keystore_v1';
  var enc = new TextEncoder();

  function buf2hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  function hex2buf(hex) {
    var a = new Uint8Array(hex.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
  }
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function unb64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  // PBKDF2 work factor. OWASP (2023) recommends >= 600k for PBKDF2-HMAC-SHA256.
  var PBKDF2_ITERS = 600000;

  // Derive an AES-GCM key from the password with PBKDF2. The iteration count is
  // a parameter so old keystores (saved at a lower count, recorded in the file)
  // still decrypt while new ones use the stronger default.
  async function deriveKey(password, salt, iterations) {
    var base = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations || PBKDF2_ITERS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  }

  var SPNKeystore = {
    has: function () {
      try { return !!localStorage.getItem(LS_KEY); } catch (e) { return false; }
    },

    meta: function () {
      try {
        var o = JSON.parse(localStorage.getItem(LS_KEY));
        return o ? { address: o.address || '' } : null;
      } catch (e) { return null; }
    },

    // Encrypt the private key with the password and persist the ciphertext.
    save: async function (privHex, password, address) {
      privHex = (privHex || '').trim();
      // Accept both a 32-byte raw secp256k1 key (64 hex) AND the DER/PKCS8
      // encoding this wallet actually produces (~270 hex). The keystore stores
      // and returns the exact string it is given, so whatever format the wallet
      // session uses round-trips correctly. (The old 64-hex-only check silently
      // rejected the DER key, so the wallet was never saved and Login always
      // failed.) Require an even-length hex string of at least 32 bytes.
      if (!/^[0-9a-fA-F]+$/.test(privHex) || privHex.length < 64 || privHex.length % 2 !== 0)
        throw new Error('Private key must be a hex string (>= 32 bytes).');
      if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var key = await deriveKey(password, salt, PBKDF2_ITERS);
      var ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv }, key, hex2buf(privHex),
      );
      var record = {
        v: 2,
        address: address || '',
        salt: b64(salt),
        iv: b64(iv),
        ct: b64(ct),          // ciphertext incl. AES-GCM auth tag
        iterations: PBKDF2_ITERS,
        kdf: 'PBKDF2-SHA256-' + PBKDF2_ITERS,
        cipher: 'AES-GCM-256',
      };
      localStorage.setItem(LS_KEY, JSON.stringify(record));
      return true;
    },

    // Decrypt with the password. Wrong password → throws (auth tag mismatch).
    unlock: async function (password) {
      var o;
      try { o = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { o = null; }
      if (!o) throw new Error('No saved wallet.');
      // Old keystores were saved at 250k and did not record the count.
      var iters = o.iterations || 250000;
      var key = await deriveKey(password, unb64(o.salt), iters);
      try {
        var pt = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct),
        );
        return buf2hex(pt);
      } catch (e) {
        throw new Error('Wrong password.');
      }
    },

    remove: function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
    },
  };

  window.SPNKeystore = SPNKeystore;
})();
