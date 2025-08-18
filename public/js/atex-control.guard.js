// /public/js/atex-control.guard.js
(function(){
  function getToken(){ try{ return localStorage.getItem('autonomix_token') || ''; }catch(_e){ return ''; } }
  function logout(){
    try{
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
      // nettoyage complet des sélections d'espace
      localStorage.removeItem('selected_account_id');
      localStorage.removeItem('autonomix_selected_account_id');
    }catch(_e){}
    location.href = 'login.html';
  }

  function currentAccountId(){
    try{
      const qsId = new URLSearchParams(location.search).get('account_id');
      if (qsId) return qsId;
      // préférer la clé moderne, fallback sur legacy
      return localStorage.getItem('selected_account_id')
          || localStorage.getItem('autonomix_selected_account_id')
          || null;
    }catch(_e){ return null; }
  }

  async function guard(){
    const t = getToken();
    if (!t) { logout(); return; }
    try{
      const url = new URL('/api/me', location.origin);
      const aId = currentAccountId();
      if (aId) url.searchParams.set('account_id', aId);
      const r = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + t }, cache:'no-store' });
      if (!r.ok) { logout(); return; }
      await r.json();
    }catch(_e){ logout(); }
  }

  // Wrapper fetch : ajoute Authorization & ?account_id=... pour /api/atex-*
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function(input, init){
      try{
        let url = (typeof input === 'string') ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          const tok = getToken();
          if (tok && !headers.has('Authorization')) {
            headers.set('Authorization', 'Bearer ' + tok);
          }
          // Auto-append account_id uniquement pour les endpoints ATEX
          if (/^\/api\/atex-/.test(url) && !/[?&]account_id=/.test(url)) {
            const acc = currentAccountId();
            if (acc) {
              const u = new URL(url, location.origin);
              u.searchParams.set('account_id', acc);
              url = u.pathname + u.search;
            }
          }
          init.headers = headers;
          input = (typeof input === 'string') ? url : new Request(url, input);
        }
      }catch(_e){ /* ignore */ }
      return origFetch(input, init).then(function(r){
        if (r && r.status === 401) { logout(); throw new Error('unauthenticated'); }
        return r;
      });
    };
  }

  document.addEventListener('DOMContentLoaded', function(){ guard(); });
})();
