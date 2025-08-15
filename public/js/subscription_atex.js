// public/js/subscription_atex.js — v7 (robuste: owners + fallback + silencieux si 403 members)
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';
  const toServerTier = (t)=> (typeof t==='number'? (t+1) : 1); // 0->1,1->2,2->3
  const fromServerTier = (t)=> (typeof t==='number'? Math.max(0, Math.min(2, t-1)) : 0);

  const token = () => localStorage.getItem('autonomix_token') || '';
  const headers = () => ({ Authorization:'Bearer '+token(), 'Content-Type':'application/json' });
  const accId = () => Number(new URLSearchParams(location.search).get('account_id')) || Number(localStorage.getItem(STORAGE_SEL) || '0') || null;

  function labelTier(t){ return t===2?'Pro': (t===1?'Personnel':'Free'); }
  function status(txt){ const el=document.getElementById('currentPlan'); if(el) el.textContent = txt; }

  async function owners(aid){
    try{ const r = await fetch(`${API}/accounts/${aid}/owners`, { headers: headers() }); return r.ok ? (await r.json()) : []; }catch{ return []; }
  }
  function showOwners(list){
    const el = document.getElementById('ownerHint'); if(!el) return;
    el.innerHTML='';
    if(!list || !list.length){ el.textContent='Owner inconnu'; return; }
    el.textContent = 'Owner(s) : ' + list.map(m=> (m.email||m)).join(', ');
  }

  async function currentSub(aid){
    try{
      const r = await fetch(`${API}/subscriptions/${APP}?account_id=${aid}`, { headers: headers() });
      if (r.ok) { const js = await r.json(); js.tier = fromServerTier(Number(js.tier||0)); return js; }
      if (r.status === 403) throw new Error('forbidden');
    }catch{}
    try{
      const r2 = await fetch(`${API}/licenses/${APP}?account_id=${aid}`, { headers: headers() });
      if (r2.ok){ const lic = await r2.json(); return { tier: fromServerTier(Number(lic.tier||0)), status: (Number(lic.tier||0)>0)?'active':'none', seats_total: 1, scope:'account' }; }
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
  };
    Object.entries(map).forEach(([t,sel])=>{
      const b=document.querySelector(sel); if(!b) return;
      const isCurrent = Number(t) === Number(tier);
      b.disabled = isCurrent || !isOwner;
      b.classList.toggle('disabled', b.disabled);
      b.title = isCurrent ? 'Plan actuel' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
    });
  }

  async function choose(t){
    const aid = accId(); if (!aid) return;
    let r;
    try{
      r = await fetch(`${API}/subscriptions/${APP}/choose?account_id=${aid}`, { method:'POST', headers: headers(), body: JSON.stringify({ tier: toServerTier(t) }) });
      if (r.status === 400 || r.status === 404) throw new Error('fallback');
    }catch{
      r = await fetch(`${API}/subscriptions/${APP}?account_id=${aid}`, { method:'POST', headers: headers(), body: JSON.stringify({ tier: toServerTier(t) }) });
    }
    if (!r.ok){
      let msg = 'Erreur ' + r.status;
      try{ const e = await r.json(); if(e && e.error) msg = e.error; }catch{}
      alert(msg); return;
    }
    const url = new URL(window.location.origin + '/dashboard.html'); url.searchParams.set('account_id', aid); location.href = url.toString();
  }

  
  document.addEventListener('DOMContentLoaded', async ()=>{
    const aid = accId();
    if (aid){ try { localStorage.setItem(STORAGE_SEL, String(aid)); } catch(_){} }
    if (!aid){ status('Aucun espace sélectionné'); return; }

    // Load owners
    const own = await owners(aid); showOwners(own);

    // Determine role via /accounts/mine
    let isOwner = false;
    try{
      const rMine = await fetch(`${API}/accounts/mine`, { headers: headers() });
      if (rMine.ok){
        const mine = await rMine.json();
        const arr = mine.accounts || mine;
        const row = (arr||[]).find(x => String(x.id||x.account_id) === String(aid));
        isOwner = (row && (row.role === 'owner'));
      }
    }catch{}

    // Get current sub/license
    const sub = await currentSub(aid);
    const planLabel = `Licence actuelle : ${labelTier(Number(sub.tier||0))}`;
    status(planLabel);
    armButtons(sub.tier, isOwner);

    // Wire choose buttons
    document.querySelectorAll('button[data-plan]').forEach(btn => {
      btn.addEventListener('click', ()=> choose(Number(btn.getAttribute('data-plan'))));
    });

    // Members & seats panel
    try{
      const r = await fetch(`${API}/accounts/members/${APP}?account_id=${aid}`, { headers: headers() });
      const box = document.getElementById('membersBox');
      if (r.status === 403) { if (box) box.textContent = "Accès restreint (owner/admin requis)."; }
      else if (r.ok){
        const data = await r.json();
        const total = (data.members||[]).length;
        const seats = (data.members||[]).filter(m=>m.has_seat).length;
        if (box) box.textContent = `Membres: ${total} • Sièges assignés: ${seats}`;
      } else { if (box) box.textContent = 'Erreur chargement des membres.'; }
    }catch{ const box = document.getElementById('membersBox'); if (box) box.textContent = 'Erreur réseau pour membres.'; }
  });

})();