/*
 * ZYNTEVO Cookie-Consent für Google Analytics.
 * Lädt GA erst nach ausdrücklicher Einwilligung (Opt-in), Ablehnen ist
 * gleichwertig zu Akzeptieren (§ 25 TDDDG, ehemals TTDSG, + DSGVO Art. 6 Abs. 1 lit. a).
 * Selbst gehostet, keine externen Abhängigkeiten, funktioniert unabhängig
 * vom jeweiligen Seiten-Stylesheet.
 */
(function () {
  var GA_ID = 'G-GPT0KRVEM2';
  var STORAGE_KEY = 'zyntevo_consent';

  function loadGA() {
    if (window.__zyntevoGaLoaded) return;
    window.__zyntevoGaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  function injectStyle() {
    if (document.getElementById('zyntevo-cookie-style')) return;
    var css =
      '#zyntevo-cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
      'background:#1D1D1F;color:#F4F3EF;padding:20px 24px;display:flex;flex-wrap:wrap;' +
      'align-items:center;justify-content:space-between;gap:16px;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      'box-shadow:0 -10px 30px rgba(0,0,0,.25);}' +
      '#zyntevo-cookie-banner p{margin:0;font-size:13.5px;line-height:1.6;color:#E5E5E7;max-width:640px;}' +
      '#zyntevo-cookie-banner a{color:#D4AF37;text-decoration:underline;}' +
      '#zyntevo-cookie-actions{display:flex;gap:10px;flex-wrap:wrap;}' +
      '#zyntevo-cookie-actions button{font-family:inherit;font-size:13.5px;font-weight:700;' +
      'padding:11px 22px;border-radius:999px;cursor:pointer;border:1px solid rgba(255,255,255,.25);' +
      'transition:.2s;}' +
      '#zyntevo-cookie-accept{background:#D4AF37;color:#1D1D1F;border-color:#D4AF37;}' +
      '#zyntevo-cookie-accept:hover{background:#B8923A;}' +
      '#zyntevo-cookie-reject{background:transparent;color:#F4F3EF;}' +
      '#zyntevo-cookie-reject:hover{background:rgba(255,255,255,.08);}' +
      '@media (max-width:640px){#zyntevo-cookie-banner{flex-direction:column;align-items:stretch;' +
      'text-align:left;}#zyntevo-cookie-actions{justify-content:stretch;}' +
      '#zyntevo-cookie-actions button{flex:1;}}';
    var styleEl = document.createElement('style');
    styleEl.id = 'zyntevo-cookie-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  function showBanner() {
    injectStyle();
    var existing = document.getElementById('zyntevo-cookie-banner');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'zyntevo-cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie-Einwilligung');
    el.innerHTML =
      '<p>Wir verwenden Google Analytics, um zu verstehen, wie unsere Website genutzt wird. ' +
      'Das setzt Cookies ein, für die wir Ihre Einwilligung benötigen. Mehr dazu in unserer ' +
      '<a href="datenschutz.html">Datenschutzerklärung</a>.</p>' +
      '<div id="zyntevo-cookie-actions">' +
      '<button id="zyntevo-cookie-reject" type="button">Ablehnen</button>' +
      '<button id="zyntevo-cookie-accept" type="button">Akzeptieren</button>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('zyntevo-cookie-accept').addEventListener('click', function () {
      localStorage.setItem(STORAGE_KEY, 'granted');
      loadGA();
      el.remove();
    });
    document.getElementById('zyntevo-cookie-reject').addEventListener('click', function () {
      localStorage.setItem(STORAGE_KEY, 'denied');
      el.remove();
    });
  }

  // Erlaubt einen "Cookie-Einstellungen"-Link im Footer, um die Auswahl jederzeit zu ändern.
  window.zyntevoOpenCookieBanner = function () {
    showBanner();
  };

  document.addEventListener('DOMContentLoaded', function () {
    var consent = localStorage.getItem(STORAGE_KEY);
    if (consent === 'granted') {
      loadGA();
    } else if (consent !== 'denied') {
      showBanner();
    }
  });
})();
