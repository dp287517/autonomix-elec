// js/app_guard.js — sécurise les pages statiques via attributs de données
// Usage minimal côté page:
// <html lang="fr" data-suite="ATEX" data-min-tier="1" data-redirect="subscription_atex.html">
// <script src="js/app_guard.js" defer></script>
(() => {
  const API = (window.API_BASE_URL || '') + '/api';

  async function fetchLicense(suite){
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) return null;
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(suite)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if(!r.ok) return null;
      return await r.json(); // { tier }
    }catch{ return null; }
  }

  async function guardFromAttributes(){
    const root = document.documentElement;
    const suite = root.getAttribute('data-suite');        // ex: "ATEX"
    const minTierAttr = root.getAttribute('data-min-tier'); // ex: "1"
    const redirect = root.getAttribute('data-redirect') || 'subscription_atex.html';

    if (!suite || minTierAttr === null) return; // rien à faire si non configuré

    const minTier = Number(minTierAttr) || 0;
    const lic = await fetchLicense(suite);
    const tier = lic?.tier ?? 0;

    if (tier < minTier) {
      window.location.href = redirect;
    } else {
      // démasque les blocs marqués data-guarded si besoin
      document.querySelectorAll('[data-guarded]').forEach(el => el.removeAttribute('hidden'));
    }
  }

  document.addEventListener('DOMContentLoaded', guardFromAttributes);
})();
