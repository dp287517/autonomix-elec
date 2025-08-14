
// public/js/license_guard.js — alias for app_guard.js (back-compat)
(() => {
  const s = document.createElement('script');
  s.src = 'js/app_guard.js';
  document.head.appendChild(s);
})();
