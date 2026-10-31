# SPN Coin Custom Address Guide

The addresses of this blockchain are fully configurable. All settings live in `config.js` →
the `ADDRESS` block. Changing any of them is **consensus-breaking**: existing chain data and prior
addresses become invalid, so before using it, delete `./data` and, on a fresh testnet,
re-mine the genesis block.

## 1) Changing the prefix/brand (the simplest)
In `config.js`:
```js
PREFIX_MAINNET: 'PARS1',   // for example
PREFIX_TESTNET: 'PARSt',
```
Result: addresses take the form `PARS1B...`.

## 2) Modern bech32 style (lowercase, stronger checksum)
```js
FORMAT:      'bech32',
HRP_MAINNET: 'pars',
HRP_TESTNET: 'tpars',
```
Result: addresses take the form `pars1q...` (similar to Bitcoin SegWit / Cosmos addresses).

## 3) Full coin rebrand
Name and symbol in `config.js` → `COIN`:
```js
NAME: 'ParsCoin', SYMBOL: 'PARS', ADDRESS_PREFIX: 'PARS',
```
plus the prefix/HRP above. (The L2 token version in `contracts/` has its own separate name/symbol.)

## 4) Vanity address (custom leading characters)
Key brute-force tool:
```bash
npm run vanity -- SPN1BCool          # address should start with SPN1BCool
npm run vanity -- SPN1BAli --max=20000000
npm run vanity -- pars1qcool --regex # for bech32 / custom matching
```
Important note (base58check): because the version byte is fixed, **the first character after the
prefix is constrained** (for example, with `0x19` it is always `B`). So your desired pattern must
start with that same character; otherwise it is impossible. Each additional fixed character makes the
work ~33 to 58 times harder: 3–4 characters take seconds, 5–6 minutes/hours, 7+ is impractical single-threaded.

> Keep the private key the tool prints safe — anyone who has it owns the address.

## Technical address structure
Public key → `SHA256` → `RIPEMD160` (HASH160, 20 bytes) → depending on the format:
- **base58check**: `version-byte || HASH160` with a double-SHA256 checksum, and the brand prefix in front.
- **bech32**: 5-bit encoding of HASH160 under the HRP with a BIP173 checksum.
