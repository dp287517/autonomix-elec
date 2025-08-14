// public/js/app_guard.js — multi-account aware guard for static pages
(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }

  async function getLicense(appCode, accountId){
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) return null;
    try{
      const url = `${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`;
      const r = await fetch(url, { headers: { Authorization:`Bearer ${token}` } });
      if(!r.ok) return null;
      return await r.json();
    }catch{ return null; }
  }

  window.guardApp = async function guardApp({ suite='ATEX', minTier=0, redirect='subscription_atex.html' }){
    const accountId = Number(new URLSearchParams(window.location.search).get('account_id')) || selectedAccountId();
    const lic = await getLicense(suite, accountId);
    const tier = lic?.tier ?? 0;
    if (tier < minTier) {
      window.location.href = `${redirect}?account_id=${accountId || ''}`;
      return false;
    }
    return true;
  }

  // Declarative guard via <html data-suite data-min-tier data-redirect>
  document.addEventListener('DOMContentLoaded', async ()=>{
    const root = document.documentElement;
    const suite = root.getAttribute('data-suite');
    const minTierAttr = root.getAttribute('data-min-tier');
    const redirect = root.getAttribute('data-redirect') || 'subscription_atex.html';
    if (suite && minTierAttr !== null){
      const ok = await window.guardApp({ suite, minTier: Number(minTierAttr), redirect });
      if (ok){
        document.querySelectorAll('[data-guarded]').forEach(el => el.removeAttribute('hidden'));
      }
    }
  });
})();
