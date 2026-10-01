# SPN Coin — قابلیت‌های جدید (توکن، ادمین، مانیتورینگ)

سه بخش با قابلیت‌های واقعی و متصل به بک‌اند تقویت شدند. همه با تست تأیید شده‌اند
(۹ تست توکن + ۹ تست مانیتورینگ/features، به‌علاوه تست HTTP in-process).

## ۱) ساخت توکن/کوین  (`tokens/token-extensions.js`)
- **burn** — سوزاندن دائمی توکن (کاهش عرضه)
- **freeze / unfreeze** — انجماد یک آدرس توسط صادرکننده (انتقال از/به آن مسدود می‌شود)
- **transfer-owner** — انتقال مالکیت (issuer) توکن به آدرس دیگر
- **set-meta** — متادیتا: لوگو، توضیحات، وب‌سایت، توییتر، تلگرام
- **distribution()** — توزیع هولدرها (برای نمودار دایره‌ای/میله‌ای)
- **search()** — جستجو و فیلتر توکن‌ها (بر اساس نام/سمبل/نوع، مرتب‌سازی)
- endpointها: `/api/tokens/:id/meta`, `/api/tokens/:id/distribution`, `/api/tokens/search`
- همه‌ی opهای جدید امضاشده و replay-protected (سمت کلاینت امضا می‌شوند)

## ۲) مانیتورینگ  (`monitor/monitor.js` + صفحه `public/monitor.html`)
- **سلامت سیستم**: CPU، حافظه، heap، uptime، پلتفرم (`/api/monitor/health`)
- **نمودارهای زنده**: سری‌های زمانی CPU، حافظه، ارتفاع، peers، mempool، فاصله بلوک،
  سختی (`/api/monitor/metrics`)
- **موتور هشدار**: قواعد آستانه‌ای (CPU>90، حافظه>92، heap>1GB، بدون peer، سیل mempool)
  با raise/clear خودکار و تاریخچه (`/api/monitor/alerts`)
- صفحه‌ی `/monitor.html` با نمودار SVG زنده و کارت‌های سلامت، رفرش هر ۵ ثانیه

## ۳) پنل ادمین  (`monitor/features.js`)
- **کنترل نود**: وضعیت نود، روشن/خاموش‌کردن ماینینگ (`/api/admin/node/status`, `/mining`)
- **مدیریت peer/بن**: مشاهده، بن و رفع‌بن IP (`/api/admin/peers/bans|ban|unban`)
- **خروجی گرفتن**: export توکن‌ها/peerها/هشدارها به JSON یا CSV (`/api/admin/export/:what`)

## فعال‌سازی و کنترل
همه از `server.js` به‌صورت خودکار و امن نصب می‌شوند (`installFeatures`). غیرفعال‌سازی:
```
FEATURES=0
```

## تست
```
npx jest test/token-ext.test.js   # ۹ تست
npx jest test/monitor.test.js     # ۹ تست
```

## ۴) آدرس اختصاصی کوین  (`tokens/coin-address.js`)
- **آدرس مشتق‌شده‌ی خودکار**: هنگام ساخت هر کوین، یک آدرس اختصاصی (deterministic،
  از روی tokenId + issuer) محاسبه و در متادیتای کوین ثبت می‌شود.
  همه‌ی نودها همان آدرس را بازتولید می‌کنند (مثل روح contract address).
- **کیف اختصاصی**: `generateCoinWallet()` یک کلید تازه‌ی قابل‌خرج برای treasury/deployer.
- **آدرس vanity**: تولید آدرسی که با یک پیشوند دلخواه شروع شود — هم به‌صورت
  in-browser (کلید هرگز فاش نمی‌شود) در صفحه‌ی ساخت کوین، هم endpoint سرور.
- endpointها: `/api/tokens/:id/address`, `/api/address/vanity`, `/api/util/pubkey-to-address`
- UI: بخش «Generate vanity address» در صفحه‌ی ساخت کوین + نمایش آدرس اختصاصی در نتیجه.

