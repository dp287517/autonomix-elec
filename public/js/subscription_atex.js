// public/js/subscription_atex.js — fixed
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  // Helpers
  const token = () => localStorage.getItem('autonomix_token') || '';
  const headers = () => ({ Authorization:'Bearer '+token(), 'Content-Type':'application/json' });
  const urlAccId = () => {
    try { return Number(new URLSearchParams(location.search).get('account_id')) || null; } catch { return null; }
  };
  const selectedAccId = () => {
    const u = urlAccId();
    if (u) { try{ localStorage.setItem(STORAGE_SEL, String(u)); }catch{} return u; }
    try { return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; } catch { return null; }
  };

  // Tier conversion (frontend uses 0..2; backend uses 1..3)
  const toServerTier   = (t)=> (typeof t==='number' ? (t<=0?1 : (t>=2?3 : t+1)) : 1);
  const fromServerTier = (t)=> (typeof t==='number' && t>0 ? Math.max(0, Math.min(2, t-1)) : 0);
  const labelTier = (t)=> t===2 ? 'Pro' : (t===1 ? 'Personal' : 'Free');

  // UI setters
  const setOwnerHint = (txt) => { const el = document.getElementById('ownerHint'); if (el) el.textContent = txt; };
  const setCurrentPlan = (txt)=> { const el = document.getElementById('currentPlan'); if (el) el.textContent = txt; };
  const setMembersBox = (txt) => { const el = document.getElementById('membersBox'); if (el) el.textContent = txt; };

  async function owners(accountId){
    try{
      const r = await fetch(`${API}/accounts/${accountId}/owners`, { headers: headers() });
      if (!r.ok) return [];
      return await r.json();
    }catch{ return []; }
  }
  function showOwners(list){
    if (!list || !list.length) { setOwnerHint('Owner inconnu'); return; }
    const emails = list.map(m => (m.email || m)).join(', ');
    setOwnerHint('Owner(s) : ' + emails);
  }

  async function currentSub(accountId){
    // Prefer /subscriptions/APP (returns {tier,status,seats_total})
    try{
      const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accountId}`, { headers: headers() });
      if (r.ok) {
        const js = await r.json();
        js.tier = fromServerTier(Number(js.tier||0));
        return js;
      }
      if (r.status === 403) throw new Error('forbidden');
    }catch{}
    // Fallback to /licenses/APP
    try{
      const r2 = await fetch(`${API}/licenses/${APP}?account_id=${accountId}`, { headers: headers() });
      if (r2.ok){
        const lic = await r2.json();
        return { tier: fromServerTier(Number(lic.tier||0)), status: (Number(lic.tier||0)>0 ? 'active' : 'none'), seats_total: 1, scope:'account' };
      }
    }catch{}
    return { tier:0, status:'none', seats_total:0, scope:'account' };
  }

  function armButtons(tier, isOwner){
    const btns = Array.from(document.querySelectorAll('button[data-plan]'));
    btns.forEach(btn => {
      const plan = Number(btn.getAttribute('data-plan'));
      const isCurrent = Number(plan) === Number(tier);
      btn.disabled = isCurrent || !isOwner;
      btn.classList.toggle('disabled', btn.disabled);
      btn.title = isCurrent ? 'Plan actuel' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
    });
  }

  async function choose(planTier0to2){
    const aid = selectedAccId(); if (!aid) return;
    let r;
    try{
      r = await fetch(`${API}/subscriptions/${APP}/choose?account_id=${aid}`, {
        method:'POST',
        headers: headers(),
        body: JSON.stringify({ tier: toServerTier(planTier0to2) })
      });
      if (r.status === 400 || r.status === 404) throw new Error('fallback');
    }catch{
      // Legacy fallback
      r = await fetch(`${API}/subscriptions/${APP}?account_id=${aid}`, {
        method:'POST',
        headers: headers(),
        body: JSON.stringify({ tier: toServerTier(planTier0to2) })
      });
    }
    if (!r.ok){
      let msg = 'Erreur ' + r.status;
      try{ const e = await r.json(); if (e && e.error) msg = e.error; }catch{}
      alert(msg); return;
    }
    // Back to dashboard on success
    const url = new URL(window.location.origin + '/dashboard.html');
    url.searchParams.set('account_id', aid);
    location.href = url.toString();
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const aid = selectedAccId();
    if (!aid){ setCurrentPlan('Aucun espace sélectionné'); return; }

    // Owners line
    const own = await owners(aid);
    showOwners(own);

    // Determine if current user is owner on this account
    let isOwner = false;
    try{
      const rMine = await fetch(`${API}/accounts/mine`, { headers: headers() });
      if (rMine.ok){
        const mine = await rMine.json();
        const arr = mine.accounts || mine;
        const row = (arr||[]).find(x => String(x.id||x.account_id) === String(aid));
        isOwner = !!(row && row.role === 'owner');
      }
    }catch{ /* ignore */ }

    // Current subscription/license
    const sub = await currentSub(aid);
    setCurrentPlan('Licence actuelle : ' + labelTier(Number(sub.tier||0)));
    armButtons(sub.tier, isOwner);

    // Wire buttons
    document.querySelectorAll('button[data-plan]').forEach(btn => {
      btn.addEventListener('click', ()=> choose(Number(btn.getAttribute('data-plan'))));
    });

    // Members & seats panel
    try{
      const r = await fetch(`${API}/accounts/members/${APP}?account_id=${aid}`, { headers: headers() });
      if (r.status === 403) {
        setMembersBox("Accès restreint (owner/admin requis).");
      } else if (r.ok){
        const data = await r.json();
        const total = (data.members||[]).length;
        const seats = (data.members||[]).filter(m=>m.has_seat).length;
        setMembersBox(`Membres: ${total} • Sièges assignés: ${seats}`);
      } else {
        setMembersBox('Erreur chargement des membres.');
      }
    }catch{
      setMembersBox('Erreur réseau pour membres.');
    }
  });
})();