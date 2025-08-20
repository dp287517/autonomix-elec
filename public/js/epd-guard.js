// public/js/epd-guard.js
// Garde EPD :
// - Valide l'accès via /api/me (avec ou sans account_id)
// - Injecte Authorization + account_id sur /api/epd* et /api/atex-*
// - Ne force PAS le logout sur un 401 générique (uniquement si /api/me échoue)

(function () {
  // -------- token helpers ----------
  function readTokenRaw() {
    try {
      // clés possibles
      const ls = localStorage;
      const direct =
        ls.getItem('autonomix_token') ||
        ls.getItem('token') ||
        ls.getItem('auth_token') ||
        ls.getItem('access_token');
      if (direct) return direct;

      // variantes dans un objet JSON
      const u = JSON.parse(ls.getItem('autonomix_user') || '{}');
      return (
        u.token ||
        u.jwt ||
        u.accessToken ||
        u.access_token ||
        u.idToken ||
        u.id_token ||
        ''
      );
    } catch { return ''; }
  }

  function normalizeAuthValue(tok) {
    if (!tok) return '';
    const t = String(tok).trim();
    // si l'app a déjà stocké "Bearer xxx", on ne double pas
    if (/^(Bearer|Token)\s+/i.test(t)) return t;
    return 'Bearer ' + t;
  }

  // -------- account helpers ----------
  function parseJwtForAccountId(tok) {
    try {
      const t = String(tok).trim().replace(/^(Bearer|Token)\s+/i, '');
      const [, payload] = t.split('.');
      if (!payload) return null;
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return (
        json.account_id ||
        json.accountId ||
        json.acc ||
        json.aid ||
        json.organization_id ||
        null
      );
    } catch { return null; }
  }

  function currentAccountId() {
    try {
      const qsId = new URLSearchParams(location.search).get('account_id');
      if (qsId) return qsId;

      const ls = localStorage;
      const fromLs =
        ls.getItem('selected_account_id') ||
        ls.getItem('autonomix_selected_account_id') ||
        ls.getItem('app_account_id') ||
        ls.getItem('account_id');
      if (fromLs) return fromLs;

      // tenter depuis autonomix_user
      try {
        const u = JSON.parse(ls.getItem('autonomix_user') || '{}');
        const a =
          u.account_id ||
          (u.account && (u.account.id || u.account.account_id)) ||
          (Array.isArray(u.accounts) && u.accounts[0] && (u.accounts[0].id || u.accounts[0].account_id));
        if (a) return String(a);
      } catch {}

      // tenter depuis le JWT
      const tok = readTokenRaw();
      const aid = parseJwtForAccountId(tok);
      if (aid) return String(aid);

      return null;
    } catch { return null; }
  }

  function cacheAccountId(aid) {
    if (!aid) return;
    try {
      localStorage.setItem('selected_account_id', String(aid));
      localStorage.setItem('app_account_id', String(aid));
    } catch {}
  }

  // -------- guard: valide /api/me ----------
  async function guard() {
    try {
      const tok = readTokenRaw();
      const auth = normalizeAuthValue(tok);
      const aid = currentAccountId();

      // tentative 1 : /api/me avec account_id si dispo
      let meUrl = new URL('/api/me', location.origin);
      if (aid) meUrl.searchParams.set('account_id', aid);

      let r = await fetch(meUrl.toString(), {
        headers: auth ? { Authorization: auth } : {},
        credentials: 'include',
        cache: 'no-store'
      });

      if (!r.ok) {
        // tentative 2 : /api/me sans account_id (certains backends renvoient l'account par défaut)
        meUrl = new URL('/api/me', location.origin);
        r = await fetch(meUrl.toString(), {
          headers: auth ? { Authorization: auth } : {},
          credentials: 'include',
          cache: 'no-store'
        });
      }

      if (!r.ok) {
        // échec d’authentification réel
        location.href = 'login.html';
        return;
      }

      // si /api/me renvoie un account_id, on le mémorise
      try {
        const data = await r.json();
        const found = data?.account_id || data?.account?.id || data?.id || null;
        if (found) cacheAccountId(found);
      } catch { /* ignore */ }
    } catch {
      location.href = 'login.html';
    }
  }

  // -------- fetch override ----------
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        let url = typeof input === 'string' ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          const tok = readTokenRaw();
          const auth = normalizeAuthValue(tok);

          // Authorization si absente
          if (auth && !headers.has('Authorization')) headers.set('Authorization', auth);
          // headers tolérants (au cas où ton backend les lise)
          if (tok && !headers.has('X-Auth-Token')) headers.set('X-Auth-Token', tok);
          if (tok && !headers.has('X-Access-Token')) headers.set('X-Access-Token', tok);

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
          if (!('credentials' in init)) init.credentials = 'include';
          input = typeof input === 'string' ? url : new Request(url, input);
        }
      } catch { /* ignore */ }

      // IMPORTANT : ne pas faire de logout automatique ici.
      // On laisse le code appelant gérer un 401 (sauf /api/me dans guard()).
      return origFetch(input, init);
    };
  }

  document.addEventListener('DOMContentLoaded', guard);
})();