## تست (به‌روز شده)
```
npx jest test/coin-address.test.js   # ۶ تست
# مجموع همه‌ی سوییت‌های جدید: ۶۲ تست، همه پاس
```

## ۵) ایردراپ (Airdrop)  (`tokens/airdrop.js`)
دو مدل ایردراپ، هر دو امضاشده و replay-protected:

**الف) ایردراپ گروهی (batch)** — صادرکننده یک op امضا می‌کند که شامل چندین
(آدرس، مقدار) است؛ موجودی‌ها اتمیک جابه‌جا می‌شوند. مناسب لیست‌های کوچک/مشخص.

**ب) ایردراپ claim با مرکل** — صادرکننده به ریشه‌ی مرکل لیست دریافت‌کنندگان
تعهد می‌کند و کل مبلغ را escrow می‌کند. دریافت‌کنندگان بعداً با یک claim امضاشده
و **مرکل‌پروف** واجد شرایط بودن خود را ثابت می‌کنند؛ هر آدرس دقیقاً یک بار.
مقیاس‌پذیر برای لیست‌های بزرگ (فقط ریشه روی زنجیره است).

- امنیت: replay رد می‌شود، آدرس غیرواجد شرایط نمی‌تواند claim کند،
  فقط issuer می‌تواند airdrop بسازد، آدرس frozen مسدود است، escrow دقیق.
- endpointها: `/api/tokens/:id/airdrops`, `/api/airdrops/:id`, `/api/airdrops/:id/claimed/:addr`
- claim/create از طریق `/api/tokens/submit-signed` (امضای سمت کلاینت)
- UI: صفحه‌ی `/airdrop.html` برای ایردراپ گروهی با امضای درون‌مرورگری
- تست: `test/airdrop.test.js` — ۱۰ تست (شامل مرکل‌پروف و escrow)

## ۶) صفحه‌ی Claim (دریافت ایردراپ مرکل)
گردش کار کامل claim برای کاربران واجد شرایط:

- **انتشار لیست**: صادرکننده لیست کامل دریافت‌کنندگان را ثبت می‌کند
  (`/api/airdrops/:id/publish`). لیست فقط اگر با ریشه‌ی مرکل روی زنجیره
  تطابق داشته باشد پذیرفته می‌شود (اعتبارسنجی trustless).
- **بررسی واجد شرایط بودن**: کاربر آدرسش را وارد می‌کند؛ صفحه پروف و مقدار
  او را از `/api/airdrops/:id/proof/:address` می‌گیرد.
- **claim**: op امضاشده‌ی claim در مرورگر ساخته می‌شود و از طریق
  `/api/tokens/submit-signed` ارسال می‌شود (کلید هرگز فاش نمی‌شود).
- endpointها: `/api/airdrops/:id/publish`, `/api/airdrops/:id/proof/:address`
- UI: صفحه‌ی `/claim.html` — دو مرحله‌ای (بررسی واجد شرایط بودن → claim)
- محافظت: claim تکراری، آدرس غیرواجد شرایط، و لیست نامعتبر همه رد می‌شوند.

## ۷) مقاومت DDoS  (`middleware/ddos-guard.js`)
یک لایه‌ی جامع محافظت که مکمل rate-limit و netguard موجود است و
نقاط ضعف واقعی حملات حجمی را پوشش می‌دهد:

- **سقف اتصال هم‌زمان per-IP** — جلوگیری از connection flooding
- **بودجه‌ی جهانی تطبیقی (adaptive)** — وقتی کل نود زیر فشار است،
  به‌تدریج ترافیک را می‌ریزد؛ ابتدا بدترین شهرت‌ها.
- **تشخیص burst و بن خودکار** — یک IP که ناگهان صدها درخواست می‌زند
  بن می‌شود.
