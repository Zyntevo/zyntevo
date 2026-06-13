(function () {
  'use strict';

  var STORAGE_KEY = 'zyntevo_lang';
  var SUPPORTED = ['de', 'en', 'fr'];

  function getLang() {
    var stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.indexOf(stored) !== -1 ? stored : 'de';
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    applyLang(lang);
    updateSwitcher(lang);
    document.documentElement.lang = lang;
  }

  /* ── DOM updater ─────────────────────────────────────────── */
  function applyLang(lang) {
    var T = window.ZYN_T;
    if (!T) return;
    var t = T[lang] || T['de'];

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = resolve(t, key);
      if (val === undefined) return;
      if (!el.hasAttribute('data-i18n-orig')) {
        el.setAttribute('data-i18n-orig', el.innerHTML);
      }
      el.innerHTML = (lang === 'de') ? el.getAttribute('data-i18n-orig') : val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = resolve(t, key);
      if (val !== undefined) el.placeholder = val;
    });
  }

  function resolve(obj, key) {
    return key.split('.').reduce(function (o, k) {
      return o && o[k] !== undefined ? o[k] : undefined;
    }, obj);
  }

  /* ── Switcher state update ───────────────────────────────── */
  function updateSwitcher(lang) {
    document.querySelectorAll('#zyn-lang-switcher button[data-lang]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.style.borderColor = active ? '#D4AF37' : 'transparent';
      btn.style.color = active ? '#D4AF37' : '#475569';
    });
  }

  /* ── Wire click events on existing HTML switcher ─────────── */
  function wireSwitcher() {
    document.querySelectorAll('#zyn-lang-switcher button[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLang(btn.getAttribute('data-lang'));
      });
    });
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    wireSwitcher();
    var lang = getLang();
    updateSwitcher(lang);
    document.documentElement.lang = lang;
    if (lang !== 'de') applyLang(lang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ZYN_LANG = { get: getLang, set: setLang };
})();
