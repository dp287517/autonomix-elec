// public/js/license_guard.js
(() => {
  async function getLicense(appCode){
    const API = (window.API_BASE_URL || '') + '/api';
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) return null;
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}`, {
        headers: { Authorization:`Bearer ${token}` }
      });
      if(!r.ok) return null;
      return await r.json(); // { tier }
    }catch{ return null; }
  }
  window.guardApp = async function guardApp({ suite='ATEX', appKey, minTier, redirect='subscription_atex.html' }){
    const lic = await getLicense(suite);
    const tier = lic?.tier ?? 0;
    if (tier < (minTier||0)) {
      window.location.href = redirect;
      return false;
    }
    return true;
  }
})();
