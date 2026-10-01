/*
 * connect-wallet.js — TronLink-style "Connect Wallet" widget for SPN,
 * backed by an encrypted browser keystore (keystore-browser.js).
 *
 * Two flows:
 *   • First time (no saved wallet): user pastes their private key + sets a
 *     password. The key is encrypted (AES-GCM) and saved; raw key stays in
 *     memory only via WalletSession.
 *   • Returning (saved wallet): user enters just the password to unlock.
 *
 * The raw private key is NEVER stored in plaintext and NEVER sent to the
 * server. Only the encrypted keystore lives in localStorage.
 */
(function () {
  'use strict';
  var WS = window.WalletSession;
  var KS = window.SPNKeystore;

  function shorten(a) { return a && a.length > 16 ? a.slice(0, 8) + '\u2026' + a.slice(-6) : (a || ''); }
  function fa() { return (window.SPNi18n && SPNi18n.get && SPNi18n.get() === 'fa'); }
  function t(en, faStr) { return fa() ? faStr : en; }

  var IN = 'width:100%;padding:11px;border:1px solid rgba(122,153,184,.3);border-radius:9px;background:#0d141b;color:#e8f0f8;font-size:13px;box-sizing:border-box';
  var MONO = "font-family:'JetBrains Mono',monospace;font-size:12px";

  var SPNConnect = {
    mount: function (sel, opts) {
      opts = opts || {};
      var host = document.querySelector(sel);
      if (!host || !WS || !KS) return;
      host.innerHTML = '';
      host.style.cssText = 'margin:0 0 14px';

      var pill = document.createElement('div');
      pill.style.cssText = 'display:none;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid rgba(0,230,118,.35);border-radius:12px;background:rgba(0,230,118,.06)';
      pill.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:#00e676;box-shadow:0 0 8px rgba(0,230,118,.7);flex:none"></span>' +
          '<div style="min-width:0">' +
            '<div style="font-size:11px;color:#7a99b8;text-transform:uppercase;letter-spacing:.5px">' + t('Wallet connected', '\u06a9\u06cc\u0641 \u067e\u0648\u0644 \u0645\u062a\u0635\u0644') + '</div>' +
            '<div id="spnc-addr" style="' + MONO + ';color:#e8f0f8;word-break:break-all"></div>' +
          '</div>' +
        '</div>' +
        '<button type="button" id="spnc-disc" style="flex:none;background:rgba(255,68,102,.12);border:1px solid rgba(255,68,102,.3);color:#ff6a85;border-radius:9px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">' + t('Lock', '\u0642\u0641\u0644') + '</button>';

      var connectBtn = document.createElement('button');
      connectBtn.type = 'button';
      connectBtn.style.cssText = 'width:100%;padding:13px;border:1px solid rgba(0,230,118,.4);border-radius:12px;background:linear-gradient(135deg,rgba(0,230,118,.15),rgba(0,230,118,.05));color:#00e676;font-size:14px;font-weight:700;cursor:pointer';

      var panel = document.createElement('div');
      panel.style.cssText = 'display:none;margin-top:10px;padding:14px;border:1px solid rgba(122,153,184,.25);border-radius:12px;background:rgba(122,153,184,.04)';

      host.appendChild(pill);
      host.appendChild(connectBtn);
      host.appendChild(panel);

      function refreshButton() {
        connectBtn.innerHTML = KS.has()
          ? '\ud83d\udd13 ' + t('Unlock Wallet', '\u0628\u0627\u0632 \u06a9\u0631\u062f\u0646 \u06a9\u06cc\u0641 \u067e\u0648\u0644')
          : '\ud83d\udd17 ' + t('Connect Wallet', '\u0627\u062a\u0635\u0627\u0644 \u06a9\u06cc\u0641 \u067e\u0648\u0644');
      }

      function render(connected, addr) {
        pill.style.display = connected ? 'flex' : 'none';
        connectBtn.style.display = connected ? 'none' : 'block';
        if (!connected) panel.style.display = 'none';
        if (connected) pill.querySelector('#spnc-addr').textContent = shorten(addr);
        refreshButton();
        if (typeof opts.onChange === 'function') opts.onChange(connected, addr);
      }

      function showUnlockPanel() {
        var m = KS.meta() || {};
        panel.innerHTML =
          '<div style="font-size:12px;color:#7a99b8;margin-bottom:4px">' + t('Enter your password to unlock', '\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0631\u0627 \u0628\u0631\u0627\u06cc \u0628\u0627\u0632 \u06a9\u0631\u062f\u0646 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f') + '</div>' +
          (m.address ? '<div style="' + MONO + ';color:#8fa9c4;margin-bottom:8px">' + shorten(m.address) + '</div>' : '') +
          '<input id="spnc-pw" type="password" placeholder="' + t('password', '\u0631\u0645\u0632 \u0639\u0628\u0648\u0631') + '" autocomplete="off" style="' + IN + '" />' +
          '<div id="spnc-err" style="display:none;color:#ff6a85;font-size:12px;margin-top:8px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button type="button" id="spnc-ok" style="flex:1;background:#00e676;border:none;color:#04140c;border-radius:9px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">' + t('Unlock', '\u0628\u0627\u0632 \u06a9\u0631\u062f\u0646') + '</button>' +
            '<button type="button" id="spnc-cancel" style="flex:none;background:transparent;border:1px solid rgba(122,153,184,.3);color:#7a99b8;border-radius:9px;padding:11px 14px;font-size:13px;cursor:pointer">' + t('Cancel', '\u0627\u0646\u0635\u0631\u0627\u0641') + '</button>' +
          '</div>' +
          '<button type="button" id="spnc-forget" style="margin-top:10px;background:none;border:none;color:#ff6a85;font-size:11px;cursor:pointer;text-decoration:underline">' + t('Forget this wallet', '\u0641\u0631\u0627\u0645\u0648\u0634 \u06a9\u0631\u062f\u0646 \u0627\u06cc\u0646 \u06a9\u06cc\u0641 \u067e\u0648\u0644') + '</button>';
        panel.style.display = 'block';
        var pw = panel.querySelector('#spnc-pw'), err = panel.querySelector('#spnc-err');
        pw.focus();
        async function doUnlock() {
          err.style.display = 'none';
          try {
            var priv = await KS.unlock(pw.value);
            var addr = (KS.meta() || {}).address || '';
            await WS.unlock(priv, addr);
            pw.value = ''; panel.style.display = 'none';
          } catch (e) {
            err.textContent = t('Wrong password. Try again.', '\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0634\u062a\u0628\u0627\u0647 \u0627\u0633\u062a.');
            err.style.display = 'block';
          }
        }
        panel.querySelector('#spnc-ok').onclick = doUnlock;
        pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doUnlock(); });
        panel.querySelector('#spnc-cancel').onclick = function () { panel.style.display = 'none'; pw.value = ''; err.style.display = 'none'; };
        panel.querySelector('#spnc-forget').onclick = function () {
          if (confirm(t('Remove the saved encrypted wallet from this browser?', '\u06a9\u06cc\u0641 \u067e\u0648\u0644 \u0631\u0645\u0632\u0646\u06af\u0627\u0631\u06cc\u200c\u0634\u062f\u0647 \u0627\u0632 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u062d\u0630\u0641 \u0634\u0648\u062f\u061f'))) {
            KS.remove(); panel.style.display = 'none'; refreshButton();
          }
        };
      }

      function showImportPanel() {
        panel.innerHTML =
          '<div style="font-size:12px;color:#7a99b8;margin-bottom:8px">' +
            t('Add your wallet once. Your key is encrypted with a password and saved only in this browser \u2014 never sent to the server.',
              '\u06a9\u06cc\u0641 \u067e\u0648\u0644 \u0631\u0627 \u06cc\u06a9\u200c\u0628\u0627\u0631 \u0627\u0636\u0627\u0641\u0647 \u06a9\u0646\u06cc\u062f. \u06a9\u0644\u06cc\u062f \u0628\u0627 \u06cc\u06a9 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0631\u0645\u0632\u0646\u06af\u0627\u0631\u06cc \u0648 \u0641\u0642\u0637 \u062f\u0631 \u0647\u0645\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u0630\u062e\u06cc\u0631\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u2014 \u0647\u0631\u06af\u0632 \u0628\u0647 \u0633\u0631\u0648\u0631 \u0627\u0631\u0633\u0627\u0644 \u0646\u0645\u06cc\u200c\u0634\u0648\u062f.') + '</div>' +
          '<input id="spnc-key" type="password" placeholder="' + t('private key hex', '\u06a9\u0644\u06cc\u062f \u062e\u0635\u0648\u0635\u06cc (hex)') + '" autocomplete="off" style="' + IN + ';' + MONO + '" />' +
          '<input id="spnc-pw" type="password" placeholder="' + t('choose a password (min 8 chars)', '\u06cc\u06a9 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f (\u062d\u062f\u0627\u0642\u0644 \u06f8 \u06a9\u0627\u0631\u0627\u06a9\u062a\u0631)') + '" autocomplete="off" style="' + IN + ';margin-top:8px" />' +
          '<input id="spnc-pw2" type="password" placeholder="' + t('confirm password', '\u062a\u06a9\u0631\u0627\u0631 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631') + '" autocomplete="off" style="' + IN + ';margin-top:8px" />' +
          '<div id="spnc-err" style="display:none;color:#ff6a85;font-size:12px;margin-top:8px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button type="button" id="spnc-ok" style="flex:1;background:#00e676;border:none;color:#04140c;border-radius:9px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">' + t('Encrypt & Connect', '\u0631\u0645\u0632\u0646\u06af\u0627\u0631\u06cc \u0648 \u0627\u062a\u0635\u0627\u0644') + '</button>' +
            '<button type="button" id="spnc-cancel" style="flex:none;background:transparent;border:1px solid rgba(122,153,184,.3);color:#7a99b8;border-radius:9px;padding:11px 14px;font-size:13px;cursor:pointer">' + t('Cancel', '\u0627\u0646\u0635\u0631\u0627\u0641') + '</button>' +
          '</div>';
        panel.style.display = 'block';
        var keyEl = panel.querySelector('#spnc-key'), pwEl = panel.querySelector('#spnc-pw'), pw2El = panel.querySelector('#spnc-pw2'), err = panel.querySelector('#spnc-err');
        keyEl.focus();
        function fail(msg) { err.textContent = msg; err.style.display = 'block'; }
        async function doImport() {
          err.style.display = 'none';
          var key = (keyEl.value || '').trim();
          if (!/^[0-9a-fA-F]{64}$/.test(key)) return fail(t('Enter a valid 64-hex private key.', '\u06a9\u0644\u06cc\u062f \u062e\u0635\u0648\u0635\u06cc \u0645\u0639\u062a\u0628\u0631 \u06f6\u06f4 \u06a9\u0627\u0631\u0627\u06a9\u062a\u0631\u06cc \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f.'));
          if ((pwEl.value || '').length < 8) return fail(t('Password must be at least 8 characters.', '\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0627\u06cc\u062f \u062d\u062f\u0627\u0642\u0644 \u06f8 \u06a9\u0627\u0631\u0627\u06a9\u062a\u0631 \u0628\u0627\u0634\u062f.'));
          if (pwEl.value !== pw2El.value) return fail(t('Passwords do not match.', '\u0631\u0645\u0632\u0647\u0627\u06cc \u0639\u0628\u0648\u0631 \u06cc\u06a9\u0633\u0627\u0646 \u0646\u06cc\u0633\u062a\u0646\u062f.'));
          try {
            var addr = await WS.unlock(key);
            await KS.save(key, pwEl.value, addr);
            keyEl.value = pwEl.value = pw2El.value = '';
            panel.style.display = 'none'; refreshButton();
          } catch (e) {
            fail(t('Could not connect. Check the key and try again.', '\u0627\u062a\u0635\u0627\u0644 \u0645\u0645\u06a9\u0646 \u0646\u0634\u062f. \u06a9\u0644\u06cc\u062f \u0631\u0627 \u0628\u0631\u0631\u0633\u06cc \u06a9\u0646\u06cc\u062f.'));
          }
        }
        panel.querySelector('#spnc-ok').onclick = doImport;
        pw2El.addEventListener('keydown', function (e) { if (e.key === 'Enter') doImport(); });
        panel.querySelector('#spnc-cancel').onclick = function () { panel.style.display = 'none'; err.style.display = 'none'; };
      }

      // No wallet saved on this browser yet → guide the user to create one in
      // the My Wallet page first (they can't mint without a wallet). Advanced
      // users can still import a raw private key from here.
      function showNoWalletPanel() {
        panel.innerHTML =
          '<div style="font-size:13px;color:#e8f0f8;margin-bottom:6px;font-weight:700">' +
            t('You need a wallet first', 'اول باید یک کیف پول داشته باشید') + '</div>' +
          '<div style="font-size:12px;color:#7a99b8;margin-bottom:12px;line-height:1.7">' +
            t('To create a coin or token you must have your own SPN wallet. Create one (with a password) in the My Wallet page, then come back and connect it here.',
              'برای ساخت کوین یا توکن باید کیف پول SPN خودتان را داشته باشید. در صفحه‌ی My Wallet یک کیف پول (با رمز عبور) بسازید، بعد برگردید و اینجا متصلش کنید.') + '</div>' +
          '<a href="/mywallet.html" style="display:block;text-align:center;text-decoration:none;background:#00e676;color:#04140c;border-radius:9px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">' +
            '👛 ' + t('Create / open my wallet', 'ساخت / باز کردن کیف پول') + '</a>' +
          '<button type="button" id="spnc-adv" style="margin-top:12px;background:none;border:none;color:#7a99b8;font-size:11.5px;cursor:pointer;text-decoration:underline;width:100%">' +
            t('Advanced: import a private key instead', 'پیشرفته: وارد کردن کلید خصوصی') + '</button>' +
          '<button type="button" id="spnc-nw-cancel" style="margin-top:8px;background:transparent;border:1px solid rgba(122,153,184,.3);color:#7a99b8;border-radius:9px;padding:9px;font-size:12px;cursor:pointer;width:100%">' +
            t('Cancel', 'انصراف') + '</button>';
        panel.style.display = 'block';
        panel.querySelector('#spnc-adv').onclick = showImportPanel;
        panel.querySelector('#spnc-nw-cancel').onclick = function () { panel.style.display = 'none'; };
      }

      connectBtn.onclick = function () { if (KS.has()) showUnlockPanel(); else showNoWalletPanel(); };
      pill.querySelector('#spnc-disc').onclick = function () { WS.lock(); };

      WS.onChange(render);
      refreshButton();
    },
  };

  window.SPNConnect = SPNConnect;
})();
