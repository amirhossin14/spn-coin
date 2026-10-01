/* assay-header.js — shared "The Assay" ledger sub-header, injected on every page
   so all pages match the Explorer look. Scoped with .ash- classes + hardcoded
   palette so it never clashes with a page's own :root variables. */
(function () {
  if (document.getElementById('ash-bar')) return;

  var CSS = ''
    + '#ash-bar{--ash-ink:rgba(12,26,32,.92);--ash-line:#21454F;--ash-brass:#C9A24B;'
    + '--ash-brass2:#E4C77E;--ash-patina:#6FB2A6;--ash-rust:#C56B4A;--ash-paper:#ECE7D8;'
    + '--ash-muted:#7E969C;--ash-ink2:#102730;position:sticky;top:56px;z-index:40;'
    + 'background:var(--ash-ink);backdrop-filter:blur(8px);border-bottom:1px solid var(--ash-line)}'
    + '#ash-bar *{box-sizing:border-box}'
    + '.ash-in{max-width:1180px;margin:0 auto;padding:0 22px;display:flex;align-items:center;gap:20px;height:64px}'
    + '.ash-brand{display:flex;align-items:baseline;gap:10px;font-family:"Fraunces",Georgia,serif;text-decoration:none;white-space:nowrap}'
    + '.ash-brand b{font-weight:900;font-size:22px;letter-spacing:.5px;color:var(--ash-paper)}'
    + '.ash-brand span{color:var(--ash-brass);font-weight:600;font-size:13px;font-style:italic}'
    + '.ash-net{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.14em;'
    + 'text-transform:uppercase;color:var(--ash-brass2);white-space:nowrap;display:flex;align-items:center}'
    + '.ash-net i{width:6px;height:6px;border-radius:50%;background:var(--ash-patina);display:inline-block;'
    + 'margin-right:7px;box-shadow:0 0 8px var(--ash-patina)}'
    + '.ash-nav{display:flex;gap:16px;font-size:14px;white-space:nowrap;margin-left:auto;font-family:"Inter",system-ui,sans-serif}'
    + '.ash-nav a{color:var(--ash-brass2);text-decoration:none}'
    + '.ash-nav a:hover{color:var(--ash-paper)}'
    + '.ash-search{position:relative;width:340px;max-width:40vw}'
    + '.ash-search input{width:100%;background:var(--ash-ink2);border:1px solid var(--ash-line);color:var(--ash-paper);'
    + 'border-radius:9px;padding:10px 74px 10px 14px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;outline:none}'
    + '.ash-search input::placeholder{color:var(--ash-muted)}'
    + '.ash-search input:focus{border-color:var(--ash-brass);box-shadow:0 0 0 3px rgba(201,162,75,.15)}'
    + '.ash-search button{position:absolute;right:6px;top:6px;bottom:6px;border:0;background:var(--ash-brass);'
    + 'color:#20180a;border-radius:6px;padding:0 14px;font-weight:700;cursor:pointer;font-family:"Inter",system-ui,sans-serif}'
    + '.ash-search button:hover{background:var(--ash-brass2)}'
    + '@media(max-width:900px){.ash-nav{display:none}.ash-search{width:auto;flex:1;max-width:none}'
    + '.ash-in{gap:12px;height:auto;padding:11px 16px;flex-wrap:wrap}.ash-brand b{font-size:19px}'
    + '.ash-net{order:3;width:100%;justify-content:center}}';

  var bar = document.createElement('div');
  bar.id = 'ash-bar';
  bar.innerHTML = ''
    + '<div class="ash-in">'
    + '  <a class="ash-brand" href="explorer.html"><b>The&nbsp;Assay</b><span>SPN Coin ledger</span></a>'
    + '  <div class="ash-net" id="ash-net"><i></i><span id="ash-netName">connecting…</span></div>'
    + '  <nav class="ash-nav">'
    + '    <a href="dashboard.html">Dashboard</a>'
    + '    <a href="token-factory.html">Create</a>'
    + '    <a href="token-manage.html">Manage</a>'
    + '  </nav>'
    + '  <form class="ash-search" id="ash-search" autocomplete="off">'
    + '    <input id="ash-q" placeholder="Search height · block hash · txid · SPN address" aria-label="Search the ledger"/>'
    + '    <button type="submit">Assay</button>'
    + '  </form>'
    + '</div>';

  function mount() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var top = document.getElementById('spn-topbar');
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
    wire();
    poll();
    setInterval(poll, 12000);
  }

  function wire() {
    var form = document.getElementById('ash-search');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = document.getElementById('ash-q').value.trim();
      if (!q) return;
      if (/^\d+$/.test(q) || /^0*[a-f0-9]{64}$/i.test(q)) location.href = '/block.html?h=' + encodeURIComponent(q);
      else if (/^SPN[1t]/.test(q)) location.href = '/explorer.html?q=' + encodeURIComponent(q);
      else location.href = '/tx.html?h=' + encodeURIComponent(q);
    });
  }

  function poll() {
    fetch(location.origin + '/api/health').then(function (r) { return r.json(); }).then(function (h) {
      document.getElementById('ash-netName').textContent = (h.network || 'network') + ' · height ' + (h.height != null ? h.height : '—');
      document.querySelector('#ash-net i').style.background = h.status === 'ok' ? 'var(--ash-patina)' : 'var(--ash-rust)';
    }).catch(function () {
      var el = document.getElementById('ash-netName'); if (el) el.textContent = 'node unreachable';
      var dot = document.querySelector('#ash-net i'); if (dot) dot.style.background = 'var(--ash-rust)';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
