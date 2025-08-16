// /public/js/signup.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';

  async function doSignup() {
    const emailEl   = document.getElementById('email');
    const passEl    = document.getElementById('password');
    const confirmEl = document.getElementById('confirm');
    const msgEl     = document.getElementById('msg');

    const email    = (emailEl?.value || '').trim().toLowerCase();
    const password = passEl?.value || '';
    const confirm  = confirmEl?.value || '';

    // reset message
    if (msgEl) { msgEl.className = 'small'; msgEl.textContent = ''; }

    if (!email || !password || !confirm) {
      if (msgEl) { msgEl.classList.add('text-danger'); msgEl.textContent = 'Champs requis.'; }
      return;
    }
    if (password !== confirm) {
      if (msgEl) { msgEl.classList.add('text-danger'); msgEl.textContent = 'Les mots de passe ne correspondent pas.'; }
      return;
    }

    try {
      const r = await fetch(`${API}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password
          // Si un jour tu ajoutes un champ "name" dans le formulaire :
          // name: (document.getElementById('name')?.value || '').trim()
        })
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        const tech = (data && data.error) ? data.error : `HTTP ${r.status}`;
        if (msgEl) { msgEl.classList.add('text-danger'); msgEl.textContent = `Inscription impossible (${tech}).`; }
        return;
      }

      // Token OK → purge tout ancien espace mémorisé pour éviter un 403 au premier chargement
      localStorage.setItem('autonomix_token', data.token);
      localStorage.removeItem('selected_account_id');
      localStorage.setItem('autonomix_user', JSON.stringify(data.user || { email }));

      if (msgEl) { msgEl.classList.remove('text-danger'); msgEl.classList.add('text-success'); msgEl.textContent = 'Compte créé ! Redirection…'; }
      setTimeout(() => location.href = 'dashboard.html', 600);
    } catch (e) {
      if (msgEl) { msgEl.classList.add('text-danger'); msgEl.textContent = 'Inscription impossible (réseau).'; }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnSignup');
    if (btn) btn.addEventListener('click', doSignup);

    // Entrée clavier
    const inputs = ['email', 'password', 'confirm']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    inputs.forEach(inp => inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); doSignup(); }
    }));
  });
})();
