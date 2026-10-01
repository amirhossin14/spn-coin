# اتصال دامنه به سرور — راهنمای کامل
# Connecting Your Domain to the Server

این راهنما نشان می‌دهد چطور دامنه‌ات (مثلاً spnchain.com) را به سرور VPS وصل کنی
تا کاربران بتوانند با https://spnchain.com به نود SPN دسترسی داشته باشند.

پیش‌نیاز:
  - یک VPS با IP عمومی (مثلاً از Hetzner) — فرض: 203.0.113.50
  - یک دامنه (مثلاً spnchain.com)
  - پروژه‌ی SPN روی سرور نصب شده و با npm start اجرا می‌شود

═══════════════════════════════════════════════════════════════════════
  دو روش وجود دارد — روش ۱ (Cloudflare) بسیار ساده‌تر و امن‌تر است
═══════════════════════════════════════════════════════════════════════


╔═════════════════════════════════════════════════════════════════════╗
║  روش ۱ — با Cloudflare (توصیه‌شده ⭐)                                ║
║  ساده، رایگان، با HTTPS خودکار و محافظت DDoS                        ║
╚═════════════════════════════════════════════════════════════════════╝

با این روش، Cloudflare بین کاربر و سرورت می‌نشیند:
  کاربر → Cloudflare (HTTPS + محافظت) → سرور تو

مزیت: HTTPS رایگان و خودکار، مخفی ماندن IP سرورت، محافظت DDoS رایگان.


── قدم ۱: دامنه را به Cloudflare اضافه کن ──
  1. در cloudflare.com ثبت‌نام کن (رایگان)
  2. دکمه "Add a site" → دامنه‌ات را وارد کن (spnchain.com)
  3. پلن Free را انتخاب کن
  4. Cloudflare دو تا "Nameserver" به تو می‌دهد (مثل xxx.ns.cloudflare.com)


── قدم ۲: Nameserver ها را در جای خرید دامنه تنظیم کن ──
  1. به سایتی که دامنه را خریدی برو (Namecheap و...)
  2. بخش "Nameservers" یا "DNS" را پیدا کن
  3. Nameserver های Cloudflare را جایگزین کن
  4. (این تغییر ممکن است چند ساعت طول بکشد)


── قدم ۳: رکورد DNS بساز (دامنه → IP سرور) ──
  در داشبورد Cloudflare، بخش DNS → Add record:

  Type:   A
  Name:   @                    (یعنی خود spnchain.com)
  IPv4:   203.0.113.50         (IP سرور VPS تو)
  Proxy:  🟠 Proxied (روشن)     ← مهم: این محافظت را فعال می‌کند

  یک رکورد دیگر برای www:
  Type:   A
  Name:   www
  IPv4:   203.0.113.50
  Proxy:  🟠 Proxied


── قدم ۴: SSL را روی Full بگذار ──
  در Cloudflare → SSL/TLS → Overview:
  حالت را روی "Full" بگذار (یا "Flex" اگر سرورت HTTPS ندارد)


── قدم ۵: سرورت را روی پورت 3000 اجرا کن ──
  روی سرور:
      ACCESS_KEY=... JWT_SECRET=... PORT=3000 npm start

  (بهتر: از فایل .env استفاده کن که secret ها را دارد)

  تمام! حالا https://spnchain.com به سرورت وصل است.


═══════════════════════════════════════════════════════════════════════


