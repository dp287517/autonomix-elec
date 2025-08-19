// public/js/epd-guard.js
// Objectif : éviter la redirection à tort vers login.
// 1) On tente d'abord /api/me en mode "cookie/session" (credentials: 'include').
// 2) Si pas OK, on tente en Bearer avec un éventail de clés possibles dans le localStorage.
// 3) On ne redirige vers login QUE si les deux échouent.

(async function(){
  try {
    // Tentative 1 : session/cookie (ton app.js renvoie 200 ici)
    // => si OK on laisse charger la page, même sans token.
    const rCookie = await fetch('/api/me', { credentials: 'include' });
    if (rCookie.ok) return;

    // Tentative 2 : Bearer multi-clés (dashboard/anciens noms)
    const token =
      localStorage.getItem('autonomix_token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('access_token') ||
      (JSON.parse(localStorage.getItem('autonomix_user')||'{}')?.token || '');

    if (!token) {
      window.location.href = 'login.html';
      return;
    }

    const rBearer = await fetch('/api/me', {
      headers: { Authorization: 'Bearer '+token },
      credentials: 'include'
    });

    if (!rBearer.ok) {
      // Nettoyage défensif
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('token');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('access_token');
      localStorage.removeItem('autonomix_user');
      window.location.href = 'login.html';
      return;
    }

    // Sinon OK → on reste sur la page
  } catch {
    window.location.href = 'login.html';
  }
})();
