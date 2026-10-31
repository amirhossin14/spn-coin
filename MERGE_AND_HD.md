# Merging Two Versions + HD Wallet (Bitcoin-like)

## 1) Merging the two files ("linking")
The two uploads were compared:
- `Blockchain_fixed_1.zip` → the **newer** version (includes full account-creation validation).
- `Blockchain_fixed.zip`   → the **older** version (input tampering disabled).
The only real difference was in `app/access-control.js` and `server.js`; the `_1` version is a full
superset, so `_1` (the latest version) was used as the merge base.

## 2) New "Bitcoin-like" feature: HD Wallet (BIP39 + BIP32)
The same thing Bitcoin wallets have — a recovery phrase and hierarchical derivation:
- **BIP39**: a 12- or 24-word recovery phrase (`wallet/hd.js`, dependency `bip39`).
- **BIP32**: key derivation on secp256k1 with the path `m/44'/0'/0'/0/i` (using `elliptic`).
- Derived keys are converted to the project's exact format
  (`crypto.keyPairFromRawPrivate`) and work directly with sign/verify/address.

### Usage
Programmatic API:
```js
const { Wallet } = require('./wallet/wallet');
const { wallet, mnemonic } = Wallet.createHD();        // create + recovery phrase
const restored = Wallet.fromMnemonic(mnemonic, 0);     // restore (deterministic)
```
Command line:
```bash
npm run cli hd-new                 # new HD wallet + 12-word phrase
npm run cli hd-new -- --24         # 24-word phrase
npm run cli hd-restore "<words>" 0 # restore from phrase, optional index
```

## 3) Side bug fixed in the CLI
`cli/wallet-cli.js` loaded the wallet with the wrong path `require('./wallet')`,
so the `new`/`import`/`send` commands broke with the error "Cannot find module './wallet'".
It was fixed to `require('../wallet/wallet')`.

## Verification
- ✅ Valid 12/24-word phrase (BIP39), rejection of an invalid phrase by checksum.
- ✅ Deterministic restore (same phrase → same address), distinct addresses per-index.
- ✅ The derived key signs/verifies and produces a valid address.
- ✅ The CLI commands `new`/`hd-new`/`hd-restore` work.
- ✅ `npm test` → 28 tests pass, `npm run lint` with no errors, the server boots cleanly.
