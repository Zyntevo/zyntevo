(function () {
  'use strict';

  var STORAGE_KEY = 'zyntevo_lang';
  var SUPPORTED = ['de', 'en', 'fr'];
  var FLAGS = { de: '🇩🇪', en: '🇬🇧', fr: '🇫🇷' };
  var LABELS = { de: 'DE', en: 'EN', fr: 'FR' };

  function getLang() {
    var stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.indexOf(stored) !== -1 ? stored : 'de';
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    applyLang(lang);
    updateSwitcher(lang);
    updateHtmlLang(lang);
  }

  function updateHtmlLang(lang) {
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

      // Save German original on first pass so we can restore on switch back
      if (!el.hasAttribute('data-i18n-orig')) {
        el.setAttribute('data-i18n-orig', el.innerHTML);
      }

      if (lang === 'de') {
        el.innerHTML = el.getAttribute('data-i18n-orig');
      } else {
        el.innerHTML = val;
      }
    });

    // data-i18n-placeholder for input placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = resolve(t, key);
      if (val !== undefined) el.placeholder = val;
    });
  }

  /* Dot-notation key resolver: "nav.solutions" → t.nav.solutions */
  function resolve(obj, key) {
    return key.split('.').reduce(function (o, k) {
      return o && o[k] !== undefined ? o[k] : undefined;
    }, obj);
  }

  /* ── Switcher UI ─────────────────────────────────────────── */
  function buildSwitcher() {
    var current = getLang();
    var wrap = document.createElement('div');
    wrap.id = 'zyn-lang-switcher';
    wrap.style.cssText = [
      'display:flex', 'align-items:center', 'gap:4px',
      'margin-left:16px', 'font-size:13px', 'font-weight:700',
      'font-family:Inter,sans-serif'
    ].join(';');

    SUPPORTED.forEach(function (lang) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-lang', lang);
      btn.title = lang.toUpperCase();
      btn.style.cssText = [
        'background:none', 'border:1px solid transparent',
        'border-radius:6px', 'padding:3px 7px', 'cursor:pointer',
        'font-size:13px', 'font-weight:700', 'letter-spacing:.5px',
        'color:#475569', 'transition:.15s', 'line-height:1',
        'font-family:Inter,sans-serif'
      ].join(';');

      btn.innerHTML = FLAGS[lang] + ' ' + LABELS[lang];

      if (lang === current) {
        btn.style.borderColor = '#D4AF37';
        btn.style.color = '#D4AF37';
      }

      btn.addEventListener('mouseenter', function () {
        if (getLang() !== lang) btn.style.color = '#1E293B';
      });
      btn.addEventListener('mouseleave', function () {
        if (getLang() !== lang) btn.style.color = '#475569';
      });

      btn.addEventListener('click', function () {
        setLang(lang);
      });

      wrap.appendChild(btn);
    });

    return wrap;
  }

  function updateSwitcher(lang) {
    var wrap = document.getElementById('zyn-lang-switcher');
    if (!wrap) return;
    wrap.querySelectorAll('button').forEach(function (btn) {
      var isActive = btn.getAttribute('data-lang') === lang;
      btn.style.borderColor = isActive ? '#D4AF37' : 'transparent';
      btn.style.color = isActive ? '#D4AF37' : '#475569';
    });
  }

  function injectSwitcher() {
    // 1. Marketing pages: inject into .nav-right (inside .nav-inner flex row)
    // 2. Legal pages: inject into nav.nav (simple single-link nav)
    // 3. KI-tool / AGB pages: inject into .header .container
    var target =
      document.querySelector('.nav-right') ||
      document.querySelector('nav.nav') ||
      document.querySelector('.header .container');
    if (!target) return;
    target.appendChild(buildSwitcher());
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    if (!window.ZYN_T) {
      console.warn('ZYNTEVO: translations.js not loaded');
      return;
    }
    injectSwitcher();
    var lang = getLang();
    if (lang !== 'de') applyLang(lang);
    updateHtmlLang(lang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use (e.g. KI-tool pages passing language to API)
  window.ZYN_LANG = {
    get: getLang,
    set: setLang,
  };
})();
