// public/js/epd-guard.js
// Garde EPD :
// - Exige un token présent AVANT tout (sinon → login)
// - Valide /api/me (avec puis sans ?account_id)
// - Injecte toujours Authorization (Bearer <JWT>) + account_id sur /api/epd* et /api/atex-*
// - Ne fait PAS de logout automatique sur un 401 générique (uniquement si /api/me échoue)

(function () {
  // -------- Token helpers ----------
  function readTokenRaw() {
    try {
      const ls = localStorage;
      return (
        ls.getItem('autonomix_token') ||
        ls.getItem('token') ||
        ls.getItem('auth_token') ||
        ls.getItem('access_token') ||
        (JSON.parse(ls.getItem('autonomix_user') || '{}')?.token || '')
      ) || '';
    } catch {
      return '';
    }
  }

  function jwtFromRaw(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^Bearer\s+/i, ''); // enlève un éventuel "Bearer "
  }

  function authHeaderValue() {
    const jwt = jwtFromRaw(readTokenRaw());
    return jwt ? ('Bearer ' + jwt) : '';
  }

  // -------- Account helpers ----------
  function parseJwtForAccountId(tok) {
    try {
      const t = String(tok).trim().replace(/^(Bearer|Token)\s+/i, '');
      const parts = t.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return (
        payload.account_id ||
        payload.accountId ||
        payload.aid ||
        payload.organization_id ||
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

  // -------- Guard: exige token + valide /api/me ----------
  async function guard() {
    try {
      const jwt = jwtFromRaw(readTokenRaw());
      if (!jwt) {
        // Pas de token → pas de faux positif via un éventuel /api/me “stub”
        location.href = 'login.html';
        return;
      }

      const auth = 'Bearer ' + jwt;
      const aid = currentAccountId();

      // Essai 1 : /api/me avec account_id
      let me = new URL('/api/me', location.origin);
      if (aid) me.searchParams.set('account_id', aid);
      let r = await fetch(me.toString(), {
        headers: { Authorization: auth },
        credentials: 'include',
        cache: 'no-store'
      });

      // Essai 2 : /api/me sans account_id (backend peut choisir l’account par défaut)
      if (!r.ok) {
        me = new URL('/api/me', location.origin);
        r = await fetch(me.toString(), {
          headers: { Authorization: auth },
          credentials: 'include',
          cache: 'no-store'
        });
      }

      if (!r.ok) {
        location.href = 'login.html';
        return;
      }

      // mémorise un éventuel account_id renvoyé
      try {
        const data = await r.json();
        const found = data?.account_id || data?.account?.id || data?.id || null;
        if (found) cacheAccountId(found);
      } catch { /* ignore */ }
    } catch {
      location.href = 'login.html';
    }
  }

  // -------- fetch override : impose Authorization + ?account_id ----------
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        let url = typeof input === 'string' ? input : input.url;
        if (url && url.indexOf('/api/') === 0) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          const auth = authHeaderValue();
          const raw = readTokenRaw();

          // Écrase toujours Authorization pour garantir "Bearer <JWT>" exact
          if (auth) headers.set('Authorization', auth);
          if (raw) {
            headers.set('X-Auth-Token', jwtFromRaw(raw));
            headers.set('X-Access-Token', jwtFromRaw(raw));
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
          if (!('credentials' in init)) init.credentials = 'include';
          input = typeof input === 'string' ? url : new Request(url, input);
        }
      } catch { /* ignore */ }
      // Pas de logout automatique ici
      return origFetch(input, init);
    };
  }

  document.addEventListener('DOMContentLoaded', guard);
})();
