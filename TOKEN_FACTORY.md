# Paid Token Creation Service + Web Page

Anyone can create their own coin/token by **paying a fee** (in SPN) — with their own address and
key. The fee is **enforced on-chain**: an issuance operation is only applied when
the transaction carrying it has paid the issuance fee to the **treasury** address.

## Web page
```
http://localhost:3000/tokens      (file: public/token-factory.html)
```
A token creation form (name/symbol/decimals/supply/key), display of the fee and treasury, a list of tokens,
and a clear security warning about the key. With the same visual identity as the explorer.

## Configuration
```bash
TOKEN_ISSUANCE_FEE=10000000000   # issuance fee in satoshi (default 100 SPN)
TREASURY_ADDRESS=SPN1...         # fee destination (default: node wallet)
```
If the treasury is not set, issuance is free; a running node always sets the treasury (to the
operator's wallet), so the fee is enforced.

## API
- `GET  /api/tokens/fee-info`  → the fee amount + treasury address
- `POST /api/tokens/create`    → body: `{ name, symbol, decimals, supply, privateKey }`
  - The user's key signs the issuance operation (issuer = the user's address) and pays the fee from their
    balance. The entire supply is minted to the user's own address.
- (operator) `POST /api/tokens/issue` and `/api/tokens/transfer` with the node wallet.

## Security
- Issuance is signed with the issuer's key; the key must hash to the claimed address.
- The fee is bound **atomically** to issuance (if the fee is not paid, the token is not created).
- Anti-replay (nonce+chainId), rejection of overspend and duplicate issuance.
- ⚠️ In `create`, the private key is sent to the node so signing/payment can happen; use it only
  on a node you **trust** (preferably your own node). For a production environment,
  client-side signing is recommended.

## Verification
- ✅ Issuance **without** paying the fee is rejected on-chain.
- ✅ Issuance **with** the fee paid succeeds; the token is minted to a third-party user's address and the treasury
  receives the fee.
- **58 tests pass, lint with no errors, the server boots cleanly, the `/tokens` page returns HTTP 200.**
