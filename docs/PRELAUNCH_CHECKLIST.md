# Realistic Pre-Launch Checklist

A document for driving the work forward with your team and lawyer. Do not skip any section before it is checked off.

> ⚖️ Disclaimer: I am not a lawyer or financial advisor. The legal items are merely general notes and are not a substitute for professional advice. In the UK, breaching crypto regulations can be a **criminal offense** — be sure to consult a specialized lawyer before any public offering.

---

## Part 1 — Technical

- [ ] Final architecture decision: a token on L2/Ethereum (Path A) or an L1 with a serious framework
      (Cosmos SDK / Substrate). Writing an L1 from scratch on Node.js for mainnet is not an option.
- [ ] A written and finalized supply model and tokenomics (total supply, team allocation, vesting, liquidity).
- [ ] A clean-compiling contract/protocol + complete tests (unit + scenario) all green.
- [ ] Deployment and multi-week trial on a **public testnet** with real users.
- [ ] Contract source **verified** on the explorer.
- [ ] Wallet, explorer, and user documentation ready.
- [ ] Stable infrastructure: seed nodes, monitoring (Prometheus/Grafana), backups, alerting.
- [ ] An incident response plan and an emergency key/multisig.

## Part 2 — Security

- [ ] **No hand-rolled cryptography in mainnet** — only audited libraries.
- [ ] **Independent security audit** by a reputable firm, with a publicly published report.
- [ ] Static analysis (Slither) and fuzz testing run and remediated.
- [ ] Project assets in a **multisig** (e.g., Gnosis Safe), not a single wallet.
- [ ] Private keys never in code/git; key management and rotation documented.
- [ ] A **bug bounty** program (e.g., Immunefi) active.
- [ ] Privileged functions minimized; every remaining privilege justified and documented.
- [ ] Liquidity lock/vesting and team tokens on a scheduled, publicly verifiable basis.
- [ ] Server-side security (for the faucet/explorer/API): TLS, rate-limiting, dependency updates.

## Part 3 — Legal and Regulatory (focus: UK)

> The UK has just built a full licensing regime for crypto; the "almost unregulated" space is closing.

- [ ] **Consult a specialized crypto lawyer in the UK — before any public action.**
- [ ] Determine which regulatory category your token falls into (utility / security /
      stablecoin / ...). Note: "being decentralized" does not by itself exempt you from regulation
      — the FCA has said exactly this.
- [ ] Assess the need for **authorisation from the FCA** under the new regime (The Financial
      Services and Markets Act 2000 (Cryptoassets) Regulations 2026). The application window
      opened on 30 September 2026 and full enforcement of the regime is around October 2027; keep
      these dates updated with your lawyer and official FCA sources.
- [ ] Comply with **financial promotions** rules (advertising crypto to a UK consumer
      has strict rules).
- [ ] **AML/KYC** requirements and necessary registrations.
- [ ] If a stablecoin is intended: issuing it in the UK has special, stricter rules.
- [ ] A clear and lawful corporate structure, taxation, and jurisdiction of operation.
- [ ] Legal documents: terms of use, risk disclaimers, privacy policy.
- [ ] Review the regulations of every **other jurisdiction** where your target users are (not just the UK).

## Part 4 — Operations and Community

- [ ] Official, verified communication channels (anti-spoofing and anti-phishing).
- [ ] A transparency plan: publishing the contract address, audit report, and lock status.
- [ ] A crisis management plan (e.g., discovering a vulnerability after launch).
- [ ] Realistic expectations: the vast majority of new tokens fail; liquidity, trust, and real
      utility take years.

---

### One-Line Summary
A "serious launch" is more of a legal-economic-team project than a coding one. Keep the code secure and boring, and do not engage real value before an audit and legal counsel.
