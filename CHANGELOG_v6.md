# به‌روزرسانی به نسخه ۶.۰.۰

## شماره نسخه
- `package.json`: 4.0.0 → **6.0.0**
- `config.js` (COIN.VERSION): 4.0.0 → **6.0.0**
- `/api/health` و بنر راه‌اندازی و README همگی → **v6.0.0**

## وابستگی‌ها (آخرین نسخه npm)
| پکیج | قبل | بعد |
|---|---|---|
| express | ^4.18.2 | **^5.2.1** (major) |
| elliptic | ^6.5.4 | ^6.6.1 |
| jsonwebtoken | ^9.0.0 | ^9.0.3 |
| pg | ^8.11.0 | ^8.21.0 |
| ws | ^8.14.0 | ^8.21.0 |
| jest (dev) | ^29.0.0 | **^30.4.2** (major) |
| eslint (dev) | ^8.0.0 | **^10.4.1** (major) |

## اصلاحات کد برای سازگاری با نسخه‌های جدید
- **Express 5**: مسیر catch-all از `'/api/*'` به `'/api/*splat'` تغییر کرد
  (در path-to-regexp v8 الگوی wildcard باید نام‌دار باشد، وگرنه سرور هنگام
  راه‌اندازی crash می‌کرد).
- **ESLint 9/10**: افزودن فایل کانفیگ flat جدید `eslint.config.js`
  (نسخه‌های جدید دیگر `.eslintrc` را نمی‌خوانند و بدون آن اجرا نمی‌شدند).
- **engines.node**: حداقل به `>=20.0.0` رسید (نیاز ESLint 10).
- اسکریپت `test` با `--passWithNoTests` اجرا می‌شود تا در نبود تست‌ها خطا ندهد.

## راستی‌آزمایی
- ✅ سرور با Express 5 بدون خطا بالا می‌آید (تست دود انجام شد)
- ✅ `/api/health` → version 6.0.0
- ✅ مسیر 404 ناشناخته‌ی API درست کار می‌کند
- ✅ بررسی نحوی همه‌ی فایل‌های JS موفق
- ✅ `npm run lint` بدون خطا
- ✅ `npm test` سبز

---

## محافظت از کد (Code Obfuscation) — افزوده شد

از آن‌جا که Denuvo مخصوص باینری‌های بازی است و به این پروژهٔ Node.js نمی‌خورد،
یک مرحلهٔ build مبهم‌سازی سمت سرور اضافه شد:

- وابستگی dev: `javascript-obfuscator@^5.4.3`
- اسکریپت جدید: `build/obfuscate.js`
- اسکریپت‌های npm:
  - `npm run build`     → کل سورس را در `./dist` مبهم‌سازی می‌کند (سورس اصلی دست‌نخورده می‌ماند)
  - `npm run start:dist`→ اجرای نسخهٔ محافظت‌شده از `./dist`
- `dist/` به `.gitignore` اضافه شد.

تنظیمات obfuscation به‌صورت «متعادل و امن برای Node» انتخاب شد:
`renameGlobals` و `selfDefending` و `transformObjectKeys` خاموش‌اند تا
`require()`، `module.exports` و ارجاع‌های بین‌فایلی نشکنند؛ ولی stringArray
(با base64)، splitStrings، controlFlowFlattening و numbersToExpressions روشن‌اند.

### راستی‌آزمایی
- ✅ `npm run build` → ۲۰ فایل JS مبهم شد، ۲۱ asset کپی شد
- ✅ `npm run start:dist` بدون خطا بالا آمد
- ✅ `/api/health` و `/api/coin-info` نسخهٔ 6.0.0 برگرداندند
- ✅ مسیر ۴۰۴ درست کار کرد

### استقرار نسخهٔ محافظت‌شده
```bash
npm run build
cd dist
npm install --omit=dev   # نصب وابستگی‌های production
npm start
```

---

## افزوده‌ها: مسیر لانچ (توکن L2 + testnet عمومی + مستندات)

### مسیر الف — قرارداد هوشمند توکن (`contracts/`)
- قرارداد `SpnCoinToken.sol`: ERC-20 عرضهٔ ثابت بر پایهٔ OpenZeppelin v5
  (ERC20 + Burnable + Permit)، **بدون mint/owner/blacklist/tax**.
