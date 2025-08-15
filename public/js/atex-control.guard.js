
(function(){
  function getToken(){ try{ return localStorage.getItem('autonomix_token') || ''; }catch(_e){ return ''; } }
  function logout(){
    try{
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
    }catch(_e){}
    location.href = 'login.html';
  }
  function currentAccountId(){
    try{
      var p = new URLSearchParams(location.search).get('account_id');
      return p || localStorage.getItem('autonomix_selected_account_id') || null;
    }catch(_e){ return null; }
  }
  async function guard(){
    var t = getToken();
    if (!t) { logout(); return; }
    try{
      var r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) { logout(); return; }
      await r.json();
    }catch(_e){ logout(); }
  }

  // Global fetch wrapper: inject Authorization and account_id for /api/atex-* endpoints
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function(input, init){
      try{
        var url = (typeof input === 'string') ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          init = init || {};
          var headers = new Headers(init.headers || {});
          var tok = getToken();
          if (tok && !headers.has('Authorization')) {
            headers.set('Authorization', 'Bearer ' + tok);
          }

          // Auto-append account_id for ATEX endpoints if missing
          if (/^\/api\/atex-/.test(url) && !/[?&]account_id=/.test(url)) {
            var acc = currentAccountId();
            if (acc) {
              var u = new URL(url, location.origin);
              u.searchParams.set('account_id', acc);
              url = u.pathname + u.search;
            }
          }

          init.headers = headers;
          if (typeof input !== 'string') {
            input = new Request(url, input);
          } else {
            input = url;
          }
        }
      }catch(_e){ /* ignore wrapper errors */ }
      return origFetch(input, init).then(function(r){
        if (r && r.status === 401) { logout(); throw new Error('unauthenticated'); }
        return r;
      });
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    guard();
  });
})();
