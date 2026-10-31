# Path A — Step-by-Step Roadmap for a Token on Ethereum / L2

Goal: launching a secure SPN token on a battle-tested chain, instead of building an L1 from scratch.
Why this path? You borrow consensus security from the network itself (Ethereum/L2), exchange
and wallet support is there from day one, and the attack surface of your code is minimized.

> Warning: I am not a lawyer/financial advisor. Before any **public offering** of the token, the legal section in
> `docs/PRELAUNCH_CHECKLIST.md` and consultation with a specialized crypto lawyer in the UK are mandatory.

---

## Step 0 — Foundational Decisions (before code)

- **Why does this token exist?** If it's just "another token," it will fail. Put the clear
  utility on paper.
- **Supply model:** our version uses a **fixed supply of 21,000,000 SPN** (no later minting).
  This is the safest and most trustworthy model for a launch token.
- **Target chain:** to start, choose an **L2** (Base or Arbitrum) — much lower fees
  and higher speed than Ethereum mainnet, but the same base security.
- **Asset ownership:** the initial supply must go to a **multisig (e.g., Gnosis Safe)**,
  not a single wallet. This is the most important decision against losing a key / a rug.

## Step 1 — Development Environment

```bash
cd contracts
cp .env.example .env        # fill in the keys (never commit)
npm install
npm run compile
npm test                    # the token tests must pass
```

The project uses **Hardhat + OpenZeppelin v5**. The contract is at
`contracts/contracts/SpnCoinToken.sol` and is built only on audited OZ code.

## Step 2 — Understanding the Contract's Security Design

The contract is deliberately "boring" — and that is good:
- **No `mint()`**: the entire supply is created once in the constructor; inflation is impossible.
- **No owner / blacklist / transfer tax / pausable**: every privileged function is an attack
  surface and a red flag for an auditor/exchange/user.
- **`ERC20Permit` (EIP-2612)**: gasless approval.
- **`ERC20Burnable`**: a holder can burn their own tokens.

If you later need controlled minting (e.g., staking rewards), do **not** edit this file;
build a **separate, capped, multisig-owned** minter contract and **audit** it.

## Step 3 — Deployment to Testnet

1. From a public faucet, get test ETH (Sepolia / Base Sepolia / Arbitrum Sepolia).
2. Set the multisig address in `.env` as `RECIPIENT_ADDRESS`.

```bash
npm run deploy:baseSepolia      # or deploy:sepolia / deploy:arbitrumSepolia
```

3. Verify the source on the explorer so users can see the code:

```bash
npx hardhat verify --network baseSepolia <ADDRESS> <RECIPIENT_ADDRESS>
```

## Step 4 — Real Testing on Testnet

- Test transfer, burn, and permit with several real wallets (MetaMask).
- Add the token to a test DEX and create a small liquidity pool to see the trading flow.
- Keep it on testnet for at least several weeks so its behavior settles.

## Step 5 — Security Audit (before mainnet, no exceptions)

- Get an **independent audit** from a well-known firm (even though our contract is minimal,
  an audit is essential for anything holding real value).
- Launch a **bug bounty** program (e.g., on Immunefi).
- Also run static analysis tools (Slither) and fuzz testing (in Foundry).

## Step 6 — Mainnet and Launch

- Deploy to the mainnet of the chosen chain, with supply sent to the multisig.
- Verify the source on the explorer.
- Build liquidity on a reputable DEX (and consider a **liquidity lock**).
- Publish the contract address, audited code, and audit report publicly.
- Request listing on price/data services (e.g., CoinGecko) according to their rules.

## "Anti-Scam" Points That Build Trust

- Fixed and transparent supply, with no hidden mint.
- Project asset ownership in a multisig with known signers.
- Team token lock/vesting on a scheduled, public basis.
- Verified source + published audit report.
- No high-risk functions (changing tax, blacklist, arbitrary pause).

---

Related file: `docs/PRELAUNCH_CHECKLIST.md` (the full pre-launch checklist).
