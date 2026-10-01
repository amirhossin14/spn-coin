# IDS / IPS — سیستم تشخیص و پیشگیری از نفوذ

یک لایهٔ امنیتی یکپارچه که روی زیرساخت موجود (ThreatScorer، AnomalyDetector،
honeypot، DDoS blocklist) اضافه شد تا پروژه از نظر امنیتی کامل‌تر شود.

## چه می‌کند
- **موتور امضا (signature engine):** هر درخواست را در برابر الگوهای حمله بررسی می‌کند:
  SQL Injection، XSS، Path Traversal، Command Injection، File Inclusion (LFI/RFI)،
  SSRF، NoSQL Injection، ابزارهای اسکن (sqlmap/nikto/nmap/…) و probeهای شناساییِ
  مسیرهای حساس (`.env`, `.git`, `wp-admin`, …). بازرسی روی **مسیر، کوئری، بادیِ
  JSON، و هدرها/UA** انجام می‌شود.
- **IDS (تشخیص):** هر تطبیق به‌عنوان یک رویدادِ دارای شدت (low→critical) ثبت و در
  کنسول لاگ می‌شود؛ آخرین ۵۰۰ رویداد در حافظه نگه داشته می‌شود.
- **IPS (پیشگیری):** امتیازِ تهدید per-IP با کاهش زمانی (decay). حملهٔ **critical**
  (مثل command injection) بلافاصله بلاک می‌شود؛ در غیر این صورت با عبور از آستانه،
  IP با **بنِ پلکانی** (۱۵ دقیقه → ۱ ساعت → … تا ۲۴ ساعت برای مهاجم مکرر) مسدود
  می‌شود. یک block-gate زودهنگام، IPهای بن‌شده را قبل از هر پردازشی رد می‌کند.
- **Whitelist:** `127.0.0.1`, `::1` و IPهای مورد اعتماد هرگز بلاک نمی‌شوند
  (جلوگیری از قفل‌شدنِ خودی).

## پیکربندی (متغیرهای محیطی)
```bash
IDS_IPS_MODE=ips        # ips (تشخیص+بلاک، پیش‌فرض) | ids (فقط تشخیص) | off
SECURITY_WHITELIST=1.2.3.4,5.6.7.8   # IPهای مورد اعتماد (با کاما)
```

## API مدیریتی (نیازمند احراز هویت)
- `GET  /api/security/stats`        — آمار موتور (حالت، تعداد تشخیص/بلاک، بن‌های فعال)
- `GET  /api/security/events?limit=100` — آخرین رویدادهای تشخیص
- `GET  /api/security/blocklist`    — IPهای بن‌شدهٔ فعلی
- `POST /api/security/block`        — بن دستی `{ ip, minutes?, reason? }`
- `DELETE /api/security/block/:ip`  — رفع بن

## راستی‌آزمایی
- ✅ تشخیص SQLi/XSS/traversal/command-injection/scanner تست شد.
- ✅ درخواست‌های سالم بدون تطبیق عبور می‌کنند (بدون false-positive روی APIهای عادی).
- ✅ حملهٔ critical فوراً ۴۰۳ می‌گیرد و IP بن می‌شود؛ درخواست بعدیِ همان IP هم ۴۰۳.
- ✅ localhost در whitelist هرگز بلاک نمی‌شود.
- ✅ حالت `ids` فقط لاگ می‌کند و بلاک نمی‌کند.
- ✅ ۴۰ تست پاس، lint بدون خطا، سرور سالم بوت می‌شود.
