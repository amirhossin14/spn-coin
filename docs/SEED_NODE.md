# Running a SPN Coin Seed Node

A **seed node** is a stable, always-on node that new nodes connect to when
they first join the network. It's the entry point that makes peer discovery
possible. A healthy network has several independent seed nodes.

## Requirements

- A server with a **static public IP** or stable domain
- Node.js >= 20
- Always-on (use a process manager like PM2)

## Setup

```bash
# 1. Install
unzip SPN Coin.zip && cd SPN Coin
npm install --production

# 2. Configure .env
cat > .env << 'ENV'
NODE_ENV=production
PORT=3000
CHAIN_ID=3                      # 3 = testnet
JWT_SECRET=<random-32-bytes>
JWT_REFRESH_SECRET=<random-32-bytes>
NODE_SECRET=<shared-testnet-secret>
PEER_URLS=
ENV

# Generate secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Run under PM2
sudo npm install -g pm2
pm2 start server.js --name spncoin-seed
pm2 save && pm2 startup
```

## Make it reachable

Put it behind a reverse proxy with TLS so peers can use `https://`:

```nginx
server {
    listen 443 ssl;
    server_name seed1.yourdomain.org;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo certbot --nginx -d seed1.yourdomain.org
```

## Verify it's working

```bash
curl https://seed1.yourdomain.org/api/p2p/status
# should return { nodeId, height, peers, chainId }
```

## Publish your seed address

Share your seed URL so others can join:

```bash
./join-testnet.sh https://seed1.yourdomain.org
```

## Monitoring

```bash
npm run monitor https://seed1.yourdomain.org
```

## Health & uptime

- Seed nodes should target high uptime — peers depend on them
- Run `npm run monitor` from another machine to watch sync status
- Consider running 2–3 seed nodes in different regions for resilience
