# SPN Coin — Connecting the Bitcoin Modules to the Core

The Bitcoin modules that were built earlier are now active on the **real consensus path**
(not just as a library). This is handled by `bitcoin/integrate.js`, which is called from `server.js`
during startup.

## What was activated

1. **Active mempool with fee-rate + RBF + CPFP**
   A shadow FeeMempool is maintained alongside the main mempool; block transaction selection
   (`getTopN`) now uses a vsize- and CPFP-aware algorithm, and fee estimation
   (`estimateFeeRate`) is available.

2. **SegWit in block mining**
   Every mined block gets a witness commitment in its coinbase.

3. **Witness validation on block acceptance**
   `addBlock` checks every incoming block that has a commitment; an invalid commitment
   causes the block to be rejected.

4. **buildLocator for headers-first synchronization**
   Added to the blockchain so that the SyncManager can build a locator.

## Safety

Every hook is wrapped in try/catch and falls back to the **original behavior** on any error. This means
enabling the integration can never break block mining or validation. An end-to-end test
on a real chain showed that blocks are mined and accepted correctly and that the chain height
grows correctly.

## Control

```bash
BITCOIN_INTEGRATE=0    # fully disable the integration (revert to the old behavior)
MIN_RELAY_RATE=1       # minimum fee rate (sat/vB) for the mempool
```

## Testing

```bash
npx jest test/integrate.test.js   # 7 integration tests
npx jest test/bitcoin.test.js     # 16 Bitcoin capability tests
npx jest test/network.test.js     # 11 network tests
# 34 tests total, all passing
```

*© 2026 SPN Coin Project.*