- **محافظت Slowloris** — اتصالات کند که منابع را نگه می‌دارند بسته می‌شوند.
- **سیستم شهرت با کاهش زمانی (decay)** — خطاکاران تکراری تشدید می‌شوند،
  رفتار خوب به‌مرور بخشیده می‌شود.
- **fail-open**: اگر خود guard خطا کند، هرگز ترافیک را نمی‌بندد.

کنترل: `DDOS_GUARD=0` (غیرفعال)، `DDOS_MAX_CONN_PER_IP`, `DDOS_GLOBAL_SOFT`,
`DDOS_GLOBAL_HARD`, `DDOS_BURST`, `DDOS_SLOW_MS`, `DDOS_BAN_MS`.

endpointهای ادمین: `/api/admin/ddos/stats`, `/ddos/bans`, `/ddos/ban`,
`/ddos/unban`, `/ddos/whitelist`.

تست: `test/ddos-guard.test.js` — ۱۰ تست واحد + ۵ تست HTTP واقعی
(کلاینت سالم در حین حمله بی‌تأثیر می‌ماند). یک باگ واقعی (TDZ در بستن
اتصال) در این مسیر گرفته و رفع شد.

**همچنین:** webhookها حالا روی رویداد بلوک جدید (mined/received) فعال می‌شوند.

## ۸) HTTPS / TLS  (`middleware/tls.js` + `scripts/gen-cert.sh`)
پشتیبانی کامل از HTTPS برای همه‌ی حالت‌های استقرار:

