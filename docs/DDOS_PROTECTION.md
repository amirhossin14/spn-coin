# DoS / DDoS Protection & Security Hardening

SPN Coin ships with four layers of defense against denial-of-service attacks
and intrusion attempts. All are enabled by default and wired into `server.js`.

---

## 1. Volumetric attack protection — `middleware/ddos-guard.js`

Defends against high-volume floods:

- **Per-IP concurrent-connection cap** (default 50) — one IP can't hog
  connections. Tune with `DDOS_MAX_CONN_PER_IP`.
- **Adaptive global shedding** — when total traffic crosses a soft limit
  (default 800 req/s) the server starts shedding load; past a hard limit
  (default 1500 req/s) it sheds aggressively. Tune with `DDOS_GLOBAL_SOFT`
  and `DDOS_GLOBAL_HARD`.
- **Burst/anomaly auto-ban** — a sudden spike from one IP triggers a temporary
  ban.

Disable (not recommended) with `DDOS_GUARD=0`.

## 2. Rate limiting — `middleware/ratelimit.js`

A **sliding-window** limiter caps requests per IP over a time window, applied
globally and with stricter limits on sensitive routes (login, token creation).
Returns HTTP 429 when exceeded. This is what makes rapid page refreshes briefly
return 403/429 — expected behavior, not a bug.

## 3. Intrusion Detection & Prevention — `middleware/ids-ips.js`

A signature engine inspects the path, query, body, and headers of every
request for known attack patterns:

- SQL injection, XSS, path traversal, command injection
- File inclusion (LFI/RFI), SSRF, NoSQL injection
- Scanner tools by User-Agent (sqlmap, nikto, nmap, nuclei, …)

**Scoring:** each hit adds a weighted score. A single **critical** hit (e.g.
command injection) blocks immediately; lower-severity hits accumulate, and once
the cumulative score crosses the threshold (default 70) the IP is
**auto-banned with an escalating TTL**. This design blocks real attacks while
avoiding false-positive bans from a single borderline request.

Modes via `IDS_IPS_MODE`: `ips` (detect + block, default), `ids` (detect + log
only), or `off`.

## 4. Security hardening — `middleware/hardening.js`

Sets protective HTTP headers (request-id tracing, no-sniff, frame options),
validates input fields, and normalizes requests to shrink the attack surface.

---

## Monitoring

Live security data is exposed via authenticated endpoints and visualized on
the **Threat Radar** page (`/radar`):

- `GET /api/security/stats` — summary counters
- `GET /api/security/events` — recent detections
- `GET /api/security/anomalies` — anomaly detector output
- `GET /api/admin/ddos/stats` — DDoS guard counters (admin)

Admins can manually block/unblock IPs:

- `POST /api/admin/ddos/block` `{ ip, duration }`
- `DELETE /api/admin/ddos/block/:ip`

---

## Tuning cheat-sheet (env vars)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DDOS_GUARD` | on | set `0` to disable the DDoS guard |
| `DDOS_MAX_CONN_PER_IP` | 50 | concurrent connections per IP |
| `DDOS_GLOBAL_SOFT` | 800 | req/s to start shedding |
| `DDOS_GLOBAL_HARD` | 1500 | req/s for aggressive shedding |
| `IDS_IPS_MODE` | ips | ips / ids / off |

> **Note on limits:** the defaults suit a single node. On a busy public seed
> node you may raise the global limits; on a private node you may lower them.