- ✅ با solc 0.8.24 بدون خطا کامپایل شد؛ تأیید شد `mint()` وجود ندارد.
- پروژهٔ Hardhat کامل: `hardhat.config.js` (Sepolia/Base/Arbitrum testnet)،
  `scripts/deploy.js`، `test/token.test.js` (شامل تست permit و عدم‌وجود mint)،
  `.env.example`، `.gitignore`، `README.md`.

### testnet عمومی (`testnet/`, `docs/`)
- `testnet/faucet.js`: سرویس faucet با محدودیت نرخ (cooldown بر اساس آدرس و IP)
  که از طریق API نود سکهٔ تستی می‌فرستد. اسکریپت `npm run faucet` اضافه شد.
- `testnet/faucet.html`: رابط وب سادهٔ faucet.
- `docs/TESTNET_GUIDE.md`: راه‌اندازی seed nodeها، explorer، faucet، systemd، پایش.

### مستندات لانچ (`docs/`)
- `docs/PATH_A_ROADMAP.md`: نقشهٔ راه گام‌به‌گام توکن روی L2/اتریوم.
- `docs/PRELAUNCH_CHECKLIST.md`: چک‌لیست فنی + امنیتی + حقوقی (با تمرکز بر مقررات بریتانیا).

### پاک‌سازی
- `contracts/**` به ignore لینتر اضافه شد (زیرپروژهٔ Hardhat با ابزار جدا).
- ✅ `npm run lint` روی کل پروژه تمیز.

---

## آدرس اختصاصی قابل‌تنظیم (هر ۴ حالت)

- بلوک جدید `ADDRESS` در `config.js`: کنترل پیشوند برند، بایت نسخه، فرمت، و HRP.
- `crypto.js` بازنویسی شد تا هویت آدرس را از config بخواند (به‌جای ثابت hardcode).
- **سبک bech32** (BIP173) اضافه شد: ماژول جدید `blockchain/bech32.js` و دیسپچ
  فرمت در `publicKeyToAddress`/`validateAddress`/`parseAddress`.
- **ابزار vanity**: `tools/vanity.js` + اسکریپت `npm run vanity` (با سقف تلاش و
  هشدار محدودیت کاراکتر اولِ base58check).
- راهنما: `docs/ADDRESS_GUIDE.md`.

### راستی‌آزمایی
- ✅ base58check بدون تغییر کار می‌کند؛ آدرس‌ها valid و parse درست.
- ✅ bech32 از تست مرجع BIP173 (`A12UEL5L`) عبور کرد؛ آدرس `myc1...`/`tmyc1...`
  ساخته و اعتبارسنجی شد؛ آدرس دستکاری‌شده رد شد.
- ✅ ابزار vanity آدرس دلخواه (`SPN1BA...`) را پیدا کرد.
- ✅ سرور بوت شد، Wallet آدرس valid ساخت، lint کل پروژه تمیز.
- ⚠️ یادآوری: تغییر فرمت آدرس شکنندهٔ اجماع است — `./data` را ریست کن.

---

## ارتقای پروتکل: نزدیک‌تر به بیت‌کوین/لایت‌کوین

- **الگوریتم PoW قابل‌انتخاب** (`config.js` → `BLOCKCHAIN.POW_ALGORITHM`):
  `sha256d` (بیت‌کوین) یا `scrypt` (لایت‌کوین، N=1024 r=1 p=1).
  - `blockchain/crypto.js`: توابع `scryptHash` و `powHash` (دیسپچ بر اساس config).
  - `Block.powHash()` جدا از `Block.computeHash()` (هویت = sha256d، PoW = الگوریتم config).
  - `Block.validate` و `mineBlock` و هر دو فایل Stratum به `powHash` مسیریابی شدند
    (txid/merkle همچنان sha256d می‌ماند).
- **انتخاب زنجیره بر اساس کار انباشته (chainwork)** به‌جای طول زنجیره:
  `Block.work()` و `Blockchain.chainWork()` اضافه شد؛ `replaceChain` بازنویسی شد.
  این قانون درست ناکاموتو است و یک ضعف امنیتی واقعی را رفع می‌کند.
- سند: `docs/BITCOIN_LITECOIN_COMPARISON.md` (مقایسهٔ صادقانه + ساده‌سازی‌های باقی‌مانده).

### راستی‌آزمایی
- ✅ حالت sha256d: استخراج ۳ بلاک واقعی، `validateChain` سبز، chainwork محاسبه شد.
- ✅ حالت scrypt: استخراج ۳ بلاک واقعی (۴۲ms)، `validateChain` سبز.
- ✅ `powHash` در حالت scrypt با sha256d متفاوت و قطعی است.
- ✅ سرور بوت شد، lint کل پروژه بدون خطا.
- ⚠️ تغییر الگوریتم PoW شکنندهٔ اجماع است — `./data` را ریست کن.

