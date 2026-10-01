# High Availability Guide — Keeping Sepanta (SPN) Up Under Load

**Goal:** the service keeps working for users even when individual pieces fail,
and stays responsive from a handful of users up to millions. No system is
"never down" — the real target is *fault tolerance*: when one part breaks, the
rest carries the load and users don't notice.

This project ships the building blocks for that. Here's how they fit together
and what to do at each scale.

---

## The five layers of staying up

### 1. Self-healing processes (restart on crash)
Every service in `docker/docker-compose.prod.yml` uses `restart: unless-stopped`.
If a node process crashes, Docker restarts it automatically within seconds. On a
single VPS without Docker, use a process manager (systemd or PM2) with the same
effect:

```ini
# /etc/systemd/system/spn.service
[Service]
ExecStart=/usr/bin/node /opt/spn/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
```

### 2. Multiple nodes + load balancer (no single point of failure)
The production compose runs **three** app nodes (`node1/2/3`) behind **HAProxy**
(`ha/haproxy.cfg`). HAProxy health-checks each node on `/api/health` every few
seconds; a node that fails is removed from rotation automatically and added back
when it recovers. One node crashing → users are served by the other two and
never see an error.

- Live health dashboard: `http://<host>:8404/`
- Add capacity by adding `server node4 node4:3000 check` lines and scaling out.

### 3. Database durability + read scaling
- **Primary Postgres** stores the durable state (blocks, txs, users, KYC).
- Add a **read replica** for the explorer's heavy read traffic (see
  `docs/DATABASE_SCALING.md`) so reads never slow down writes.
- **Redis** absorbs sessions/rate-limit counters and hot lookups, taking load
  off Postgres. It's already in the prod stack.
- Back up Postgres continuously (below) so even total disk loss is recoverable.

### 4. Horizontal scaling (millions of users)
When one machine isn't enough:
- Run app nodes on **several machines**, all behind HAProxy (or a cloud LB).
  The app is stateless per-request (JWT + shared DB/Redis), so you can add nodes
  freely.
- Put a **CDN** (Cloudflare, etc.) in front of the static site + assets so most
  page/asset traffic never even reaches your servers.
- Partition the big tables and add read replicas (`docs/DATABASE_SCALING.md`).
- The blockchain layer itself scales by running more **P2P nodes** — the more
  independent operators, the more resilient the chain (this is the non-code
  part: growing the operator community).

### 5. Monitoring + alerts (know before users do)
The prod stack includes **Prometheus + Grafana + Alertmanager + exporters**
(node, postgres, redis). This means:
- Grafana dashboards show CPU, memory, request rate, DB health in real time.
- Alertmanager can page/email you the moment a node goes unhealthy — so you fix
  issues before they become outages.
- The app exposes metrics at `/metrics` (Prometheus format).

---

## What to do at each stage

| Stage | Users | Setup |
|-------|-------|-------|
| Dev / test | you | Local machine, `npm start` |
| Launch | up to ~10k | 1 VPS, systemd auto-restart, daily DB backup, Cloudflare in front |
| Growing | ~10k–100k | Prod compose (3 nodes + HAProxy + Postgres + Redis + monitoring) on one strong VPS |
| Scale | 100k–millions | App nodes across several machines, Postgres primary + replicas, Redis, CDN, partitioned tables |

You don't need the full stack on day one. Start simple and add layers as real
traffic grows — every layer above is independent.

---

## Database backups (do this from day one)

Even perfect uptime doesn't protect against data loss. Automate Postgres backups:

```bash
# Daily logical backup, keep 14 days
pg_dump -Fc "$DATABASE_URL" > /backups/spn-$(date +%F).dump
find /backups -name 'spn-*.dump' -mtime +14 -delete
```

For point-in-time recovery at scale, enable WAL archiving / use a managed
Postgres with automated backups.

---

## Quick resilience checklist

- [ ] `restart: unless-stopped` (Docker) or `Restart=always` (systemd) on every service
- [ ] At least 2–3 app nodes behind HAProxy (`ha/haproxy.cfg`)
- [ ] `/api/health` returning 200 (HAProxy uses it to route around failures)
- [ ] Strong secrets in env: `JWT_SECRET`, `DB_PASSWORD`, `REDIS_PASSWORD`, `CSRF_SECRET`
- [ ] Automated daily Postgres backups, tested restore
- [ ] Prometheus + Grafana + Alertmanager running; alerts wired to your email
- [ ] CDN in front of static assets
- [ ] Read replica + partitioning once tables get large (`docs/DATABASE_SCALING.md`)
- [ ] Grow independent P2P node operators for chain-level resilience

---

**Bottom line:** the difference between "one server that can crash" and "a
service that stays up" is redundancy at every layer — processes, nodes, database,
and monitoring. This project already includes those pieces; your job is to turn
them on progressively as your user base grows, and to keep good backups.
