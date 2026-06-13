(function () {
  'use strict';

  var SK = 'zyntevo_lang';
  var SUPPORTED = ['de', 'en', 'fr'];

  function getLang() {
    try {
      var s = sessionStorage.getItem(SK);
      return SUPPORTED.indexOf(s) !== -1 ? s : 'de';
    } catch (e) { return 'de'; }
  }

  function setLang(lang) {
    try { sessionStorage.setItem(SK, lang); } catch (e) {}
    applyLang(lang);
    updateSwitcher(lang);
    document.documentElement.lang = lang;
  }

  function applyLang(lang) {
    var T = window.ZYN_T;
    if (!T) {
      setTimeout(function () { applyLang(lang); }, 100);
      return;
    }
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
      return (o != null && o[k] !== undefined) ? o[k] : undefined;
    }, obj);
  }

  function updateSwitcher(lang) {
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.style.background = active ? 'white' : 'transparent';
      btn.style.boxShadow = active ? '0 1px 3px rgba(0,0,0,0.18)' : 'none';
      btn.style.opacity = active ? '1' : '0.5';
    });
  }

  function wireSwitcher() {
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setLang(btn.getAttribute('data-lang'));
      });
    });
  }

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
