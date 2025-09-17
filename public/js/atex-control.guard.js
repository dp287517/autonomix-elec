// public/js/atex-control.guard.js — PUBLIC MODE (no auth, no redirect)
(function(){
  // n'ajoute que ?account_id=... sur les endpoints /api/atex-*
  function currentAccountId(){
    try{
      const qsId = new URLSearchParams(location.search).get('account_id');
      return qsId || localStorage.getItem('selected_account_id') || null;
    }catch(_e){ return null; }
  }
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function(input, init){
      try{
        let url = (typeof input === 'string') ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          // PAS d'Authorization en public
          // Auto-append account_id uniquement pour les endpoints ATEX
          if (/^\/api\/atex-/.test(url) && !/[?&]account_id=/.test(url)) {
            const acc = currentAccountId();
            if (acc) {
              const u = new URL(url, location.origin);
              u.searchParams.set('account_id', acc);
              url = u.pathname + u.search;
            }
          }
          input = (typeof input === 'string') ? url : new Request(url, input);
        }
      }catch(_e){}
      return origFetch(input, init);
    };
  }
  // aucune vérif de token / aucune redirection
})();
