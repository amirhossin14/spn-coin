# راهنمای زبان Script (multisig / timelock)

موتور Script در `blockchain/script.js` یک ماشین مجازی پشته‌ای کوچک در سبک Bitcoin
Script است. خروجی‌های تراکنش می‌توانند یک «اسکریپت قفل» (`script`) داشته باشند و
ورودی‌ها یک «اسکریپت بازکننده» (`scriptSig`). اعتبارسنجی به‌صورت **افزایشی** است:
UTXOهای ساده (آدرس + امضا) مثل قبل کار می‌کنند؛ فقط UTXOهای دارای `script` از موتور
عبور می‌کنند.

## Opcodeهای پشتیبانی‌شده
`OP_DUP, OP_DROP, OP_HASH160, OP_EQUAL, OP_EQUALVERIFY, OP_VERIFY,
OP_CHECKSIG(VERIFY), OP_CHECKMULTISIG(VERIFY), OP_CHECKLOCKTIMEVERIFY, OP_0..OP_16`.

## سازنده‌های آماده
```js
const S = require('./blockchain/script');

// P2PKH
const lock   = S.build.p2pkh(S.hash160Hex(pubkeyHex));
const unlock = S.build.p2pkhUnlock(sigHex, pubkeyHex);

// چندامضایی m-of-n (مثلاً ۲ از ۳)
const lock   = S.build.multisig(2, [pub1, pub2, pub3]);
const unlock = S.build.multisigUnlock([sigA, sigB]);   // امضاها به ترتیب کلیدها

// قفل زمانی مطلق (تا رسیدن به ارتفاع/زمان مشخص قابل‌خرج نیست)
const lock = S.build.timelock(1000, S.build.p2pkh(pkh));
```

## استفاده در تراکنش
خروجی قفل‌شده:
```js
outputs: [{ address: 'script:multisig', amount: '900000000', script: lock }]
```
ورودی بازکننده:
```js
inputs: [{ txid, vout, nonce, scriptSig: unlock }]
```
امضاها باید این هش را امضا کنند (همان چیزی که اعتبارسنجی محاسبه می‌کند):
```js
const sigHash = sha256(JSON.stringify({ txid: tx.id, inp: txid, vout, nonce }));
```
برای CLTV، شرط زمانی در برابر `tx.locktime` (یا ارتفاع بلاک) سنجیده می‌شود.

## وضعیت آزمون
- ✅ P2PKH: خرج معتبر؛ کلید اشتباه رد می‌شود.
- ✅ multisig ۲از۳: دو امضای معتبر قبول؛ یک امضا یا امضای غریبه رد.
- ✅ CLTV: قبل از زمان رد؛ بعد از زمان قبول.
- ✅ یکپارچه با `Transaction.validate` (تراکنش‌های ساده بدون تغییر کار می‌کنند).

> توجه: این موتور حداقلی و آموزشی است؛ زبان کامل Bitcoin Script opcodeها و قواعد
> ایمنی بیشتری دارد. قبل از هر استفادهٔ تولیدی، ممیزی لازم است.
