# Security Guide: Phishing & Social Engineering

The most dangerous attacks are not the ones that target code — they are the ones that
target the *human*. This guide protects you and your users.

═══════════════════════════════════════════════════════════════════════
  PART 1 — Protecting Yourself (The Project Owner)
═══════════════════════════════════════════════════════════════════════

## Premine Private Key (1 Million SPN) — Your Most Important Asset

⚠️  This key = full access to 1 million SPN.

Golden rules:
  1. Never, under any circumstances, give the private key to anyone — not a "partner",
     not an "exchange", not "support". No legitimate service ever asks for a private key.
  2. Keep the key offline (on paper or a dedicated USB) — not in email, not in a
     message, not in the cloud.
  3. If you must move the key, never send it via message/email.

## Deepfake Attacks — The New AI Threat

AI can fake voices and video. That means:
  - You might receive a video call that "looks like" your Emirati partner, but is fake
  - You might hear a voice message that "sounds like" a familiar voice

Defense:
  - For any sensitive request (transferring money, granting access), get a second
    confirmation through another channel (for example, a passphrase agreed on in advance
    with your partner)
  - Never perform a sensitive action based on a single call or message alone

## Phishing Signs You Must Recognize

🚩 "It's urgent! Give me your key right now or your account will be closed"
   → Time pressure = scam

🚩 A link that "looks like" the official site but has a slightly different address
   (for example, spnchaln.com instead of spnchain.com — watch the letters!)
   → Always check the address carefully

🚩 An email from "support" asking for your password or key
   → Real support never asks for a password


═══════════════════════════════════════════════════════════════════════
  PART 2 — Protecting Your Users
═══════════════════════════════════════════════════════════════════════

Your project already has these protections built in (added):

  ✅ Fake domain warning — if the site opens on an unofficial domain, it shows the user
     a red warning
  ✅ Anti-clickjacking — the page will not open inside another site's iframe
  ✅ Private key warning — when a user clicks the key field, they are reminded not to
     give their key to anyone
  ✅ Key stays in the browser — it is never sent to the server

## What You Need to Do:

1. Announce the official address everywhere
   Once you have obtained your final domain (for example, spnchain.com), add it to the
   OFFICIAL_HOSTS list in public/anti-phishing.js:

       var OFFICIAL_HOSTS = [
         'localhost', '127.0.0.1',
         'spnchain.com', 'www.spnchain.com'   // ← your real domain
       ];

   This ensures that if someone builds a fake clone, users will see a warning.

2. Educate your users
   On your official channel (Telegram/website), write:
   "Our only official address is spnchain.com. We will never ask for your private key
    or password. Do not trust any other link."

3. Clearly announce your official channels
   Users must know which Telegram/Twitter/email is official, so they can identify fakes.


═══════════════════════════════════════════════════════════════════════
  PART 3 — Quick Checklist
═══════════════════════════════════════════════════════════════════════

  □ Premine key is offline and secure
  □ 2FA is enabled on the admin account
  □ Official domain is configured in anti-phishing.js
  □ A confirmation passphrase is agreed with the Emirati partner (anti-deepfake)
  □ Users are aware of the official address and the "never give out your key" rule
  □ ADMIN_ALLOWED_IPS is configured (if you have a static IP)


Remember: the strongest security wall is your own awareness. No code can replace
human vigilance.
