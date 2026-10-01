/*
 * ai-bubble.js — floating AI assistant bubble, shown on every page.
 *
 * A small round button sits in the corner. Clicking it opens a compact chat
 * panel that talks to the node's /api/ai/chat endpoint (which keeps the API key
 * server-side and rate-limits requests). If the AI service isn't configured,
 * the panel shows a friendly "coming soon" message instead of an error.
 *
 * Loads on every page via a single <script> tag. No dependencies.
 */
(function () {
  'use strict';
  if (window.__spnAiBubble) return;           // guard against double-load
  window.__spnAiBubble = true;

  // ── i18n (mirrors the site's EN/FA switch) ──
  function lang() { try { return localStorage.getItem('spn_lang') || 'en'; } catch (e) { return 'en'; } }
  var T = {
    en: { title: 'Sepanta AI', sub: 'Ask about the blockchain', ph: 'Type your question…',
          hello: 'Hi! I\'m the Sepanta assistant. Ask me anything about SPN, wallets, mining, or tokens.',
          soon: 'The AI assistant is coming soon. Please check back later!',
          err: 'Something went wrong. Please try again in a moment.',
          rate: 'You\'re sending messages too quickly. Please wait a moment.',
          send: 'Send' },
    fa: { title: 'دستیار سِپَنتا', sub: 'درباره‌ی بلاکچین بپرس', ph: 'سوالت را بنویس…',
          hello: 'سلام! من دستیار سِپَنتا هستم. هر سوالی درباره‌ی SPN، کیف پول، استخراج یا توکن‌ها داری بپرس.',
          soon: 'دستیار هوش مصنوعی به‌زودی فعال می‌شود. بعداً دوباره سر بزن!',
          err: 'مشکلی پیش آمد. لطفاً چند لحظه بعد دوباره امتحان کن.',
          rate: 'خیلی سریع پیام می‌فرستی. لطفاً کمی صبر کن.',
          send: 'ارسال' }
  };
  function t(k) { return (T[lang()] || T.en)[k]; }

  // ── styles ──
  var css = document.createElement('style');
  css.textContent = [
    '#spn-ai-bubble{position:fixed;bottom:22px;right:22px;z-index:9998;width:60px;height:60px;min-width:60px;min-height:60px;',
    'box-sizing:border-box;padding:0;border-radius:50%;aspect-ratio:1/1;overflow:visible;',
    'background:radial-gradient(circle at 34% 30%,#5b9bff 0%,#2f6fe6 45%,#1d4ed8 100%);border:none;cursor:pointer;box-shadow:0 8px 28px rgba(59,130,246,.45);',
    'display:flex;align-items:center;justify-content:center;line-height:0;transition:transform .18s,box-shadow .18s}',
    '#spn-ai-bubble:hover{transform:scale(1.08);box-shadow:0 10px 34px rgba(59,130,246,.6)}',
    '#spn-ai-bubble span{color:#fff;font-weight:800;font-size:17px;font-family:Sora,sans-serif;letter-spacing:.5px}',
    '#spn-ai-bubble .ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(59,130,246,.35);animation:spnpulse 2.4s ease-out infinite}',
    '@keyframes spnpulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.35);opacity:0}}',
    '#spn-ai-panel{position:fixed;bottom:94px;right:22px;z-index:9999;width:340px;max-width:calc(100vw - 44px);height:460px;max-height:calc(100vh - 130px);',
    'background:#0e1528;border:1px solid rgba(59,130,246,.3);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);',
    'display:none;flex-direction:column;overflow:hidden;font-family:Sora,sans-serif}',
    '#spn-ai-panel.open{display:flex}',
    '#spn-ai-panel .xhd{background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:14px 16px;display:flex;align-items:center;gap:11px}',
    '#spn-ai-panel .xhd .xav{width:36px;height:36px;flex:none;border-radius:50%;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px}',
    '#spn-ai-panel .xhd .xnm{color:#fff;font-weight:700;font-size:14px;line-height:1.25}',
    '#spn-ai-panel .xhd .xsb{color:rgba(255,255,255,.82);font-size:11px}',
    '#spn-ai-panel .xhd .xcl{margin-left:auto;width:28px;height:28px;flex:none;border-radius:8px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s;padding:0}',
    '#spn-ai-panel .xhd .xcl:hover{background:rgba(255,255,255,.3);transform:rotate(90deg)}',
    '#spn-ai-panel .xbd{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}',
    '#spn-ai-panel .xbd::-webkit-scrollbar{width:6px}',
    '#spn-ai-panel .xbd::-webkit-scrollbar-thumb{background:rgba(59,130,246,.35);border-radius:3px}',
    '#spn-ai-panel .xmsg{max-width:84%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 2px 8px rgba(0,0,0,.25)}',
    '#spn-ai-panel .xmsg.ai{background:#161f38;color:#e6edf7;align-self:flex-start;border:1px solid rgba(255,255,255,.05);border-bottom-left-radius:5px}',
    '#spn-ai-panel .xmsg.me{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;align-self:flex-end;border-bottom-right-radius:5px}',
    '#spn-ai-panel .xft{padding:12px;border-top:1px solid rgba(59,130,246,.15);display:flex;gap:8px;background:#0b1120}',
    '#spn-ai-panel .xft input{flex:1;background:#0a0f1e;border:1px solid rgba(59,130,246,.25);border-radius:11px;padding:11px 13px;color:#e2e8f0;font-size:13px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}',
    '#spn-ai-panel .xft input:focus{border-color:rgba(59,130,246,.65);box-shadow:0 0 0 3px rgba(59,130,246,.12)}',
    '#spn-ai-panel .xft button{background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;border-radius:11px;padding:0 18px;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:filter .15s,transform .1s}',
    '#spn-ai-panel .xft button:hover:not(:disabled){filter:brightness(1.08)}',
    '#spn-ai-panel .xft button:active:not(:disabled){transform:scale(.96)}',
    '#spn-ai-panel .xft button:disabled{opacity:.5;cursor:default}',
    '[dir="rtl"] #spn-ai-bubble{right:auto;left:22px}',
    '[dir="rtl"] #spn-ai-panel{right:auto;left:22px}',
    '[dir="rtl"] #spn-ai-panel .xhd .xcl{margin-left:0;margin-right:auto}',
    '[dir="rtl"] #spn-ai-panel .xmsg.ai{align-self:flex-end;border-bottom-left-radius:12px;border-bottom-right-radius:4px}',
    '[dir="rtl"] #spn-ai-panel .xmsg.me{align-self:flex-start;border-bottom-right-radius:12px;border-bottom-left-radius:4px}'
  ].join('');
  document.head.appendChild(css);

  // ── elements ──
  var bubble = document.createElement('button');
  bubble.id = 'spn-ai-bubble';
  bubble.setAttribute('aria-label', 'AI assistant');
  bubble.innerHTML = '<span class="ring"></span><span>AI</span>';

  var panel = document.createElement('div');
  panel.id = 'spn-ai-panel';
  panel.innerHTML =
    '<div class="xhd"><div class="xav">AI</div>' +
      '<div><div class="xnm" id="spnai-title"></div><div class="xsb" id="spnai-sub"></div></div>' +
      '<button class="xcl" aria-label="Close">&times;</button></div>' +
    '<div class="xbd" id="spnai-body"></div>' +
    '<div class="xft"><input id="spnai-input" type="text" maxlength="2000"><button id="spnai-send"></button></div>';

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var body = panel.querySelector('#spnai-body');
  var input = panel.querySelector('#spnai-input');
  var sendBtn = panel.querySelector('#spnai-send');
  var history = [];
  var greeted = false;

  function applyLang() {
    panel.querySelector('#spnai-title').textContent = t('title');
    panel.querySelector('#spnai-sub').textContent = t('sub');
    input.placeholder = t('ph');
    sendBtn.textContent = t('send');
    if (lang() === 'fa') panel.setAttribute('dir', 'rtl'); else panel.setAttribute('dir', 'ltr');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'xmsg ' + who;
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }

  function openPanel() {
    applyLang();
    panel.classList.add('open');
    if (!greeted) { addMsg(t('hello'), 'ai'); greeted = true; }
    input.focus();
  }
  function closePanel() { panel.classList.remove('open'); }

  bubble.addEventListener('click', function () {
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  var clBtn = panel.querySelector('.xcl') || panel.querySelector('.cl');
  if (clBtn) clBtn.addEventListener('click', closePanel);

  async function send() {
    var msg = (input.value || '').trim();
    if (!msg) return;
    input.value = '';
    addMsg(msg, 'me');
    history.push({ role: 'user', content: msg });
    sendBtn.disabled = true;
    var thinking = addMsg('…', 'ai');

    try {
      var headers = { 'Content-Type': 'application/json' };
      // include CSRF + auth automatically if the site's helper exists
      var fetchFn = window.csrfFetch || fetch;
      var res = await fetchFn('/api/ai/chat', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ message: msg, history: history.slice(-10) })
      });

      if (res.status === 503) { thinking.textContent = t('soon'); sendBtn.disabled = false; return; }
      if (res.status === 429) { thinking.textContent = t('rate'); sendBtn.disabled = false; return; }
      if (!res.ok) { thinking.textContent = t('err'); sendBtn.disabled = false; return; }

      var data = await res.json();
      var reply = data.reply || data.message || data.content || t('err');
      thinking.textContent = reply;
      history.push({ role: 'assistant', content: reply });
    } catch (e) {
      thinking.textContent = t('err');
    } finally {
      sendBtn.disabled = false;
      body.scrollTop = body.scrollHeight;
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  document.addEventListener('spn-lang-change', applyLang);
})();
