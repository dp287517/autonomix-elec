// public/js/epd-guard.js
// Garde d'accès EPD : valide la session et injecte Authorization + account_id sur toutes les requêtes /api/epd* et /api/atex-*.

(function(){
  // ---- helpers ----
  function readToken() {
    try {
      return (
        localStorage.getItem('autonomix_token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('access_token') ||
        (JSON.parse(localStorage.getItem('autonomix_user') || '{}')?.token || '')
      );
    } catch { return ''; }
  }

  function currentAccountId(){
    try{
      const qsId = new URLSearchParams(location.search).get('account_id');
      if (qsId) return qsId;
      return (
        localStorage.getItem('selected_account_id') ||
        localStorage.getItem('autonomix_selected_account_id') ||
        localStorage.getItem('app_account_id') ||
        null
      );
    }catch{ return null; }
  }

  function logout() {
    try {
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('token');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('access_token');
      localStorage.removeItem('autonomix_user');
      localStorage.removeItem('selected_account_id');
      localStorage.removeItem('autonomix_selected_account_id');
      localStorage.removeItem('app_account_id');
    } catch {}
    location.href = 'login.html';
  }

  // ---- guard ----
  async function guard(){
    try {
      const token = readToken();
      const acc = currentAccountId();

      // 1) Si token dispo => tenter /api/me avec Bearer (+account_id si dispo)
      if (token) {
        const u = new URL('/api/me', location.origin);
        if (acc) u.searchParams.set('account_id', acc);
        const r = await fetch(u.toString(), {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store',
          credentials: 'include'
        });
        if (r.ok) return; // OK authentifié
      }

      // 2) fallback éventuel: tentative cookie (si un jour activé côté serveur)
      const u2 = new URL('/api/me', location.origin);
      if (acc) u2.searchParams.set('account_id', acc);
      const r2 = await fetch(u2.toString(), { credentials: 'include', cache: 'no-store' });
      if (r2.ok) return;

      // sinon -> login
      logout();
    } catch {
      logout();
    }
  }

  // ---- override fetch: inject Authorization + account_id ----
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function(input, init){
      try{
        let url = typeof input === 'string' ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          const tok = readToken();
          if (tok && !headers.has('Authorization')) {
            headers.set('Authorization', 'Bearer ' + tok);
          }
          // Append ?account_id=... pour /api/epd* et /api/atex-*
          if (/^\/api\/(?:epd|atex-)/.test(url) && !/[?&]account_id=/.test(url)) {
            const acc = currentAccountId();
            if (acc) {
              const u = new URL(url, location.origin);
              u.searchParams.set('account_id', acc);
              url = u.pathname + u.search;
            }
          }
          init.headers = headers;
          input = typeof input === 'string' ? url : new Request(url, input);
        }
      }catch{}
      return origFetch(input, init).then(function(r){
        if (r && r.status === 401) { logout(); throw new Error('unauthenticated'); }
        return r;
      });
    };
  }

  document.addEventListener('DOMContentLoaded', guard);
})();