---

## ارتقای پروتکل ۲: هدف ۲۵۶ بیتی + زبان Script

### سختی هدف ۲۵۶ بیتی (دانه‌بندی ظریف)
- `blockchain/crypto.js`: ریاضیات هدف کامل — `POW_LIMIT`, `hashMeetsTarget`,
  `difficultyForTarget`, `targetForDifficulty`, `workForTarget`,
  `targetToBits`/`bitsToTarget` (کدگذاری فشردهٔ nBits سبک بیت‌کوین).
- `Block`: `bits` مرجع PoW شد؛ متد `target()`؛ `difficulty` حالا عددِ مشتق (float).
  اعتبارسنجی PoW با `hashMeetsTarget(powHash, target)`.
- `getNextTarget()`: تنظیم سختی بر پایهٔ هدف با clamp 4× (و `getNextDifficulty`
  حالا float مشتق برمی‌گرداند برای سازگاری). `mineBlock` و chainwork هم target-محور شدند.
- Stratum به هدف واقعی شبکه (`blockchain.currentTarget()`) و `tip.bits` وصل شد.

### زبان Script (multisig / timelock)
- ماژول جدید `blockchain/script.js`: ماشین مجازی پشته‌ای + سازنده‌های
  `p2pkh` / `multisig` / `timelock` و opcodeهای CHECKSIG/CHECKMULTISIG/CLTV و …
- یکپارچه‌سازی افزایشی در `utxo/utxo.js`: UTXOهای دارای `script` از موتور عبور
  می‌کنند؛ تراکنش‌های ساده بدون تغییر.
- راهنما: `docs/SCRIPT_GUIDE.md`.

### راستی‌آزمایی
- ✅ استخراج با هدف ۲۵۶ بیتی (sha256d)؛ اعتبارسنجی و chainwork درست.
- ✅ تنظیم سختی واقعی فعال شد (۱.۰→۴.۰، bits `200fffff`→`2003ffff`).
- ✅ Script: P2PKH، multisig ۲از۳، و CLTV — همه با تست واقعی سبز.
- ✅ یکپارچگی: خرج multisig از `Transaction.validate` عبور/رد می‌شود؛ مسیر ساده سالم.
- ✅ سرور بوت شد؛ lint کل پروژه بدون خطا.
- ⚠️ هر دو تغییر شکنندهٔ اجماع‌اند — `./data` را ریست کن.

---

## رفع باگ‌ها (Bug Fixes)

سه باگ واقعی که با تست پیدا و رفع شدند:

1. **استخراج سریع کل زنجیره را می‌شکست (median-time-past).** وقتی چند بلاک در یک
   میلی‌ثانیه ماین می‌شدند، قانون BIP-113 بلاک را رد می‌کرد (`timestamp <= MTP`).
   اصلاح: ماینر حالا زمان بلاک را به `max(now, MTP+1, tip+1)` می‌گذارد
   (در `blockchain/blockchain.js` و مسیر ثبت بلاک `mining-pool/stratum.js`).

2. **کوین‌بیس از طریق mempool هرگز قابل‌خرج نبود.** `mempool.add` بلوغ کوین‌بیس را
   با ارتفاع hardcodeشدهٔ `0` می‌سنجید، پس هر پاداش استخراج «نابالغ» رد می‌شد.
   اصلاح: پارامتر `blockHeight` اضافه شد و همهٔ فراخوان‌ها ارتفاع بلاک بعدی
   (`blockchain.height + 1`) را پاس می‌دهند (`mempool/mempool.js`, `server.js`, `p2p/p2p.js`).

3. **تایمرِ mempool فرایند را زنده نگه می‌داشت.** `setInterval` پاک‌سازی، `unref`
   نشده بود و باعث می‌شد تست‌رانر/CLI خارج نشوند. اصلاح: `.unref()` اضافه شد.

### راستی‌آزمایی
- ✅ تست‌های رگرسیون برای باگ ۱ و ۲ اضافه شد؛ کل مجموعه: **۲۰/۲۰ پاس**.
- ✅ استخراج ۱۰۳ بلاک پشت‌سرهم + خرج کوین‌بیس بالغ کار می‌کند.
- ✅ lint بدون خطا؛ سرور و نسخهٔ obfuscate‌شده سالم بوت می‌شوند.
