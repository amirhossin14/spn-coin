# Contributing to SPN Coin

Thanks for your interest! SPN Coin is an open, honest, experimental blockchain
project. No hidden pre-mine, no profit promises, no hype.

## Ground rules

- This is **educational/experimental software**. Never represent SPN as having
  monetary value or as an investment.
- Be honest in all documentation and communication.
- Keep the codebase clean, tested, and dependency-light (5 runtime deps).

## Getting started

```bash
git clone <repo-url>
cd SPN Coin
npm install
npm test          # make sure tests pass before changing anything
npm run testnet   # spin up a local 3-node network
```

## Development workflow

1. Fork & branch: `git checkout -b feature/my-change`
2. Make your change with a clear, focused scope
3. Add or update tests in `test/`
4. Run `npm test` and `npm run lint` — both must pass
5. Open a pull request describing **what** and **why**

## Code style

- Run `npm run lint` (ESLint config included)
- Match the existing style: 4-space indent, clear names, comments for consensus-critical logic
- Consensus changes (anything in `blockchain/`) need tests proving they don't break validation

## Areas where help is welcome

- More test coverage (mempool, P2P sync, script engine edge cases)
- Performance: block validation, UTXO set lookups
- Documentation & tutorials
- Independent security review of the crypto and consensus code

## Reporting bugs

Open an issue with: what you expected, what happened, and steps to reproduce.
For anything security-sensitive, please disclose privately first.
