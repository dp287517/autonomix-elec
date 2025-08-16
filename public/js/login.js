// /public/js/login.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';

  async function doLogin() {
    const emailEl = document.getElementById('email');
    const passEl  = document.getElementById('password');
    const errEl   = document.getElementById('err');

    const email = (emailEl?.value || '').trim().toLowerCase();
    const password = passEl?.value || '';

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    if (!email || !password) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Email et mot de passe requis.'; }
      return;
    }

    try {
      const r = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        const tech = (data && data.error) ? data.error : `HTTP ${r.status}`;
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = `Connexion impossible (${tech}).`; }
        return;
      }

      // Stocke le token puis purge tout ancien espace mémorisé (évite 403 sur dashboard)
      localStorage.setItem('autonomix_token', data.token);
      localStorage.removeItem('selected_account_id');
      // petit profil local (facultatif)
      localStorage.setItem('autonomix_user', JSON.stringify(data.user || { email }));

      location.href = 'dashboard.html';
    } catch (e) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Connexion impossible (réseau).'; }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn');
    if (btn) btn.addEventListener('click', doLogin);

    // Entrée clavier
    const formInputs = [document.getElementById('email'), document.getElementById('password')].filter(Boolean);
    formInputs.forEach(inp => inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); doLogin(); }
    }));
  });
})();
