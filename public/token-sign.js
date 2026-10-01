/*
 * © 2026 SPN Coin Project — client-side signing (keys never leave the browser)
 *
 * This module lets the Create-Coin / Manage-Assets pages build and sign
 * token operations AND their carrier transactions entirely in the
 * browser. The private key is used only here, in memory, and is never
 * put in a request body. The server receives a fully-signed transaction
 * and verifies it — it never sees the key.
 *
 * Requires elliptic (loaded via CDN in the page). Signature format is
 * DER over sha256(sha256(canonicalBody)) to match the node's verifier
 * (Node's crypto.verify('sha256', hashBytes, sig) hashes the hash again).
 */
(function (global) {
  'use strict';

  function ecLib() {
    if (!global.elliptic) throw new Error('elliptic library not loaded');
    return new global.elliptic.ec('secp256k1');
  }

  // ── hashing (SubtleCrypto) ────────────────────────────────
  async function sha256Bytes(bytes) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(buf);
  }
  function hexToBytes(hex) {
    const a = new Uint8Array(hex.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
  }
  function bytesToHex(b) {
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function sha256Hex(strOrBytes) {
    const bytes = typeof strOrBytes === 'string'
      ? new TextEncoder().encode(strOrBytes) : strOrBytes;
    return bytesToHex(await sha256Bytes(bytes));
  }

  // Deterministic body serialization (must match tokens/token-extensions.js canon()).
  // Recursively sorts object keys at EVERY depth so nested objects are canonicalized
  // too. The previous version passed a top-level key array to JSON.stringify, which
  // silently DROPPED nested keys — leaving part of the payload unsigned.
  function _sortDeep(v) {
    if (Array.isArray(v)) return v.map(_sortDeep);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = _sortDeep(v[k]);
      return out;
    }
    return v;
  }
  function canon(body) {
    return JSON.stringify(_sortDeep(body));
  }

  // ── key handling ──────────────────────────────────────────
  // Accepts EITHER a raw 32-byte hex private key (64 hex) OR a full
  // DER/PKCS8 key as exported by the browser wallet (starts 3081.../3082...).
  // For a PKCS8 EC key the raw 32-byte scalar is embedded as
  // ...020101 0420 <32-byte-key>..., so we extract it when a raw key isn't given.
  function fromHex(hex) {
    if (/^[0-9a-f]{64}$/.test(hex)) return hex;                 // already raw 32-byte
    if (/^[0-9a-f]+$/.test(hex) && hex.length >= 68) {
      // PKCS8 / SEC1 ECPrivateKey: version INTEGER(1) + OCTET STRING(32) + key
      var m = hex.match(/0201010420([0-9a-f]{64})/);
      if (m) return m[1];
      // fallback: last "0420"+64hex occurrence
      var all = hex.match(/0420([0-9a-f]{64})/g);
      if (all && all.length) return all[all.length - 1].slice(4);
    }
    return null;
  }
  function b64ToHex(s) {
    try {
      var bin = atob(s);
      var h = '';
      for (var i = 0; i < bin.length; i++) {
        var c = bin.charCodeAt(i).toString(16);
        h += c.length === 1 ? '0' + c : c;
      }
      return h;
    } catch (e) { return null; }
  }
  function extractRawPriv(input) {
    var s = String(input || '').trim().replace(/\s+/g, '');
    if (/^0x/i.test(s)) s = s.slice(2);
    // 1) hex path (raw 64-hex or DER/PKCS8 hex, e.g. the 270-hex wallet key)
    var lower = s.toLowerCase();
    var viaHex = fromHex(lower);
    if (viaHex) return viaHex;
    // 2) base64 path: raw 32-byte key (~44 chars) or base64-encoded DER
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 40) {
      var hex = b64ToHex(s);
      if (hex) {
        var viaB64 = fromHex(hex);
        if (viaB64) return viaB64;
      }
    }
    // 3) base64url variant
    if (/^[A-Za-z0-9_-]+$/.test(s) && s.length >= 40) {
      var std = s.replace(/-/g, '+').replace(/_/g, '/');
      while (std.length % 4) std += '=';
      var hx = b64ToHex(std);
      if (hx) {
        var v = fromHex(hx);
        if (v) return v;
      }
    }
    return null;
  }
  function keyFromRaw(rawHex) {
    var raw = extractRawPriv(rawHex);
    if (!raw)
      throw new Error('Bad key. Enter your wallet private key (raw 64-hex or the exported DER key). It never leaves this page.');
    return ecLib().keyFromPrivate(raw, 'hex');
  }

  // Fixed DER-SPKI wrapper for a secp256k1 public key. The node's verify()
  // expects an SPKI-DER key containing the UNCOMPRESSED point (0x04||X||Y).
  const SPKI_HEADER = '3056301006072a8648ce3d020106052b8104000a034200';
  function publicKeySPKI(key) {
    const uncompressed = key.getPublic(false, 'hex'); // 0x04 + X + Y (65 bytes)
    return SPKI_HEADER + uncompressed;
  }
  function compressedPub(key) {
    return key.getPublic(true, 'hex'); // 33-byte compressed (for tokenId/address use)
  }

  // Sign the way the node verifies: sig = ECDSA_DER( sha256( hashBytes ) )
  async function signHash(key, dataHashHex) {
    const inner = await sha256Bytes(hexToBytes(dataHashHex));
    const sig = key.sign(inner, { canonical: true });
    return bytesToHex(new Uint8Array(sig.toDER()));
  }

  // ── build a signed token op (issue / mint / transfer) ─────
  async function buildSignedOp(kind, fields, rawPrivHex, chainId) {
    const key = keyFromRaw(rawPrivHex);
    const pub = publicKeySPKI(key);
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    let body;
    if (kind === 'issue') {
      const tokenId = (await sha256Hex(`${pub}|${fields.name}|${fields.symbol}|${fields.supply}|${nonce}`)).slice(0, 40);
      // Optional branding metadata — must match the backend whitelist/caps exactly.
      var cleanMeta = null;
      if (fields.meta && typeof fields.meta === 'object') {
        // Must mirror the backend's safeLogo() exactly, or the signature canon won't match.
        var safeLogo = function (v) {
          var s = String(v || '').slice(0, 300000);
          if (!s) return '';
          if (/^https:\/\//i.test(s)) return s;
          if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
          return '';
        };
        cleanMeta = {
          logo:        safeLogo(fields.meta.logo),
          description: String(fields.meta.description || '').slice(0, 500),
          website:     String(fields.meta.website || '').slice(0, 256),
          twitter:     String(fields.meta.twitter || '').slice(0, 100),
          telegram:    String(fields.meta.telegram || '').slice(0, 100),
          github:      String(fields.meta.github || '').slice(0, 256),
          email:       String(fields.meta.email || '').slice(0, 100),
          whitepaper:  String(fields.meta.whitepaper || '').slice(0, 256),
          discord:     String(fields.meta.discord || '').slice(0, 100),
          facebook:    String(fields.meta.facebook || '').slice(0, 100),
          reddit:      String(fields.meta.reddit || '').slice(0, 100),
          medium:      String(fields.meta.medium || '').slice(0, 100),
        };
      }
      body = {
        type: 'issue', tokenId, name: String(fields.name), symbol: String(fields.symbol),
        decimals: Number(fields.decimals || 0), supply: String(fields.supply),
        kind: fields.type === 'coin' ? 'coin' : 'token',
        mintable: fields.type === 'coin' ? false : !!fields.mintable,
        issuer: fields.issuer, issuerPubKey: pub, chainId, nonce,
      };
      if (cleanMeta) body.meta = cleanMeta;
    } else if (kind === 'mint') {
      body = { type: 'mint', tokenId: fields.tokenId, amount: String(fields.amount),
        issuer: fields.issuer, issuerPubKey: pub, chainId, nonce };
    } else if (kind === 'transfer') {
      body = { type: 'transfer', tokenId: fields.tokenId, from: fields.from,
        to: fields.to, amount: String(fields.amount), fromPubKey: pub, chainId, nonce };
    } else if (kind === 'burn') {
      body = { type: 'burn', tokenId: fields.tokenId, amount: String(fields.amount),
        holder: fields.holder, holderPubKey: pub, chainId, nonce };
    } else if (kind === 'freeze' || kind === 'unfreeze') {
      body = { type: kind, tokenId: fields.tokenId, target: fields.target,
        issuer: fields.issuer, issuerPubKey: pub, chainId, nonce };
    } else if (kind === 'transfer-owner') {
      body = { type: 'transfer-owner', tokenId: fields.tokenId, newIssuer: fields.newIssuer,
        issuer: fields.issuer, issuerPubKey: pub, chainId, nonce };
    } else if (kind === 'set-meta') {
      var meta = {
        logo: String(fields.meta && fields.meta.logo || '').slice(0, 300000),
        description: String(fields.meta && fields.meta.description || '').slice(0, 500),
        website: String(fields.meta && fields.meta.website || '').slice(0, 256),
        twitter: String(fields.meta && fields.meta.twitter || '').slice(0, 100),
        telegram: String(fields.meta && fields.meta.telegram || '').slice(0, 100),
      };
      body = { type: 'set-meta', tokenId: fields.tokenId, meta: meta,
        issuer: fields.issuer, issuerPubKey: pub, chainId, nonce };
    } else {
      throw new Error('unknown op kind');
    }
    const sig = await signHash(key, await sha256Hex(canon(body)));
    return { ...body, sig };
  }

  // ── build a signed carrier transaction ────────────────────
  // The server hands us the selected UTXOs + outputs; we sign each input
  // exactly like Transaction.create() does on the node.
  async function buildSignedTx({ inputs, outputs, data, chainId }, rawPrivHex) {
    const key = keyFromRaw(rawPrivHex);
    const pub = publicKeySPKI(key);
    const version = 1;
    const timestamp = Date.now();
    const locktime = 0;

    // txid = sha256d(canonical base)  (must match server Transaction.computeId EXACTLY).
    // IMPORTANT: the server only adds the `data` key when data != null. If we always
    // included `data: null` here, the JSON string — and therefore the txid — would
    // differ from the server's, causing a "Transaction ID mismatch" rejection.
    const base = {
      version,
      inputs: inputs.map(i => ({ txid: i.txid, vout: i.vout, sequence: i.sequence })),
      outputs, timestamp, locktime,
    };
    if (data != null) base.data = data;
    const inner = await sha256Bytes(new TextEncoder().encode(JSON.stringify(base)));
    const txidBytes = await sha256Bytes(inner); // double sha256
    const txid = bytesToHex(txidBytes);

    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(4)));
    const signedInputs = [];
    for (const inp of inputs) {
      // sigMessage(txid, {...inp, nonce}) — key ORDER must match utxo.js exactly:
      // { txid, inp, vout, nonce, chainId }
      const sigMsg = await sha256Hex(JSON.stringify({
        txid, inp: inp.txid, vout: inp.vout, nonce, chainId,
      }));
      const signature = await signHash(key, sigMsg);
      signedInputs.push({ ...inp, nonce, signature, pubkey: pub });
    }
    return { id: txid, version, inputs: signedInputs, outputs, timestamp, locktime, data: data || null };
  }

  // Build a signed batch-airdrop op (recipients: [{to, amount}]).
  async function buildAirdropBatch({ tokenId, recipients, from }, rawPrivHex, chainId) {
    const key = keyFromRaw(rawPrivHex);
    const pub = publicKeySPKI(key);
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    const clean = (recipients || []).map(r => ({ to: r.to, amount: String(r.amount) }));
    const body = { type: 'airdrop-batch', tokenId, recipients: clean, from,
      fromPubKey: pub, chainId, nonce };
    const sig = await signHash(key, await sha256Hex(canon(body)));
    return { ...body, sig };
  }

  // Build a signed airdrop CLAIM op (claimant proves eligibility via proof).
  async function buildAirdropClaim({ tokenId, airdropId, amount, proof, claimant }, rawPrivHex, chainId) {
    const key = keyFromRaw(rawPrivHex);
    const pub = publicKeySPKI(key);
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    const body = { type: 'airdrop-claim', tokenId, airdropId, amount: String(amount),
      proof: proof || [], claimant, claimantPubKey: pub, chainId, nonce };
    const sig = await signHash(key, await sha256Hex(canon(body)));
    return { ...body, sig };
  }

  global.SPNSign = { buildSignedOp, buildSignedTx, buildAirdropBatch, buildAirdropClaim, canon, sha256Hex,
    keyFromRaw, compressedPub, bytesToHex, hexToBytes };
})(window);