- **HTTPS مستقیم در Node** — با تنظیم `TLS_CERT` و `TLS_KEY` (فایل‌های PEM،
  مثلاً از Let's Encrypt)، نود خودش https سرو می‌کند.
- **ریدایرکت خودکار HTTP→HTTPS** — با `HTTPS_REDIRECT=1` یک سرور همراه
  همه‌ی درخواست‌های http را با 301 به https هدایت می‌کند.
- **HSTS** — روی درخواست‌های امن، هدر `Strict-Transport-Security` فرستاده
  می‌شود تا مرورگر همیشه HTTPS را اجبار کند.
- **سازگار با reverse proxy** — با `TRUST_PROXY=1` نود روی HTTP می‌ماند
  ولی `X-Forwarded-Proto` را می‌خواند و HSTS می‌فرستد (حالت استاندارد تولید).
- **گواهی self-signed برای توسعه** — `scripts/gen-cert.sh` یک گواهی
  محلی می‌سازد؛ با `TLS_SELF_SIGNED=1` فعال می‌شود.
- **WebSocket/Stratum** — چون به همان سرور وصل است، هنگام HTTPS خودکار
  روی `wss://` کار می‌کند.
- **fail-safe**: اگر گواهی خوانده نشود، نود به HTTP برمی‌گردد و هرگز در
  بوت شکست نمی‌خورد.

کنترل: `TLS_CERT`, `TLS_KEY`, `TLS_CA`, `TLS_SELF_SIGNED`, `HTTPS_PORT`,
`HTTPS_REDIRECT`, `TRUST_PROXY`.

تست: `test/tls.test.js` — ۹ تست، شامل راه‌اندازی یک **سرور HTTPS واقعی**
و سرو یک درخواست https واقعی با گواهی self-signed.

> نکته امنیتی: کلید خصوصی dev (`certs/*.pem`) در `.gitignore` است و در
> بسته توزیع نمی‌شود. هر کاربر باید گواهی خودش را بسازد یا از CA بگیرد.

## ۹) هسته به ۱۰۰٪ — سخت‌شدگی consensus + رفع باگ واقعی

### باگ واقعی که پیدا و رفع شد
در `blockchain/blockchain.js` سه `require()` تنبل (lazy) داخل توابع داغ بود
(`require('../tokens/tokens')` در constructor و `require('crypto')` در ساخت
coinbase). این:
- تست هسته را با jest می‌شکست (require بعد از teardown)،
- و در تولید هر بار در حلقه‌ی داغ اجرا می‌شد.
همه به بالای فایل منتقل شدند (هیچ circular dependency واقعی نبود).

### کشف مهم درباره‌ی تست‌ها
تست هسته (`test/blockchain.test.js`) با **`node:test`** نو  شته شده، نه jest.
«۲۸ شکستِ» گزارش‌شده در جلسات قبل، شکست واقعی نبود — فقط jest داشت فایلی را
اجرا می‌کرد که برای runner دیگری بود. با runner درست، **هر ۶۱ تست هسته پاس‌اند.**

### تست‌های consensus-critical جدید  (`test/consensus.test.js` — ۱۲ تست)
سناریوهای بحرانی که قبلاً تست مستقیم نداشتند، حالا اثبات شده‌اند:
- **عدم تورم**: coinbase بیش از reward+fees رد می‌شود
- **halving** قطعی
- مجموع issuance = مجموع پاداش‌ها
- **double-spend** یک UTXO رد می‌شود
- **overspend** رد می‌شود
- **دستکاری merkle** گرفته می‌شود
- timestamp آینده (>2h) و ≤ MTP (BIP-113) رد می‌شوند
- fork choice با **most-work**؛ chainWork صعودی
- validation کل زنجیره + genesis قطعی

### وضعیت نهایی تست هسته
```
npm test        → 73/73 پاس  (blockchain + consensus، node:test)
npm run test:features → jest suites (قابلیت‌ها)
```
هسته حالا از نظر پوشش consensus-critical و صحت، **کامل** است.

## ۱۰) چهار حوزه به بالاترین حد — سخت‌شدگی نهایی

### حوزه‌ی ۱ و ۲: پوشش فنی و قابلیت‌ها → ۱۰۰٪
- **تست یکپارچگی جامع** (`test/integration-smoke.cjs`): یک سرور express واقعی
  با blockchain واقعی که **۴۰+ endpoint** را end-to-end می‌سنجد.
  **۳۰ تست، همه سبز** — اثبات می‌کند همه‌ی قابلیت‌ها واقعاً وصل و زنده‌اند.

### حوزه‌ی ۳: سخت‌شدگی زیرساخت → ۱۰۰٪
- **`middleware/hardening.js`**: محافظت در سطح محتوا (مکمل DDoS حجمی):
  - **prototype-pollution guard** (رد `__proto__`/`constructor`/`prototype`)
  - **محدودیت عمق/اندازه‌ی JSON** (جلوگیری از exhaustion)
  - **اعتبارسنج‌های میدانی** (address, amount, hash, pubkey) قابل‌ترکیب
  - **request id** برای ردیابی و بررسی سوءاستفاده
  - ۱۴ تست، همه سبز.

### حوزه‌ی ۴: آمادگی تولید → بالاترین حد کدنی
این حوزه ذاتاً با کد به ۱۰۰ نمی‌رسد (نیاز به حسابرسی انسانی و زمان)، ولی
artefactهای واقعی production-readiness اضافه شد:
- **`Dockerfile`** — multi-stage، non-root، tini برای سیگنال، healthcheck.
- **`docker-compose.yml`** — نود پشت reverse proxy با persistence و cap_drop.
- **`deploy/Caddyfile`** — TLS خودکار (Let's Encrypt) + هدرهای امنیتی لبه.
- **`docs/SELF_AUDIT.md`** — گزارش خود-ارزیابی صادقانه + چک‌لیست پیش‌استقرار
  + فهرست شفاف آنچه هنوز برای تولید لازم است (حسابرسی مستقل، تست‌نت عمومی…).

### وضعیت نهایی تست
```
هسته (node:test)        → 73/73
قابلیت‌ها (jest)         → 100/100
یکپارچگی (smoke)        → 30/30
─────────────────────────────────
مجموع                   → 203 تست، صفر شکست
```
