# Running a Real SPN Coin Seed Node on a VPS

A complete, practical guide to standing up your **first real, always-on seed
node** on a public server. A seed node is the stable entry point that new peers
connect to when they join the network — it's the first concrete step toward a
live, distributed network.

> **What this is / isn't.** Running a node is simply running software — it is
> legal and involves no financial activity. This guide does not create, sell, or
> value any coin. It only makes your node reachable by others.

---

## 0. What you'll need

| Item | Detail | Typical cost |
|------|--------|--------------|
| A VPS | 2 vCPU, 2–4 GB RAM, 40–80 GB SSD, Ubuntu 22.04+ | $5–$20/month |
| A domain (optional but recommended) | e.g. `spn-seed.yourdomain.com` | ~$10/year |
| SSH access to the VPS | provided by your host | — |
| The SPN Coin code | from your GitHub repo (see Part B) | free |

Good, affordable VPS providers: Hetzner, DigitalOcean, Vultr, Contabo, Linode.

---

## 1. First login & basic hardening

SSH into your fresh server as root:

```bash
ssh root@YOUR_SERVER_IP
```

Create a non-root user (never run services as root):

```bash
adduser spn
usermod -aG sudo spn
# copy your SSH key so you can log in as spn
rsync --archive --chown=spn:spn ~/.ssh /home/spn
su - spn
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Firewall (UFW)

Only open the ports you actually need. SPN uses an HTTP/API port and a P2P port
(defaults shown; adjust if you changed them).

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH             # keep yourself able to log in!
sudo ufw allow 3000/tcp            # HTTP/API (or 443 if you use TLS)
sudo ufw allow 8333/tcp            # P2P port (adjust to your P2P_PORT)
sudo ufw enable
sudo ufw status verbose
```

> Double-check `OpenSSH` is allowed **before** enabling UFW, or you can lock
> yourself out.

---

## 3. Install Node.js (>= 20)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # should print v20.x or newer
```

---

## 4. Get the code & install

```bash
cd ~
git clone https://github.com/<YOUR_USER>/spn-coin.git
cd spn-coin
npm install --omit=dev
```

Run the tests once to confirm everything works on this machine:

```bash
CHAIN_ID=3 npm test        # expect all tests passing
```

---

## 5. Configuration

Create an environment file (never commit this):

```bash
cat > ~/spn-coin/.env <<'EOF'
# --- Network ---
CHAIN_ID=3                 # 3 = testnet (recommended to start), 1 = mainnet
PORT=3000
P2P_PORT=8333

# --- Public identity ---
# The address other nodes will use to reach you:
PUBLIC_HOST=spn-seed.yourdomain.com   # or your raw server IP

# --- Secrets (generate strong random values!) ---
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
JWT_REFRESH_SECRET=CHANGE_ME_TO_ANOTHER_LONG_RANDOM_STRING
EOF
```

Generate strong secrets easily:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 6. Run it permanently with systemd

So the node restarts on crash and on server reboot, run it as a systemd service.

```bash
sudo tee /etc/systemd/system/spn-node.service > /dev/null <<'EOF'
[Unit]
Description=SPN Coin Seed Node
After=network.target

[Service]
Type=simple
User=spn
WorkingDirectory=/home/spn/spn-coin
EnvironmentFile=/home/spn/spn-coin/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
# basic hardening
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable spn-node
sudo systemctl start spn-node
sudo systemctl status spn-node        # should show "active (running)"
```

View live logs:

```bash
journalctl -u spn-node -f
```

---

## 7. Domain + HTTPS (recommended)

If you pointed a domain's A-record at your server IP, add free HTTPS with a
reverse proxy so your API is served over `https://`.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/spn > /dev/null <<'EOF'
server {
    server_name spn-seed.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket support
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/spn /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d spn-seed.yourdomain.com   # issues + installs SSL
```

Certbot auto-renews the certificate.

---

## 8. Make it a *seed* (so others can find it)

A seed node is only useful if new peers know its address. Two ways:

1. **Direct peer address.** Share your node's public address
   (`spn-seed.yourdomain.com:8333` or `IP:8333`) so others can add it with
   `scripts/join-network.sh`.
2. **DNS seed.** Replace the placeholder hostnames in the DNS-seed config
   (`p2p/dnsseed.js`, currently `seed1.spncoin.example`) with your real domain,
   commit, and redeploy. New nodes will then discover you automatically.

---

## 9. Verify it's reachable

From your **own machine** (not the server):

```bash
curl https://spn-seed.yourdomain.com/api/health
```

You should get a JSON health response. If it times out, check: UFW rules, that
the service is running (`systemctl status spn-node`), and that your domain's
A-record points to the server.

---

## 10. Ongoing operation

- **Logs:** `journalctl -u spn-node -f`
- **Restart:** `sudo systemctl restart spn-node`
- **Update code:**
  ```bash
  cd ~/spn-coin && git pull && npm install --omit=dev
  sudo systemctl restart spn-node
  ```
- **Backups:** periodically copy the chain `data/` directory somewhere safe.
- **Monitoring (optional):** the node exposes Prometheus metrics at `/metrics`.

---

## 11. Growing from one node to a network

One seed node is the start, not the finish. A real network needs **independent
operators** — other people running their own nodes on their own servers.

- Document the join steps clearly (point people to `scripts/join-network.sh`).
- Recruit a few technically-minded people to each run a node.
- Aim for nodes in different locations and under different operators — that
  independence is what makes the network real.

> This is the genuinely hard, non-technical part. It takes time and a real
> community. There is no shortcut and no code that produces it — but a stable,
> well-documented seed node like the one you just built is exactly the
> foundation it needs.

---

*Running a node is lawful, non-financial activity. This guide does not create or
assign monetary value to any coin.*
