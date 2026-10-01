# موتور Script بومی — ارتقا

راهِ اصولیِ «قرارداد هوشمند» در مدل UTXO، غنی‌سازی زبان Script است (نه EVM).
موتور از یک ماشین پشته‌ایِ سادهٔ P2PKH/multisig/timelock به یک زبان شرطیِ
واقعی ارتقا یافت.

## چه اضافه شد
- **شاخه‌بندی شرطی:** `OP_IF` / `OP_NOTIF` / `OP_ELSE` / `OP_ENDIF` (با پشتهٔ
  اجرا و بررسی توازن). این پایهٔ هر قرارداد چندمسیره است.
- **توابع هش:** `OP_SHA256`, `OP_HASH256` (علاوه بر `OP_HASH160`).
- **Timelock نسبی (BIP-112):** `OP_CHECKSEQUENCEVERIFY` (CSV) — خرج فقط پس از
  گذشتِ n بلاک/ثانیه از عمرِ خروجی.
- **`OP_SWAP`** و اصلاحات پشته.

## قراردادهای آماده (builders)
- **HTLC (قرارداد قفل‌شده با هش و زمان):** پایهٔ اتمیک‌سواپ و کانال‌های پرداخت.
  ```js
  const lock   = script.build.htlc(sha256(preimage), recipientPub, funderPub, timeout);
  const claim  = script.build.htlcClaim(sig, preimage);  // مسیر برداشت با افشای preimage
  const refund = script.build.htlcRefund(sig);           // مسیر بازگشت پس از timeout
  ```
- **Relative timelock:** `script.build.csv(sequence, innerScript)`
- (موجود از قبل) `p2pkh`, `multisig(m,n)`, `timelock` (CLTV مطلق)

## اتصال به زنجیره
`utxo/utxo.js` هنگام اعتبارسنجی، `sigHash` (با chainId برای ضدِ replay)،
`lockContext` (برای CLTV) و `sequenceContext` (برای CSV) را به موتور پاس می‌دهد،
پس این قراردادها روی تراکنش‌های واقعی هم اجرا می‌شوند.

## راستی‌آزمایی
تست‌شده: claimِ HTLC با preimageِ درست (و ردِ preimage/امضای غلط)، refund قبل/بعد
از timeout، CSV با عمرِ کافی/ناکافی، ردِ `OP_IF` نامتوازن، و سالم‌ماندنِ
multisig/P2PKH. **۵۵ تست پاس، lint بدون خطا.**

> یادآوری: این «قرارداد هوشمند» به سبک UTXO است (شرط‌های خرج)، نه ماشین حالتِ
> عمومی مثل EVM. برای قراردادهای دلخواهِ turing-complete، مسیر درست همان
> استقرار روی زنجیرهٔ EVM است (`contracts/`).
