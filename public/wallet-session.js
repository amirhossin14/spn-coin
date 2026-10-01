/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * wallet-session.js — a tiny, in-memory wallet unlock helper.
 *
 * Lets a page unlock the wallet ONCE (address + private key), keeps it in
 * memory for the tab session, and exposes it to signing code. The key is
 * NEVER written to localStorage/sessionStorage or sent to the server — it
 * lives only in a JS variable and is wiped on lock or tab close.
 */
(function () {
  var _addr = '';
  var _priv = '';   // raw hex, memory only
  var _listeners = [];

  var SPKI_HEADER = '3056301006072a8648ce3d020106052b8104000a034200';

  // Derive the SPN address from a private key by asking the node to convert
  // the PUBLIC key → address (no private key ever leaves the browser).
  async function deriveAddress(privHex) {
    if (!window.elliptic) return '';
    try {
      var ec = new window.elliptic.ec('secp256k1');
      var kp = ec.keyFromPrivate(privHex, 'hex');
      var pubUncompressed = kp.getPublic(false, 'hex');
      var spki = SPKI_HEADER + pubUncompressed;
      var r = await fetch('/api/util/pubkey-to-address', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: spki }),
      });
      if (!r.ok) return '';
      var d = await r.json();
      return d.address || '';
    } catch (e) { return ''; }
  }

  var WalletSession = {
    isUnlocked: function () { return !!_priv; },
    address: function () { return _addr; },
    privateKey: function () { return _priv; },

    // Unlock with a private key (and optional explicit address). Async because
    // address derivation asks the node to convert the public key.
    unlock: async function (privHex, addr) {
      privHex = (privHex || '').trim();
      // Accept the project's key format: a hex string. The node generates
      // PKCS8-encoded keys (~270 hex chars), and some tools use a raw 64-hex
      // key. Accept any even-length hex of a reasonable size rather than
      // hard-coding 64, which wrongly rejected real wallet keys.
      if (!/^[0-9a-fA-F]+$/.test(privHex) || privHex.length < 64 || privHex.length % 2 !== 0) {
        throw new Error('Invalid private key format.');
      }
      _priv = privHex;
      _addr = (addr || '').trim() || await deriveAddress(privHex);
      _notify();
      return _addr;
    },

    // Forget everything (on logout or tab hide).
    lock: function () {
      _priv = ''; _addr = '';
      _notify();
    },

    // Subscribe to unlock/lock changes → cb(isUnlocked, address)
    onChange: function (cb) { _listeners.push(cb); cb(this.isUnlocked(), _addr); },
  };

  function _notify() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](WalletSession.isUnlocked(), _addr); } catch (e) {}
    }
  }

  // Wipe key if the tab is hidden for safety (optional, gentle).
  document.addEventListener('visibilitychange', function () {
    // keep unlocked on tab switch; only wipe on actual unload
  });
  window.addEventListener('beforeunload', function () { WalletSession.lock(); });

  window.WalletSession = WalletSession;
})();
