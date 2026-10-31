# Two-Factor Authentication (2FA) — Google Authenticator

To increase login security, TOTP-based 2FA (compatible with Google Authenticator,
Authy, and any TOTP app) was added to the project.

## Components
- `app/totp.js` — a standard implementation of **RFC 6238/4226** (SHA-1, 6 digits, 30 seconds,
  base32 secret, and an `otpauth://` URI for the QR). No external dependencies.
- `AccessControl` methods: `setupTotp`, `confirmTotp`, `disableTotp`, `getTotpStatus`.
- The 2FA gate in `login`: if enabled, login is not possible without a valid code (`require2fa`),
  with failed-attempt counting and account lockout, and a timing-safe comparison.

## User flow (the endpoints were already in the server)
1. `POST /api/auth/2fa/setup`  → returns `{ secret, otpauthUrl, issuer }`.
   The user scans `otpauthUrl` as a QR code in the authenticator app.
2. `POST /api/auth/2fa/confirm` with `{ token }` → **enables** 2FA with the first code.
3. From then on, `POST /api/auth/login` must also include `totp`; without a code → `require2fa:true`.
4. `POST /api/auth/2fa/disable` with `{ token }` → disabling (requires a valid code).
5. `GET  /api/auth/2fa/status` → `{ enabled }`.

The `admin.html` and `dashboard.html` pages already had the UI for these, and they now work.

## Verification
- ✅ Matches the official RFC 4226 vectors (HOTP c=0..4) and RFC 6238 (TOTP@59s=287082).
- ✅ Full enable/login/disable flow and clock-drift tolerance (±1 step).
- ✅ In the test suite (now 34 tests passing), lint with no errors, the server boots healthy.
