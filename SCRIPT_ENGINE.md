# Native Script Engine — Upgrade

The principled way to do "smart contracts" in the UTXO model is to enrich the Script language
(not EVM). The engine was upgraded from a simple P2PKH/multisig/timelock stack machine to a real
conditional language.

## What was added
- **Conditional branching:** `OP_IF` / `OP_NOTIF` / `OP_ELSE` / `OP_ENDIF` (with an
  execution stack and balance checking). This is the foundation of any multi-path contract.
- **Hash functions:** `OP_SHA256`, `OP_HASH256` (in addition to `OP_HASH160`).
- **Relative timelock (BIP-112):** `OP_CHECKSEQUENCEVERIFY` (CSV) — spendable only after
  n blocks/seconds have passed since the output's creation.
- **`OP_SWAP`** and stack fixes.

## Ready-made contracts (builders)
- **HTLC (Hash Time-Locked Contract):** the basis of atomic swaps and payment channels.
  ```js
  const lock   = script.build.htlc(sha256(preimage), recipientPub, funderPub, timeout);
  const claim  = script.build.htlcClaim(sig, preimage);  // claim path revealing the preimage
  const refund = script.build.htlcRefund(sig);           // refund path after timeout
  ```
- **Relative timelock:** `script.build.csv(sequence, innerScript)`
- (already existing) `p2pkh`, `multisig(m,n)`, `timelock` (absolute CLTV)

## Connection to the chain
During validation, `utxo/utxo.js` passes `sigHash` (with chainId for replay protection),
`lockContext` (for CLTV), and `sequenceContext` (for CSV) to the engine,
so these contracts also run on real transactions.

## Verification
Tested: HTLC claim with the correct preimage (and rejection of a wrong preimage/signature), refund before/after
the timeout, CSV with sufficient/insufficient age, rejection of an unbalanced `OP_IF`, and
multisig/P2PKH staying intact. **55 tests passing, lint with no errors.**

> Reminder: this "smart contract" is UTXO-style (spending conditions), not a general
> state machine like EVM. For arbitrary turing-complete contracts, the right path is
> deployment on an EVM chain (`contracts/`).
