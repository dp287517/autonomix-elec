// public/js/license_guard.js — deprecated, kept as alias for app_guard.js
// If some pages still include license_guard.js, this keeps compatibility.
(() => {
  const s = document.createElement('script');
  s.src = 'js/app_guard.js';
  document.head.appendChild(s);
})();
