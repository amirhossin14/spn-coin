# Connecting a Domain to the Server — Complete Guide
# Connecting Your Domain to the Server

This guide shows how to connect your domain (e.g., spnchain.com) to your VPS server
so users can reach the SPN node at https://spnchain.com.

Prerequisites:
  - A VPS with a public IP (e.g., from Hetzner) — assume: 203.0.113.50
  - A domain (e.g., spnchain.com)
  - The SPN project installed on the server and running with npm start

═══════════════════════════════════════════════════════════════════════
  There are two methods — Method 1 (Cloudflare) is much simpler and safer
═══════════════════════════════════════════════════════════════════════


╔═════════════════════════════════════════════════════════════════════╗
║  Method 1 — With Cloudflare (recommended ⭐)                         ║
║  Simple, free, with automatic HTTPS and DDoS protection             ║
╚═════════════════════════════════════════════════════════════════════╝

With this method, Cloudflare sits between the user and your server:
  user → Cloudflare (HTTPS + protection) → your server

Advantage: free and automatic HTTPS, keeping your server's IP hidden, free DDoS protection.


── Step 1: Add the domain to Cloudflare ──
  1. Sign up at cloudflare.com (free)
  2. "Add a site" button → enter your domain (spnchain.com)
  3. Choose the Free plan
  4. Cloudflare gives you two "Nameservers" (like xxx.ns.cloudflare.com)


── Step 2: Set the nameservers at your domain registrar ──
  1. Go to the site where you bought the domain (Namecheap, etc.)
  2. Find the "Nameservers" or "DNS" section
  3. Replace them with Cloudflare's nameservers
  4. (This change may take a few hours)


── Step 3: Create a DNS record (domain → server IP) ──
  In the Cloudflare dashboard, DNS section → Add record:

  Type:   A
  Name:   @                    (meaning spnchain.com itself)
  IPv4:   203.0.113.50         (your VPS server's IP)
  Proxy:  🟠 Proxied (on)       ← important: this enables protection

  Another record for www:
  Type:   A
  Name:   www
  IPv4:   203.0.113.50
  Proxy:  🟠 Proxied


── Step 4: Set SSL to Full ──
  In Cloudflare → SSL/TLS → Overview:
  Set the mode to "Full" (or "Flex" if your server does not have HTTPS)


── Step 5: Run your server on port 3000 ──
  On the server:
      ACCESS_KEY=... JWT_SECRET=... PORT=3000 npm start

  (Better: use a .env file that holds the secrets)

  Done! Now https://spnchain.com is connected to your server.


═══════════════════════════════════════════════════════════════════════


╔═════════════════════════════════════════════════════════════════════╗
║  Method 2 — Without Cloudflare (Nginx + Let's Encrypt)              ║
║  More complete control, but more complex                            ║
╚═════════════════════════════════════════════════════════════════════╝

With this method, Nginx runs on your server as a "reverse proxy" and
gets a free SSL certificate from Let's Encrypt.


── Step 1: DNS record (at your domain registrar) ──
  Type: A | Name: @   | Value: 203.0.113.50 (your server's IP)
  Type: A | Name: www | Value: 203.0.113.50


── Step 2: Install Nginx and Certbot (on an Ubuntu server) ──
      sudo apt update
      sudo apt install nginx certbot python3-certbot-nginx -y


── Step 3: Configure Nginx ──
  Create a file:  sudo nano /etc/nginx/sites-available/spnchain

  Contents:
      server {
          server_name spnchain.com www.spnchain.com;

          location / {
              proxy_pass http://localhost:3000;
              proxy_http_version 1.1;
              proxy_set_header Upgrade $http_upgrade;
              proxy_set_header Connection "upgrade";
              proxy_set_header Host $host;
              proxy_set_header X-Real-IP $remote_addr;
              proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
              proxy_set_header X-Forwarded-Proto $scheme;
          }
      }

  Enable it:
      sudo ln -s /etc/nginx/sites-available/spnchain /etc/nginx/sites-enabled/
      sudo nginx -t
      sudo systemctl reload nginx


── Step 4: Get a free SSL certificate ──
      sudo certbot --nginx -d spnchain.com -d www.spnchain.com

  Certbot automatically configures HTTPS and renews it every 90 days.


── Step 5: Run your server ──
      PORT=3000 npm start


═══════════════════════════════════════════════════════════════════════
  Firewall — ports that must be open
═══════════════════════════════════════════════════════════════════════

On an Ubuntu server (with ufw):
      sudo ufw allow 22        # SSH (for server management)
      sudo ufw allow 80        # HTTP
      sudo ufw allow 443       # HTTPS
      sudo ufw allow 8333      # P2P (communication between nodes)
      sudo ufw allow 3333      # Stratum (mining) — only if you have an external miner
      sudo ufw enable

Note: Do not open port 3000 to the outside! Only Nginx/Cloudflare has access to it.


═══════════════════════════════════════════════════════════════════════
  Keeping the server running (even after closing the terminal)
═══════════════════════════════════════════════════════════════════════

With npm start, if you close the terminal the server goes to sleep. To stay always on:

Simple method (PM2):
      npm install -g pm2
      pm2 start server.js --name spn-node
      pm2 save
      pm2 startup           # so it also starts automatically after a server restart

Useful PM2 commands:
      pm2 logs spn-node     # view logs
      pm2 restart spn-node  # restart
      pm2 stop spn-node     # stop


═══════════════════════════════════════════════════════════════════════
  Final test
═══════════════════════════════════════════════════════════════════════

  1. Browser → https://spnchain.com
  2. The SPN dashboard should open with a green lock (HTTPS) 🔒
  3. https://spnchain.com/explorer.html → the explorer
  4. https://spnchain.com/admin.html → the admin panel


═══════════════════════════════════════════════════════════════════════
  ⚠️  Important: put your domain in ALLOWED_ORIGINS
═══════════════════════════════════════════════════════════════════════

In production mode, the project only responds to known origins.
Be sure to add this to the .env file (otherwise some requests will be blocked):

    ALLOWED_ORIGINS=https://spnchain.com,https://www.spnchain.com

(use your own real domain)


═══════════════════════════════════════════════════════════════════════
  An important note for your situation (sanctions)
═══════════════════════════════════════════════════════════════════════

  - Have your UAE partner obtain the domain and VPS (paying with a UAE card)
  - Cloudflare usually has no issue being managed from Iran, but if it gets blocked,
    manage it through your UAE partner or a VPN
  - Do not share the server IP with anyone (Cloudflare hides it)
