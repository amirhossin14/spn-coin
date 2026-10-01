/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * ui-prefs.js — theme (dark / light) preference only.
 *
 * Language is handled entirely by i18n.js + the footer switcher; this file no
 * longer touches language at all (that earlier dual system caused the page to
 * flip back to English). Theme is applied site-wide via CSS variables and
 * remembered in localStorage so it survives navigation and language changes.
 */
(function () {
  var THEME_KEY = 'spn_theme';

  function setPref(v) { try { localStorage.setItem(THEME_KEY, v); } catch (e) {} }
  function getPref() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }

  // Light-mode CSS variable overrides (dark is the default, no overrides).
  var LIGHT_VARS = {
    '--bg': '#f4f6fb', '--bg2': '#e9edf5', '--base': '#f4f6fb', '--void': '#e9edf5',
    '--panel': '#ffffff', '--surface': '#ffffff', '--card': '#ffffff', '--raised': '#f0f2f8',
    '--ink': '#ffffff', '--ink-2': '#f7f9fc', '--ink-3': '#eef1f7',
    '--txt': '#1a2238', '--txt2': '#4a5578', '--txt3': '#7a86a8', '--paper': '#1a2238',
    '--muted': '#8a95b5', '--sub': '#5a6588', '--mut': '#9aa4c0',
    '--bd': 'rgba(0,0,0,.10)', '--line': 'rgba(0,0,0,.12)',
  };

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'light') {
      for (var k in LIGHT_VARS) root.style.setProperty(k, LIGHT_VARS[k]);
      root.setAttribute('data-theme', 'light');
    } else {
      for (var k2 in LIGHT_VARS) root.style.removeProperty(k2);
      root.setAttribute('data-theme', 'dark');
    }
    setPref(theme);
  }

  // Remove any stale header buttons left by a cached older version.
  function removeStaleButtons() {
    ['spn-theme-btn', 'spn-lang-btn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function init() {
    applyTheme(getPref() || 'dark');
    var tries = 0;
    var iv = setInterval(function () {
      removeStaleButtons();
      if (document.getElementById('spn-topbar') || tries++ > 20) clearInterval(iv);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public API — theme only. Footer's theme button uses these.
  window.SPNPrefs = {
    applyTheme: applyTheme,
    getTheme: function () { return getPref() || 'dark'; },
    toggleTheme: function () {
      var cur = (getPref() === 'light') ? 'dark' : 'light';
      applyTheme(cur);
      return cur;
    },
  };
})();
