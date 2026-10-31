# Token Layer — Creating Coins/Tokens on SPN Coin

Because this chain is UTXO-based (not EVM), asset issuance was implemented in the colored-coin/Omni
style: a **signed** token operation is carried inside the `data` field of a transaction, so it is
**anchored on-chain** (part of the txid), and once a block is confirmed the token ledger is applied
deterministically. Fees are paid in SPN.

## Security
- Every operation is **signed** with the issuer's/sender's key, and the key must hash to the
  claimed address (sender spoofing is rejected).
- `nonce` + `chainId` prevent **replay** (an operation is not applied twice or on a different
  chain). Overspend and duplicate issuance are also rejected.
- On a reorg, the ledger is rebuilt (replayed) from the new chain.

## API
Public (no authentication):
- `GET  /api/tokens`                         — list of tokens
- `GET  /api/tokens/:id`                      — token details (name/symbol/supply/holder count)
- `GET  /api/tokens/:id/balance/:addr`        — balance of an address
- `GET  /api/tokens/:id/holders`              — holders
- `GET  /api/address/:addr/tokens`            — all tokens of an address

Authenticated (the node's wallet is the issuer/sender):
- `POST /api/tokens/issue`    body: `{ name, symbol, decimals, supply }`
- `POST /api/tokens/transfer` body: `{ tokenId, to, amount }`

> An operation becomes final after its carrier transaction is **mined** (`note: pending until mined`).
> To issue, the node's wallet must have an SPN balance for the fee.

## Programmatic Usage (client-side signing with your own key)
```js
const { TokenLayer } = require('./tokens/tokens');
const op = TokenLayer.buildIssue({ name:'Gold', symbol:'GLD', decimals:2,
    supply:1000000, issuer:w.address, issuerPubKey:w.publicKey, privateKey:w.privateKey });
const tx = w.createTransaction({ recipient:w.address, amount:1000n,
    utxoSet:chain.utxoSet, feeRate:10, data:{ tokenOps:[op] } });   // must be mined
```

## Verification
Tested: issuance and transfer end-to-end via mined blocks, rejection of sender spoofing,
overspend, duplicate issuance, and replay. **58 tests pass, lint with no errors, the server boots healthy.**

> This is a "lightweight UTXO token" (an asset with supply/transfer), not a Turing-complete contract.
> For arbitrary logic, the EVM path (`contracts/`) is the right choice.

---

## Paid Token-Creation Service (anyone can create too) + Web Page

Now **anyone** can create their own token (with their own address/key) by paying a fee.

### On-chain Fee Enforcement
An issuance operation is applied only when its carrier transaction has paid the **issuance fee** to
the **treasury** address. If no treasury is configured, issuance is free; the server always sets a
treasury (default: the node's wallet), so on a real node the fee is enforced.

Configuration (env):
```bash
TOKEN_ISSUANCE_FEE=10000000000   # 100 SPN (satoshi) — 0 means free
TREASURY_ADDRESS=SPN1...         # if empty = the node's wallet address
```

### API
- `GET  /api/tokens/fee-info`  — fee, treasury, symbol
- `POST /api/tokens/create`    — paid creation: `{ name, symbol, decimals, supply, privateKey }`
  the user provides their own key so the node can sign the operation with their address and cover
  the fee from their balance; the entire supply is minted to their own address.

### Web Page
`http://localhost:3000/tokens` — a token-creation form (name/symbol/decimals/supply/key), displaying
the fee and treasury, a list of tokens, and a clear security warning.

### ⚠️ Important Security Note
The current model is "custodial-lite": the user sends their private key to the node so the node can
sign and build the fee-payment transaction + issuance operation. This should only be done on a node
the user **trusts** (ideally their own node). The safer, production-grade approach is **client-side**
signing and submitting a pre-signed transaction — which, because it requires a secp256k1 library in
the browser, is not included in this simple version. The on-chain behavior is identical: the fee is
paid, the token is minted to the issuer's address.

### Verification
Tested: fee-less issuance is **rejected**, issuance with a fee **succeeds**, the token reaches a
third-party user, and the treasury receives the fee. The page and APIs respond live.
**58 tests pass, lint with no errors, the server boots healthy.**

---

## Coin vs. Token — the user can create their own "coin"
The user now chooses between two types at creation time (a real distinction, not just a label):

- **Coin:** a **fixed** supply that is **not re-mintable** — the entire supply is minted and locked
  at creation time (like Bitcoin). An attempt to mint is rejected.
- **Token:** can be **mintable**; in that case **only the issuer** can add supply later.

### API
- `POST /api/tokens/create` now takes `type: "coin"|"token"` and `mintable: bool`.
- `POST /api/tokens/mint` — add supply for a mintable token: `{ tokenId, amount, privateKey }`
  (issuer only; rejected for a coin).

### Web Page
At `http://localhost:3000/tokens` a **Coin / Token** selector was added; for a token, a "mintable"
option is shown. The type and mintable status are also shown in the list.

### Verification
Tested: a coin has a fixed supply and its mint is rejected; a mintable token is minted by the issuer
and its supply increases; a non-issuer mint is rejected. **61 tests pass, lint with no errors, the
page and APIs respond live.**

---

## Asset Management Page (`/manage`) — with an identity lock
After creation, the owner of a coin/token can manage it, but the **name, symbol, and supply
(count) are locked and immutable** — there is no way to change them in the UI or in the protocol
(no operation to edit them is defined).

`http://localhost:3000/manage`

- **View by address (no key):** the user enters their address; the assets they have issued
  or hold are loaded.
- **Locked identity:** name/symbol/supply are each shown with a 🔒 mark and read-only.
- **Action with key (only at signing time):**
  - **Transfer** — transfer a balance to another address (`POST /api/tokens/send`).
  - **Mint more** — only for a mintable token and only by the issuer (`POST /api/tokens/mint`).
    Coins are never minted (fixed supply).

The private key is sent to the node only at the moment of signing a transfer/mint (viewing is
entirely key-free) and a security warning is displayed.

### Verification
Tested: no operation changes name/symbol/supply; key-based transfer and issuer mint work; the page
and endpoints respond live. **61 tests pass, lint with no errors, the server boots healthy.**
