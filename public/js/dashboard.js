// /public/js/dashboard.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';

  // ---------- utils ----------
  function authHeaders() {
    const t = localStorage.getItem('autonomix_token') || '';
    return { Authorization: `Bearer ${t}` };
  }
  function $(sel) { return document.querySelector(sel); }
  function show(el) { el && el.classList.remove('d-none'); }
  function hide(el) { el && el.classList.add('d-none'); }

  // ---------- API helpers ----------
  async function myAccounts() {
    const r = await fetch(`${API}/accounts/mine`, { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error(`accounts/mine ${r.status}`);
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  }

  async function fetchLicense(appCode, accountId) {
    const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, {
      headers: authHeaders(),
      cache: 'no-store'
    });
    if (r.status === 403) {
      const err = new Error('forbidden_account');
      err.code = 403;
      throw err;
    }
    if (!r.ok) throw new Error(`licenses ${r.status}`);
    return r.json();
  }

  // ---------- preferred account id ----------
  function getPreferredAccountIdFromURL() {
    const u = new URL(window.location.href);
    return u.searchParams.get('account_id');
  }
  function setPreferredAccountId(accountId, push = true) {
    localStorage.setItem('selected_account_id', String(accountId));
    const u = new URL(window.location.href);
    u.searchParams.set('account_id', String(accountId));
    if (push) window.history.replaceState({}, '', u.toString());
  }

  // ---------- auto-recovery if 403 ----------
  async function chooseFirstAccessibleAccount(list) {
    for (const a of list) {
      const id = a.id || a.account_id;
      try {
        await fetchLicense('ATEX', id);
        return String(id);
      } catch (e) {
        if (e.code !== 403) throw e; // autre erreur => on propage
      }
    }
    return null;
  }

  // ---------- (optionnel) petits rendus de secours ----------
  function renderEmptyState() {
    hide($('#apps'));
    show($('#emptyState')); // Assure-toi d’avoir un conteneur #emptyState dans le HTML
  }
  function renderGlobalError(msg) {
    const el = $('#globalError');
    if (el) { el.textContent = msg || 'Erreur au chargement du tableau de bord.'; el.classList.remove('d-none'); }
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const list = await myAccounts();   // ← ne nécessite pas de membership grâce au middleware requireAuthBasic

      if (!list.length) {
        renderEmptyState();
        return;
      }

      const listIds = list.map(a => String(a.id || a.account_id));
      let preferred = getPreferredAccountIdFromURL() || localStorage.getItem('selected_account_id') || listIds[0];

      // 1) Si l'id mémorisé n'est pas dans mes espaces → corrige avant tout appel /licenses
      if (!listIds.includes(String(preferred))) {
        preferred = listIds[0];
        setPreferredAccountId(preferred);
      }

      // 2) Test de licence sur l'espace choisi
      try {
        await fetchLicense('ATEX', preferred);
      } catch (e) {
        if (e.code === 403) {
          // 3) Auto-récupération : on choisit le premier espace accessible
          const fallback = await chooseFirstAccessibleAccount(list);
          if (fallback) {
            setPreferredAccountId(fallback);
            const u = new URL(window.location.href);
            u.searchParams.set('account_id', fallback);
            window.location.replace(u.toString());
            return;
          }
          // aucun accessible → état vide
          renderEmptyState();
          return;
        }
        throw e; // autre erreur
      }

      // 4) Ici l'espace est valide et accessible
      setPreferredAccountId(preferred); // on persiste proprement

      // —— Intégration douce avec ton code existant ——
      // Si tu as déjà une fonction globale d'init, on l'appelle :
      if (typeof window.initDashboard === 'function') {
        window.initDashboard(preferred, list);
        return;
      }

      // Sinon, on fournit un rendu fallback minimal (tu peux le remplacer par ton rendu)
      hide($('#emptyState'));
      show($('#apps'));
      // … si tu as des fonctions de rendu spécifiques, appelle-les ici.
      // ex: renderApps(list, preferred); wireActions(preferred);

      // On émet un événement pour que d'autres scripts puissent réagir
      window.dispatchEvent(new CustomEvent('autonomix:account-ready', {
        detail: { account_id: preferred, accounts: list }
      }));
    } catch (e) {
      console.error(e);
      renderGlobalError('Erreur au chargement du tableau de bord.');
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
