(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const APP = 'ATEX';

  function token(){ return localStorage.getItem('autonomix_token') || ''; }
  function authHeaders(){ return { Authorization: `Bearer ${token()}`, 'Content-Type':'application/json' }; }

  async function getCurrent(){
    const r = await fetch(`${API}/subscriptions/${APP}`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json(); // { app, tier, scope, status }
  }

  function tierLabel(t){
    return t===2?'Pro': t===1?'Personal': 'Free';
  }

  async function setPlan(tier){
    const r = await fetch(`${API}/subscriptions/${APP}`, {
      method:'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tier })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      const msg = e?.error || ('Erreur HTTP '+r.status);
      if (r.status === 403) alert("Seuls les owners/admins peuvent modifier l'abonnement.");
      else if (r.status === 401) alert("Connecte-toi pour continuer.");
      else alert(msg);
      return;
    }
    await r.json();
    location.href = 'dashboard.html#plan-updated';
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    // afficher plan courant
    try {
      const cur = await getCurrent();
      const el = document.getElementById('currentPlan');
      el.textContent = `Licence actuelle : ${tierLabel(cur.tier)} (scope: ${cur.scope || '—'})`;
    } catch {
      const el = document.getElementById('currentPlan');
      el.textContent = `Licence actuelle : inconnue (connecte-toi)`;
    }

    // clics sur boutons
    document.querySelectorAll('[data-plan]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const t = +btn.getAttribute('data-plan');
        await setPlan(t);
      });
    });
  });
})();