╔═════════════════════════════════════════════════════════════════════╗
║  روش ۲ — بدون Cloudflare (Nginx + Let's Encrypt)                    ║
║  کنترل کامل‌تر، اما پیچیده‌تر                                        ║
╚═════════════════════════════════════════════════════════════════════╝

با این روش، Nginx روی سرورت به‌عنوان "reverse proxy" کار می‌کند و
گواهی SSL رایگان از Let's Encrypt می‌گیرد.


── قدم ۱: رکورد DNS (در جای خرید دامنه) ──
  Type: A | Name: @   | Value: 203.0.113.50 (IP سرورت)
  Type: A | Name: www | Value: 203.0.113.50


── قدم ۲: Nginx و Certbot نصب کن (روی سرور اوبونتو) ──
      sudo apt update
      sudo apt install nginx certbot python3-certbot-nginx -y


── قدم ۳: تنظیم Nginx ──
  فایل بساز:  sudo nano /etc/nginx/sites-available/spnchain

  محتوا:
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

  فعالش کن:
      sudo ln -s /etc/nginx/sites-available/spnchain /etc/nginx/sites-enabled/
      sudo nginx -t
      sudo systemctl reload nginx


── قدم ۴: گواهی SSL رایگان بگیر ──
      sudo certbot --nginx -d spnchain.com -d www.spnchain.com

  Certbot خودکار HTTPS را تنظیم می‌کند و هر ۹۰ روز تمدید می‌کند.


── قدم ۵: سرورت را اجرا کن ──
      PORT=3000 npm start


═══════════════════════════════════════════════════════════════════════
  فایروال — پورت‌هایی که باید باز باشند
═══════════════════════════════════════════════════════════════════════

روی سرور اوبونتو (با ufw):
      sudo ufw allow 22        # SSH (برای مدیریت سرور)
      sudo ufw allow 80        # HTTP
      sudo ufw allow 443       # HTTPS
      sudo ufw allow 8333      # P2P (ارتباط بین نودها)
      sudo ufw allow 3333      # Stratum (استخراج) — فقط اگر ماینر خارجی داری
      sudo ufw enable

نکته: پورت 3000 را از بیرون باز نکن! فقط Nginx/Cloudflare به آن دسترسی دارد.


═══════════════════════════════════════════════════════════════════════
  نگه داشتن سرور روشن (حتی بعد از بستن ترمینال)
═══════════════════════════════════════════════════════════════════════

با npm start، اگر ترمینال را ببندی سرور می‌خوابد. برای همیشه‌روشن بودن:

روش ساده (PM2):
      npm install -g pm2
      pm2 start server.js --name spn-node
      pm2 save
      pm2 startup           # تا بعد از ری‌استارت سرور هم خودکار روشن شود

دستورات مفید PM2:
      pm2 logs spn-node     # دیدن لاگ‌ها
      pm2 restart spn-node  # ری‌استارت
      pm2 stop spn-node     # توقف


═══════════════════════════════════════════════════════════════════════
  تست نهایی
═══════════════════════════════════════════════════════════════════════

  1. مرورگر → https://spnchain.com
  2. باید داشبورد SPN باز شود با قفل سبز (HTTPS) 🔒
  3. https://spnchain.com/explorer.html → کاوشگر
  4. https://spnchain.com/admin.html → پنل ادمین


═══════════════════════════════════════════════════════════════════════
  ⚠️  مهم: دامنه‌ات را در ALLOWED_ORIGINS بگذار
═══════════════════════════════════════════════════════════════════════

در حالت production، پروژه فقط به origin های شناخته‌شده جواب می‌دهد.
حتماً در فایل .env این را اضافه کن (وگرنه بعضی درخواست‌ها بلاک می‌شوند):

    ALLOWED_ORIGINS=https://spnchain.com,https://www.spnchain.com

(دامنه‌ی واقعی خودت را بگذار)


═══════════════════════════════════════════════════════════════════════
  نکته‌ی مهم برای موقعیت تو (تحریم)
═══════════════════════════════════════════════════════════════════════

  - دامنه و VPS را شریک اماراتی‌ات بگیرد (پرداخت با کارت اماراتی)
  - Cloudflare معمولاً برای مدیریت از ایران مشکلی ندارد، اما اگر مسدود شد،
    از طریق شریک اماراتی یا VPN مدیریت کن
  - IP سرور را با کسی به اشتراک نگذار (Cloudflare آن را مخفی می‌کند)
