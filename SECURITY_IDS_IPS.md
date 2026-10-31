# IDS / IPS — Intrusion Detection and Prevention System

A unified security layer added on top of the existing infrastructure (ThreatScorer, AnomalyDetector,
honeypot, DDoS blocklist) to make the project more complete from a security standpoint.

## What it does
- **Signature engine:** checks each request against attack patterns:
  SQL Injection, XSS, Path Traversal, Command Injection, File Inclusion (LFI/RFI),
  SSRF, NoSQL Injection, scanning tools (sqlmap/nikto/nmap/…) and reconnaissance probes for
  sensitive paths (`.env`, `.git`, `wp-admin`, …). Inspection is performed on the **path, query, JSON
  body, and headers/UA**.
- **IDS (detection):** each match is recorded as an event with a severity (low→critical) and logged to the
  console; the last 500 events are kept in memory.
- **IPS (prevention):** a per-IP threat score with time-based decay. A **critical** attack
  (such as command injection) is blocked immediately; otherwise, once the threshold is exceeded,
  the IP is blocked with a **stepped ban** (15 minutes → 1 hour → … up to 24 hours for a repeat attacker).
  An early block-gate rejects banned IPs before any processing.
- **Whitelist:** `127.0.0.1`, `::1` and trusted IPs are never blocked
  (preventing self-lockout).

## Configuration (environment variables)
```bash
IDS_IPS_MODE=ips        # ips (detect+block, default) | ids (detect only) | off
SECURITY_WHITELIST=1.2.3.4,5.6.7.8   # trusted IPs (comma-separated)
```

## Admin API (authentication required)
- `GET  /api/security/stats`        — engine stats (mode, detection/block count, active bans)
- `GET  /api/security/events?limit=100` — latest detection events
- `GET  /api/security/blocklist`    — currently banned IPs
- `POST /api/security/block`        — manual ban `{ ip, minutes?, reason? }`
- `DELETE /api/security/block/:ip`  — unban

## Verification
- ✅ Detection of SQLi/XSS/traversal/command-injection/scanner was tested.
- ✅ Clean requests pass without a match (no false-positive on normal APIs).
- ✅ A critical attack immediately gets a 403 and the IP is banned; the same IP's next request also gets 403.
- ✅ localhost on the whitelist is never blocked.
- ✅ `ids` mode only logs and does not block.
- ✅ 40 tests pass, lint with no errors, the server boots cleanly.
