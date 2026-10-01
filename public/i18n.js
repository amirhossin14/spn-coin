/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * i18n.js — lightweight, automatic page translator (EN ⇄ FA).
 *
 * How it works:
 *  • A shared dictionary maps common English UI strings → Persian.
 *  • On load (and on language change) it walks visible text nodes and
 *    swaps any exact-match string, and applies RTL direction for Persian.
 *  • Original English is remembered so switching back is lossless.
 *
 * This is a pragmatic translator: it covers the shared vocabulary (labels,
 * buttons, headings) across all pages without needing每 page to be rewritten.
 */
(function () {
  var LANG_KEY = 'spn_lang';
  var lang = 'en';
  try { lang = localStorage.getItem(LANG_KEY) || 'en'; } catch (e) {}

  // Shared EN → FA dictionary (exact, case-sensitive trimmed matches).
  var DICT = {
    // nav / common
    'Dashboard': 'داشبورد', 'Explorer': 'کاوشگر', 'Blocks': 'بلوک‌ها', 'TX': 'تراکنش',
    'Analytics': 'تحلیل‌ها', 'Wallet': 'کیف پول', 'Send': 'ارسال', 'Mining': 'استخراج',
    'Network fee': 'کارمزد شبکه', 'Contract address': 'آدرس قرارداد', 'Contract ID': 'شناسه قرارداد', 'Checksum': 'کد بررسی', 'Total': 'جمع کل', 'Balance after': 'موجودی پس از ارسال',
    'Branding & Socials': 'برندینگ و شبکه‌های اجتماعی', '(optional)': '(اختیاری)',
    'Logo image URL': 'آدرس تصویر لوگو', 'Logo preview': 'پیش‌نمایش لوگو',
    'Logo image (PNG/JPG, ≤200KB, 100×100)': 'تصویر لوگو (PNG/JPG، حداکثر ۲۰۰ کیلوبایت، ۱۰۰×۱۰۰)', 'Only PNG or JPG images are allowed.': 'فقط تصاویر PNG یا JPG مجاز هستند.', 'Image is too large. Maximum size is 200KB.': 'تصویر خیلی بزرگ است. حداکثر حجم ۲۰۰ کیلوبایت است.', 'Image must be exactly 100×100 pixels.': 'تصویر باید دقیقاً ۱۰۰×۱۰۰ پیکسل باشد.', 'Could not read the image file.': 'خواندن فایل تصویر ممکن نشد.', 'Could not read the file.': 'خواندن فایل ممکن نشد.',
    'Description': 'توضیحات', 'Website': 'وبسایت', 'Twitter / X': 'توییتر / X',
    '🌐 Website': '🌐 وبسایت', '𝕏 Twitter / X': '𝕏 توییتر / X', '✈️ Telegram': '✈️ تلگرام', '🐙 GitHub': '🐙 گیت‌هاب',
    '📄 White Paper': '📄 وایت‌پیپر', '💬 Discord': '💬 دیسکورد', '📘 Facebook': '📘 فیسبوک', '🤖 Reddit': '🤖 ردیت', '✍️ Medium': '✍️ مدیوم', '✉️ Official Email': '✉️ ایمیل رسمی', 'Telegram': 'تلگرام',
    'Confirmed': 'تأیید شده', 'Pending': 'در انتظار', 'Confirmations': 'تأییدها',
    'Details': 'جزئیات', 'Timestamp': 'زمان', 'Size': 'اندازه', 'Inputs': 'ورودی‌ها', 'Outputs': 'خروجی‌ها',
    'Inputs & Outputs': 'ورودی‌ها و خروجی‌ها', 'Unknown': 'نامشخص', 'No inputs': 'بدون ورودی', 'No outputs': 'بدون خروجی',
    'Newly minted coins (block reward)': 'سکه‌های تازه ضرب‌شده (پاداش بلوک)',
    'The network fee goes to the miner who included this transaction in a block — it is not returned to the sender.': 'کارمزد شبکه به ماینری می‌رود که این تراکنش را در یک بلوک قرار داده — به فرستنده بازگردانده نمی‌شود.',
    'Transaction not found.': 'تراکنش یافت نشد.', 'Loading transaction…': 'در حال بارگذاری تراکنش…',
    'Transaction Details': 'جزئیات تراکنش', 'Transaction Hash': 'هش تراکنش',
    'The network fee is based on transaction size (~10 sat/byte) and goes to the miner who includes your transaction in a block — it is not returned to your wallet.': 'کارمزد شبکه بر اساس اندازه‌ی تراکنش (حدود ۱۰ ساتوشی بر بایت) محاسبه می‌شود و به ماینری می‌رود که تراکنش شما را در یک بلوک قرار می‌دهد — به کیف پول شما بازگردانده نمی‌شود.',
    'Create Coin': 'ساخت کوین', 'Assets': 'دارایی‌ها', 'Airdrop': 'ایردراپ', 'Claim': 'دریافت',
    'Radar': 'رادار', 'Monitor': 'پایش', 'Admin': 'مدیریت', 'Server': 'سرور', 'AI': 'هوش',
    'Network': 'شبکه', 'Network Status': 'وضعیت شبکه', 'Block Height': 'ارتفاع بلوک',
    'Connected Peers': 'همتاهای متصل', 'Uptime': 'زمان فعالیت', 'Chain Details': 'جزئیات زنجیره',
    'Total Blocks': 'کل بلوک‌ها', 'Hashrate': 'نرخ هش', 'Mempool Size': 'اندازه mempool',
    'Block Reward': 'پاداش بلوک', 'PoW Algorithm': 'الگوریتم PoW', 'Node Version': 'نسخه نود',
    'Network': 'شبکه', 'Chain ID': 'شناسه زنجیره', 'Difficulty': 'سختی',
    'Threat Radar': 'رادار تهدید', 'Monitoring': 'پایش',
    // headings & labels
    'Overview': 'نمای کلی', 'Balance': 'موجودی', 'Address': 'آدرس', 'Amount': 'مقدار',
    'Transactions': 'تراکنش‌ها', 'Transaction': 'تراکنش', 'Block': 'بلوک', 'Height': 'ارتفاع',
    'Hash': 'هش', 'Time': 'زمان', 'Status': 'وضعیت', 'Difficulty': 'سختی', 'Miner': 'ماینر',
    'Supply': 'عرضه', 'Total Supply': 'عرضه کل', 'Holders': 'دارندگان', 'Decimals': 'اعشار',
    'Symbol': 'نماد', 'Name': 'نام', 'Type': 'نوع', 'Issuer': 'سازنده', 'Token': 'توکن',
    'Search': 'جستجو', 'Loading…': 'در حال بارگذاری…', 'Loading...': 'در حال بارگذاری...',
    // buttons / actions
    'Send SPN': 'ارسال SPN', 'Transfer': 'انتقال', 'Mint': 'ضرب', 'Mint more': 'ضرب بیشتر',
    'Burn': 'سوزاندن', 'Freeze': 'انجماد', 'Unfreeze': 'رفع انجماد', 'Metadata': 'متادیتا',
    'Owner': 'مالک', 'Copy': 'کپی', 'Close': 'بستن', 'Confirm': 'تأیید', 'Cancel': 'لغو',
    'Unlock': 'باز کردن', 'Lock': 'قفل', 'Generate': 'تولید', 'Create': 'ساخت', 'View': 'نمایش',
    'Refresh': 'تازه‌سازی', 'Submit': 'ارسال', 'Sign & send': 'امضا و ارسال',
    // wallet / send
    'Your Balance': 'موجودی شما', 'Recipient': 'گیرنده', 'Recipient address': 'آدرس گیرنده',
    'Available': 'موجود', 'Fee': 'کارمزد', 'Private key': 'کلید خصوصی',
    'Your private key': 'کلید خصوصی شما', 'Send transaction': 'ارسال تراکنش',
    // mining
    'Mining Pool': 'استخر استخراج', 'Hashrate': 'نرخ هش', 'Start mining': 'شروع استخراج',
    'Stop mining': 'توقف استخراج', 'Blocks mined': 'بلوک‌های استخراج‌شده',
    // token
    'Token Details': 'جزئیات توکن', 'Distribution': 'توزیع', 'Top Holders': 'دارندگان برتر',
    'Token Info': 'اطلاعات توکن', 'Token ID': 'شناسه توکن', 'Website': 'وبسایت',
    'Description': 'توضیحات', 'Manage this token': 'مدیریت این توکن', 'mintable': 'قابل ضرب',
    'All tokens': 'همه توکن‌ها', 'Create a new coin or token': 'ساخت کوین یا توکن جدید',
    // radar
    'Detection feed': 'خوراک تشخیص', 'Perimeter sweep': 'روبش محیط',
    'Detections': 'تشخیص‌ها', 'Active bans': 'مسدودی‌های فعال', 'Tracked IPs': 'IPهای ردیابی‌شده',
    'Signatures': 'امضاها', 'Transaction Anomaly Detection': 'تشخیص ناهنجاری تراکنش',
    'critical': 'بحرانی', 'high': 'بالا', 'medium': 'متوسط', 'low': 'پایین',
    // states
    'Not found': 'یافت نشد', 'No transactions yet': 'هنوز تراکنشی نیست',
    'Connected': 'متصل', 'Disconnected': 'قطع', 'live': 'زنده', 'offline': 'آفلاین',
  };

  var applied = []; // {node, en} for reverting

  function isSkippable(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      var tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return true;
      if (p.id === 'spn-topbar' || p.id === 'spn-footer') return true; // handled by their own modules
      p = p.parentNode;
    }
    return false;
  }

  function walk(root, apply) {
    var wlk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var n;
    while ((n = wlk.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      if (isSkippable(node)) return;
      var raw = node.nodeValue;
      var key = raw.trim();
      if (!key) return;
      if (apply) {
        if (DICT[key]) {
          if (!node._i18nEn) node._i18nEn = raw;
          node.nodeValue = raw.replace(key, DICT[key]);
          applied.push(node);
        }
      } else {
        if (node._i18nEn != null) { node.nodeValue = node._i18nEn; }
      }
    });
  }

  function applyLang(l) {
    lang = l;
    var html = document.documentElement;
    if (l === 'fa') {
      html.setAttribute('dir', 'rtl');
      html.setAttribute('lang', 'fa');
      walk(document.body, true);
    } else {
      html.setAttribute('dir', 'ltr');
      html.setAttribute('lang', 'en');
      walk(document.body, false);
      applied = [];
    }
  }

  // Public API
  window.SPNi18n = {
    get: function () { return lang; },
    set: function (l) {
      try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
      applyLang(l);
      document.dispatchEvent(new CustomEvent('spn-lang-change', { detail: { lang: l } }));
    },
    t: function (k) { return lang === 'fa' && DICT[k] ? DICT[k] : k; },
    dict: DICT,
    // Re-run translation (e.g. after a page renders dynamic content)
    refresh: function () { if (lang === 'fa') walk(document.body, true); },
  };

  function init() { if (lang === 'fa') applyLang('fa'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
