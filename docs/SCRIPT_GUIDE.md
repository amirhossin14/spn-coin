# Script Language Guide (multisig / timelock)

The Script engine in `blockchain/script.js` is a small stack-based virtual machine in the style of
Bitcoin Script. Transaction outputs can carry a "locking script" (`script`) and
inputs an "unlocking script" (`scriptSig`). Validation is **incremental**:
simple UTXOs (address + signature) work as before; only UTXOs that have a `script` go through
the engine.

## Supported opcodes
`OP_DUP, OP_DROP, OP_HASH160, OP_EQUAL, OP_EQUALVERIFY, OP_VERIFY,
OP_CHECKSIG(VERIFY), OP_CHECKMULTISIG(VERIFY), OP_CHECKLOCKTIMEVERIFY, OP_0..OP_16`.

## Ready-made builders
```js
const S = require('./blockchain/script');

// P2PKH
const lock   = S.build.p2pkh(S.hash160Hex(pubkeyHex));
const unlock = S.build.p2pkhUnlock(sigHex, pubkeyHex);

// m-of-n multisig (e.g. 2 of 3)
const lock   = S.build.multisig(2, [pub1, pub2, pub3]);
const unlock = S.build.multisigUnlock([sigA, sigB]);   // signatures in key order

// absolute timelock (not spendable until a given height/time is reached)
const lock = S.build.timelock(1000, S.build.p2pkh(pkh));
```

## Using it in a transaction
Locked output:
```js
outputs: [{ address: 'script:multisig', amount: '900000000', script: lock }]
```
Unlocking input:
```js
inputs: [{ txid, vout, nonce, scriptSig: unlock }]
```
The signatures must sign this hash (the same one validation computes):
```js
const sigHash = sha256(JSON.stringify({ txid: tx.id, inp: txid, vout, nonce }));
```
For CLTV, the time condition is checked against `tx.locktime` (or the block height).

## Test status
- ✅ P2PKH: valid spend accepted; wrong key rejected.
- ✅ 2-of-3 multisig: two valid signatures accepted; a single signature or a foreign signature rejected.
- ✅ CLTV: rejected before the time; accepted after the time.
- ✅ Integrated with `Transaction.validate` (simple transactions keep working unchanged).

> Note: this engine is minimal and educational; the full Bitcoin Script language has more opcodes
> and safety rules. An audit is required before any production use.
