# احراز هویت دومرحله‌ای (2FA) — Google Authenticator

برای افزایش امنیت ورود، 2FA مبتنی بر TOTP (سازگار با Google Authenticator،
Authy، و هر اپ TOTP) به پروژه اضافه شد.

## اجزا
- `app/totp.js` — پیاده‌سازی استاندارد **RFC 6238/4226** (SHA-1، ۶ رقم، ۳۰ ثانیه،
  secret به‌صورت base32، و URI با فرمت `otpauth://` برای QR). بدون وابستگی خارجی.
- متدهای `AccessControl`: `setupTotp`, `confirmTotp`, `disableTotp`, `getTotpStatus`.
- گیت 2FA در `login`: اگر فعال باشد، ورود بدون کد معتبر ممکن نیست (`require2fa`)،
  با شمارش تلاش ناموفق و قفل حساب، و مقایسهٔ timing-safe.

## جریان کاربر (endpointها از قبل در سرور بودند)
1. `POST /api/auth/2fa/setup`  → برمی‌گرداند `{ secret, otpauthUrl, issuer }`.
   کاربر `otpauthUrl` را به‌صورت QR در اپ authenticator اسکن می‌کند.
2. `POST /api/auth/2fa/confirm` با `{ token }` → با کد اول 2FA را **فعال** می‌کند.
3. از این پس `POST /api/auth/login` باید `totp` را هم بگیرد؛ بدون کد → `require2fa:true`.
4. `POST /api/auth/2fa/disable` با `{ token }` → غیرفعال‌سازی (نیازمند کد معتبر).
5. `GET  /api/auth/2fa/status` → `{ enabled }`.

صفحه‌های `admin.html` و `dashboard.html` از قبل UI این‌ها را داشتند و اکنون کار می‌کنند.

## راستی‌آزمایی
- ✅ مطابق بردارهای رسمی RFC 4226 (HOTP c=0..4) و RFC 6238 (TOTP@59s=287082).
- ✅ جریان کامل enable/login/disable و تحمل انحراف ساعت (±۱ گام).
- ✅ در سوییت تست (اکنون ۳۴ تست پاس)، lint بدون خطا، سرور سالم بوت می‌شود.
