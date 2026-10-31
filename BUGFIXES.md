# Bug Fixes

## 1) A Real Functional Bug: Fee Rate (feeRate) Was Ignored
- **Problem:** in `wallet/wallet.js`, the `createTransaction` function accepted a `feeRate`
  argument (and it was documented too), but it was never used; `utxoSet.selectCoins` was
  called without it, and the fee always came from the constant `FEE_PER_BYTE`. In other
  words, the user's chosen fee rate had no effect.
- **Fix:** `feeRate` is now passed through `wallet → selectCoins → _estimateFee`
  (`utxo/utxo.js`). Now fee = estimated bytes × rate, with a backward-compatible default.
- **Verification:** rate 10 → fee 2260; rate 100 → 22600 (10×); the no-rate case gives
  the same value as before. The full spend flow still works correctly.

## 2) Dead Code Cleanup (41 lint warnings → 0)
Removed unused imports/constants and marked unused arguments in:
`blockchain/blockchain.js, cli/wallet-cli.js, db/state.js, mempool/mempool.js,
middleware/security.js, mining-pool/stratum.js, mining-pool/stratum-ws.js,
p2p/p2p.js, p2p/p2p-http.js, server.js, utxo/utxo.js, wallet/wallet.js`.
This included converting unused `catch (e)` to `catch {`, removing dead imports, and
removing unused destructured keys. No behavior changes were introduced.

## Final Verification
- ✅ `npm run lint` → zero errors and zero warnings.
- ✅ `npm test` → all 18 tests pass.
- ✅ The server boots, `/api/health` is healthy.
- ✅ Full flow: mining, signed spend with correct fee, reorg based on chainwork,
  Script (multisig/timelock), both address formats (base58/bech32), and both PoW
  algorithms (sha256d/scrypt) — all healthy.

## 4) Input Validation Before Account Creation (createUser)
- **Problem:** instead of **rejecting** invalid input, the account creation function
  **silently mangled** it: invalid username characters were stripped and the name was
  truncated to 32 characters — so an account could be created with a name different from
  what the user requested, without any warning. In addition, the duplicate check was
  case-sensitive (allowing "Admin" to be spoofed against "admin"), an invalid role was
  silently converted to `viewer`, and a password equal to the username was not rejected.
- **Fix (real validation, clear rejection instead of mangling):**
  - Username: 3 to 32 characters, only letters/digits/`_`/`-` — if invalid it is
    **rejected** (not a silent stripping of characters or truncation of length).
  - Password: 8 to 128 characters and **must not equal the username**.
  - Role: if omitted → `viewer`; if invalid → **rejected** with a clear message
    (not a silent conversion).
  - The username duplicate check is **case-insensitive** (anti-impersonation).
  - The `V.username` validator in the endpoint was aligned with these rules (allowing `-`).
- **Verification:** all cases were tested — valid inputs are created, and every invalid
  input (name too short/long/bad character, short password, password=name, invalid role,
  duplicate regardless of case) is **rejected** with an appropriate message.

> Note: the `access.lock` file is a runtime secret (in `.gitignore`) and is created
> automatically on first run with random default users; it was removed from the package
> and must not be committed.
