/* otp-box.js — shared 6-digit 2FA code UI (matches the admin panel look).
 * Markup:
 *   <div class="otp-row" id="myRow" data-target="hiddenInputId" data-onfull="submitFnName">
 *     <input class="oi" maxlength="1" data-i="0" inputmode="numeric"
 *            oninput="otpSync(this)" onkeydown="otpKey(event,this)"> ... (x6)
 *   </div>
 *   <input type="hidden" id="hiddenInputId">
 * The combined 6 digits are mirrored into #hiddenInputId (.value), so existing
 * login code that reads that input keeps working. When all 6 are filled, the
 * function named by data-onfull is called automatically.
 * Use otpFocus('myRow') to focus the first box; otpClear('myRow') to reset.
 */
(function () {
  if (!document.getElementById('otp-box-css')) {
    var s = document.createElement('style');
    s.id = 'otp-box-css';
    s.textContent =
      '.otp-row{display:flex;gap:8px;justify-content:center;margin:6px 0 14px;flex-wrap:wrap}' +
      '.otp-row .oi{width:46px;height:54px;text-align:center;background:rgba(255,255,255,.03);' +
      'border:1px solid rgba(255,255,255,.16);border-radius:10px;color:var(--gold,#f0a500);' +
      "font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;outline:none;" +
      'transition:all .18s;direction:ltr;padding:0}' +
      '.otp-row .oi:focus{border-color:rgba(240,165,0,.6);background:rgba(240,165,0,.05);' +
      'box-shadow:0 0 0 3px rgba(240,165,0,.12)}' +
      '.otp-row .oi.f{border-color:rgba(240,165,0,.42)}';
    (document.head || document.documentElement).appendChild(s);
  }

  function boxes(row) { return [].slice.call(row.querySelectorAll('.oi')); }
  function combine(row) {
    var code = boxes(row).map(function (x) { return x.value; }).join('');
    var t = row.dataset.target && document.getElementById(row.dataset.target);
    if (t) t.value = code;
    return code;
  }
  function maybeSubmit(row) {
    var b = boxes(row);
    if (b.length && b.every(function (x) { return x.value.length === 1; })) {
      var fn = row.dataset.onfull;
      if (fn && typeof window[fn] === 'function') setTimeout(function () { window[fn](); }, 80);
    }
  }

  window.otpSync = function (inp) {
    var row = inp.closest('.otp-row'); if (!row) return;
    var v = inp.value.replace(/\D/g, '').slice(-1);
    inp.value = v; inp.classList.toggle('f', !!v);
    if (v) { var ni = +inp.dataset.i + 1, nx = row.querySelector('[data-i="' + ni + '"]'); if (nx) nx.focus(); }
    combine(row); maybeSubmit(row);
  };

  window.otpKey = function (e, inp) {
    if (e.key === 'Backspace' && !inp.value) {
      var row = inp.closest('.otp-row'); if (!row) return;
      var pi = +inp.dataset.i - 1, pv = row.querySelector('[data-i="' + pi + '"]');
      if (pv) { pv.value = ''; pv.classList.remove('f'); pv.focus(); combine(row); }
    }
  };

  window.otpFocus = function (rowId) {
    var r = document.getElementById(rowId); if (!r) return;
    var f = r.querySelector('[data-i="0"]'); if (f) f.focus();
  };
  window.otpClear = function (rowId) {
    var r = document.getElementById(rowId); if (!r) return;
    boxes(r).forEach(function (x) { x.value = ''; x.classList.remove('f'); });
    combine(r);
  };

  // Paste a whole code into any box → distribute across the row.
  document.addEventListener('paste', function (e) {
    var a = document.activeElement;
    if (!a || !a.classList || !a.classList.contains('oi')) return;
    var row = a.closest('.otp-row'); if (!row) return;
    var txt = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
    if (!txt) return;
    e.preventDefault();
    var b = boxes(row);
    for (var i = 0; i < b.length; i++) { b[i].value = txt[i] || ''; b[i].classList.toggle('f', !!txt[i]); }
    combine(row);
    var last = Math.min(txt.length, b.length) - 1;
    if (last >= 0 && b[last]) b[last].focus();
    maybeSubmit(row);
  });
})();
