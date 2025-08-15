// public/js/subscription_atex.js — v7 (robuste: owners + fallback + silencieux si 403 members)
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  const token = () => localStorage.getItem('autonomix_token') || '';
  const headers = () => ({ Authorization:'Bearer '+token(), 'Content-Type':'application/json' });
  const accId = () => Number(new URLSearchParams(location.search).get('account_id')) || Number(localStorage.getItem(STORAGE_SEL) || '0') || null;

  function labelTier(t){ return t===3?'Pro': (t===2?'Personnel':'Free'); }
  function status(txt){ const el=document.getElementById('subStatus'); if(el) el.textContent=txt; }

  async function owners(aid){
    try{ const r = await fetch(`${API}/accounts/${aid}/owners`, { headers: headers() }); return r.ok ? (await r.json()) : []; }catch{ return []; }
  }
  function showOwners(list){
    const el = document.getElementById('ownerEmails'); if(!el) return;
    el.innerHTML='';
    if(!list || !list.length){ el.textContent='Owner inconnu'; return; }
    list.forEach(m=>{ const d=document.createElement('div'); d.textContent = (m.email || m); el.appendChild(d); });
  }

  async function currentSub(aid){
    try{
      const r = await fetch(`${API}/subscriptions/${APP}?account_id=${aid}`, { headers: headers() });
      if (r.ok) return r.json();
      if (r.status === 403) throw new Error('forbidden');
    }catch{}
    try{
      const r2 = await fetch(`${API}/licenses/${APP}?account_id=${aid}`, { headers: headers() });
      if (r2.ok){ const lic = await r2.json(); return { tier: Number(lic.tier||0), status: lic.tier>0?'active':'none', seats_total: 1, scope:'account' }; }
    }catch{}
    return { tier:0, status:'none', seats_total:0, scope:'account' };
  }

  function armButtons(tier, isOwner){
    const map = {1:'#btn-tier-free', 2:'#btn-tier-personal', 3:'#btn-tier-pro'};
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
    try{
      const r = await fetch(`${API}/subscriptions/${APP}/choose?account_id=${aid}`, {
        method:'POST', headers: headers(), body: JSON.stringify({ tier: t })
      });
      let data = {};
      try { data = await r.json(); } catch {}
      if (!r.ok){
        const tech = data && data.error ? data.error : ('HTTP '+r.status);
        alert('Changement de plan refusé: ' + tech);
        return;
      }
      const url = new URL(window.location.origin + '/dashboard.html');
      url.searchParams.set('account_id', aid);
      location.href = url.toString();
    }catch(e){
      alert('Changement de plan impossible (réseau).');
    }
  }/subscriptions/${APP}/choose?account_id=${aid}`, { method:'POST', headers: headers(), body: JSON.stringify({ tier: t }) });
      if (r.status === 400 || r.status === 404) throw new Error('fallback');
    }catch{
      r = await fetch(`${API}/subscriptions/${APP}?account_id=${aid}`, { method:'POST', headers: headers(), body: JSON.stringify({ tier: t }) });
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
    if (!aid){ status('Aucun espace sélectionné'); return; }

    const own = await owners(aid); showOwners(own);

    const sub = await currentSub(aid);
    status('Abonnement — Suite ATEX');
    armButtons(sub.tier, true);

    document.addEventListener('DOMContentLoaded', async ()=>{
    const aid = accId();
    if (!aid){ status('Aucun espace sélectionné'); return; }

    const own = await owners(aid); showOwners(own);

    const subObj = await currentSub(aid);
    status('Abonnement — Suite ATEX');
    armButtons(subObj.tier, true);

    // Robust listeners: prefer explicit ids if present
    const mapId = [
      ['#btn-tier-free', 1],
      ['#btn-tier-personal', 2],
      ['#btn-tier-pro', 3],
    ];
    let wired = 0;
    mapId.forEach(([sel, val])=>{
      const el = document.querySelector(sel);
      if (el){ el.addEventListener('click', ()=>choose(val)); wired++; }
    });

    // Fallback: buttons with data-plan = 0/1/2
    if (!wired){
      document.querySelectorAll('button[data-plan]').forEach(btn=>{
        const ui = Number(btn.getAttribute('data-plan')); // 0,1,2
        const srv = (ui >= 0 && ui <= 2) ? (ui + 1) : 1;  // 1,2,3
        btn.addEventListener('click', ()=>choose(srv));
      });
    }
  });})();