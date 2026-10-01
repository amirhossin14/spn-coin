# SPN Coin Token (SPN) — Path A

Secure, fixed-supply ERC-20 token for deployment on Ethereum / L2, built on
audited OpenZeppelin v5. See `../docs/PATH_A_ROADMAP.md` for the full roadmap.

## Quick start
```bash
cp .env.example .env   # fill in keys; never commit
npm install
npm run compile
npm test
npm run deploy:baseSepolia   # testnet deploy
```

## Design
- Fixed supply (21,000,000 SPN) minted once in the constructor — no `mint()`.
- ERC20 + ERC20Burnable + ERC20Permit (EIP-2612).
- No owner / blacklist / tax / pausable — minimal privileged surface.
- Send the initial supply to a multisig (Gnosis Safe), never a single EOA.

> Verified to compile cleanly with solc 0.8.24.
