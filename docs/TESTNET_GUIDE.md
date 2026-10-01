# راهنمای راه‌اندازی Testnet عمومی SPN Coin

این سند، نود فعلی (`SPN Coin_v6`) را به یک **شبکهٔ آزمایشی عمومی** تبدیل می‌کند که
دیگران بتوانند به آن وصل شوند، ماین کنند، و تراکنش بفرستند. هدف، ساختن اعتبارنامهٔ
فنی و آزمودن شبکه است — نه نگه‌داشتن ارزش واقعی.

> روی testnet هیچ سکه‌ای ارزش ندارد. این را همه‌جا شفاف اعلام کن.

---

## ۱. تنظیمات شبکهٔ testnet

در `.env` روی هر سروری که نود را اجرا می‌کند:

```bash
NODE_ENV=production
NETWORK=testnet
HTTP_PORT=3000
JWT_SECRET=<یک رشتهٔ تصادفی قوی و یکتا>
ACCESS_KEY=<یک کلید قوی>
# لیست seed nodeها (با کاما جدا شوند)، در گام ۲ پر می‌شود
PEERS=
```

پس از اولین اجرا، فایل `access.lock` ساخته می‌شود و یوزر/پسوردهای تصادفی چاپ
می‌شوند. آن‌ها را امن نگه دار و فوراً عوض کن.

## ۲. Seed nodeها (ستون فقرات شبکه)

یک seed node صرفاً یک نود همیشه‌-روشن با IP/دامنهٔ ثابت است که نودهای جدید برای
پیداکردن بقیه به آن وصل می‌شوند. برای یک testnet سالم حداقل **۲ تا ۳** seed بگذار،
ترجیحاً روی ارائه‌دهنده‌های مختلف.

روی هر seed، نود را اجرا کن و بقیهٔ seedها را در `PEERS` معرفی کن:

```bash
# seed-1
PEERS=http://seed-2.testnet.spncoin.example:3000,http://seed-3.testnet.spncoin.example:3000 npm start
```

نودهای کاربران فقط یک seed را در `PEERS` می‌گذارند و بقیه را خودکار کشف می‌کنند.
توصیه: هر seed را پشت HTTPS (reverse proxy مثل Nginx/Caddy) بگذار.

### اجرای پایدار با systemd (نمونه)

```ini
# /etc/systemd/system/spncoin.service
[Unit]
Description=SPN Coin testnet node
After=network.target
[Service]
WorkingDirectory=/opt/spncoin
EnvironmentFile=/opt/spncoin/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

یا از `docker/docker-compose.testnet.yml` که از قبل در پروژه هست استفاده کن.

## ۳. Block Explorer

پروژه از قبل یک explorer عمومی دارد (`public/tx.html`, `public/dashboard.html`)
که از endpointهای بدون احراز هویت تغذیه می‌شود:
`/api/blocks`, `/api/block/:ref`, `/api/tx/:txid`, `/api/address/:addr`, `/api/stats`.
کافی است یکی از seedها را روی یک دامنهٔ عمومی منتشر کنی، مثلاً
`https://explorer.testnet.spncoin.example`.

## ۴. Faucet (توزیع سکهٔ تستی)

سرویس faucet در `testnet/faucet.js` آماده است. این سرویس با یک حساب نود که مجوز
`transact:send` دارد احراز هویت می‌کند و سکه می‌فرستد، با محدودیت نرخ (cooldown).

```bash
NODE_URL=http://localhost:3000 \
FAUCET_USER=<کاربر نود> \
FAUCET_PASS=<پسورد> \
FAUCET_AMOUNT=10 \
COOLDOWN_MS=86400000 \
npm run faucet
# UI ساده روی http://localhost:3010  (فایل testnet/faucet.html)
```

نکات faucet:
- حساب faucet باید سکهٔ کافی داشته باشد (نودی که ماین می‌کند، coinbase جمع می‌کند).
- cooldown هم بر اساس آدرس و هم IP اعمال می‌شود (در حافظه؛ برای مقیاس بالا از Redis
  استفاده کن و پشت reverse proxy، `trust proxy` را درست تنظیم کن).
- این سرویس را فقط روی testnet اجرا کن.

## ۵. مستندات برای کاربران (حداقل‌ها)

یک README کوتاه عمومی منتشر کن که شامل این‌ها باشد:
- نحوهٔ اجرای نود و وصل‌شدن (`PEERS=<seed>`)
- آدرس(های) seed و explorer و faucet
- پارامترهای شبکه: `NETWORK=testnet`, chainId, الگوریتم PoW, پاداش بلاک، نیم‌شدن
- نحوهٔ ساخت کیف‌پول و ماین‌کردن (`npm run cli`, miner، stratum)
- اعلام صریح: «سکهٔ testnet ارزش ندارد و شبکه ممکن است ریست شود.»

## ۶. سلامت و پایش

- متریک‌های Prometheus روی `/metrics` فعال است؛ یک Grafana ساده بالا بیاور.
- ارتفاع زنجیره، تعداد peerها و mempool را روی dashboard ببین.
- یک سیاست **reset** برای testnet داشته باش (testnetها معمولاً دوره‌ای ریست می‌شوند).

---

پروندهٔ مرتبط: `docs/PRELAUNCH_CHECKLIST.md`.
