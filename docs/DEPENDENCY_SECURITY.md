# Dependency & Supply-Chain Security

## npm audit

Run a vulnerability scan of production dependencies:

```bash
npm audit --omit=dev
```

CI runs this automatically on every push (see `.github/workflows/ci.yml`,
job `security`) and **fails the build on any high/critical** advisory.

### Current status

After `npm audit fix`, the only remaining advisory is:

- **elliptic** — GHSA-848j-6mx2-7j84 (*low* severity). `elliptic@6.6.1` is the
  latest release and there is **no upstream fix** yet.
  - **Impact on SPN Coin is minimal, and this is now test-enforced.** The
    security-critical path — verifying externally-supplied signatures
    (`verify()` in `blockchain/crypto.js`) — uses Node's native `crypto`, never
    elliptic. That is where untrusted input is checked, so the advisory does
    not touch our real attack surface.
  - elliptic is only used to *derive* key material: converting a raw 32-byte
    private key into PKCS8/SPKI DER (`keyPairFromRawPrivate`, used by the HD
    wallet) and for client-side signing in the browser. No untrusted signature
    is ever verified through elliptic.
  - `test/elliptic-isolation.test.js` guards this boundary: it fails the build
    if `verify()` ever starts depending on elliptic, and confirms HD-derived
    keys still sign/verify through the native path.
  - We track upstream for a patched release and will bump when available.

## Subresource Integrity (SRI) for CDN scripts

The wallet/token pages load two libraries from cdnjs (elliptic, Chart.js).
To pin them against CDN tampering, add SRI hashes **from a machine with
internet access**:

```bash
bash scripts/add-sri.sh
```

This downloads each script, computes its SHA-384 hash, and injects
`integrity="sha384-…"` into the `<script>` tags. `crossorigin="anonymous"`
and `referrerpolicy="no-referrer"` are already set on those tags.

> We ship without pinned hashes because an incorrect hash would block the
> script and break signing. Generating them on a networked machine guarantees
> they match the exact file the browser fetches.

## Keeping dependencies current

```bash
npm outdated        # see what's behind
npm update          # apply semver-compatible updates
npm audit fix       # apply security patches
```
