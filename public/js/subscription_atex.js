// public/js/subscription_atex.js — clean build
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  // -------- Helpers
  const token = ()=> localStorage.getItem('autonomix_token') || '';
  const authHeaders = ()=> ({ Authorization: 'Bearer ' + token(), 'Content-Type':'application/json' });
  const urlAccId = ()=> { try { return Number(new URLSearchParams(location.search).get('account_id')) || null; } catch { return null; } };
  const selectedAccId = ()=> {
    const u = urlAccId();
    if (u){ try{ localStorage.setItem(STORAGE_SEL, String(u)); }catch{} return u; }
    try{ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }catch{ return null; }
  };

  // Server tier is 1..3 (1=Free, 2=Personal, 3=Pro)
  const toServerTierFromUi = (ui)=> (ui>=0 && ui<=2) ? (ui+1) : 1; // map 0,1,2 -> 1,2,3
  const normalizeServerTier = (t)=> {
    const n = Number(t||0);
    if (n===0 || n===1 || n===2) return n+1; // handle legacy 0..2
    if (n===3) return 3;
    return (n>=1 && n<=3) ? n : 1;
  };
  const labelFromServerTier = (st)=> (st===3 ? 'Pro' : (st===2 ? 'Personal' : 'Free'));

  const setOwnerHint = (txt)=>{ const el=document.getElementById('ownerHint'); if(el) el.textContent = txt; };
  const setCurrentPlan = (txt)=>{ const el=document.getElementById('currentPlan'); if(el) el.textContent = txt; };
  const setMembersBox = (txt)=>{ const el=document.getElementById('membersBox'); if(el) el.textContent = txt; };

  async function owners(accountId){
    try{
      const r = await fetch(`${API}/accounts/${accountId}/owners`, { headers: authHeaders() });
      if (!r.ok) return [];
      return await r.json();
    }catch{ return []; }
  }
  function showOwners(list){
    if (!list || !list.length){ setOwnerHint('Owner inconnu'); return; }
    setOwnerHint('Owner(s) : ' + list.map(m => (m.email || m)).join(', '));
  }

  async function currentSubServerTier(accountId){
    // Prefer /subscriptions/APP
    try{
      const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accountId}`, { headers: authHeaders() });
      if (r.ok){
        const js = await r.json();
        return normalizeServerTier(js?.tier);
      }
      if (r.status === 403) throw new Error('forbidden');
    }catch{}
    // Fallback: /licenses/APP
    try{
      const r2 = await fetch(`${API}/licenses/${APP}?account_id=${accountId}`, { headers: authHeaders() });
      if (r2.ok){
        const lic = await r2.json();
        return normalizeServerTier(lic?.tier);
      }
    }catch{}
    return 1; // default Free
  }

  function armButtons(currentServerTier, isOwner){
    // Prefer data-plan buttons (0..2 in DOM), convert to server value to compare
    const btns = Array.from(document.querySelectorAll('button[data-plan]'));
    if (btns.length){
      btns.forEach(btn => {
        const ui = Number(btn.getAttribute('data-plan')); // 0,1,2
        const srv = toServerTierFromUi(ui); // 1,2,3
        const isCurrent = (srv === currentServerTier);
        btn.disabled = isCurrent || !isOwner;
        btn.classList.toggle('disabled', btn.disabled);
        btn.title = isCurrent ? 'Plan actuel' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
        btn.onclick = ()=> choose(srv);
      });
      return;
    }
    // Fallback to explicit ids
    [['#btn-tier-free',1],['#btn-tier-personal',2],['#btn-tier-pro',3]].forEach(([sel,val])=>{
      const el = document.querySelector(sel);
      if(el){
        const isCurrent = (val === currentServerTier);
        el.disabled = isCurrent || !isOwner;
        el.classList.toggle('disabled', el.disabled);
        el.title = isCurrent ? 'Plan actuel' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
        el.onclick = ()=> choose(val);
      }
    });
  }

  async function choose(serverTier){
    const aid = selectedAccId(); if (!aid) return;
    try{
      const r = await fetch(`${API}/subscriptions/${APP}/choose?account_id=${aid}`, {
        method:'POST',
        headers: authHeaders(),
        body: JSON.stringify({ tier: serverTier })
      });
      let data = {};
      try{ data = await r.json(); }catch{}
      if (!r.ok){
        const tech = (data && data.error) ? data.error : ('HTTP ' + r.status);
        alert('Changement de plan refusé: ' + tech);
        return;
      }
      const url = new URL(window.location.origin + '/dashboard.html');
      url.searchParams.set('account_id', aid);
      location.href = url.toString();
    }catch(e){
      alert('Changement de plan impossible (réseau).');
    }
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const aid = selectedAccId();
    if (!aid){ setCurrentPlan('Aucun espace sélectionné'); return; }

    // Owners
    showOwners(await owners(aid));

    // Role (owner?)
    let isOwner = false;
    try{
      const rMine = await fetch(`${API}/accounts/mine`, { headers: authHeaders() });
      if (rMine.ok){
        const mine = await rMine.json();
        const arr = mine.accounts || mine;
        const row = (arr||[]).find(x => String(x.id||x.account_id) === String(aid));
        isOwner = !!(row && row.role === 'owner');
      }
    }catch{}

    // Current subscription tier (server scale 1..3)
    const curSrvTier = await currentSubServerTier(aid);
    setCurrentPlan('Licence actuelle : ' + labelFromServerTier(curSrvTier));
    armButtons(curSrvTier, isOwner);

    // Members & seats
    try{
      const r = await fetch(`${API}/accounts/members/${APP}?account_id=${aid}`, { headers: authHeaders() });
      if (r.status === 403) setMembersBox('Accès restreint (owner/admin requis).');
      else if (r.ok){
        const d = await r.json();
        const total = (d.members||[]).length;
        const seats = (d.members||[]).filter(m=>m.has_seat).length;
        setMembersBox(`Membres: ${total} • Sièges assignés: ${seats}`);
      } else setMembersBox('Erreur chargement des membres.');
    }catch{ setMembersBox('Erreur réseau pour membres.'); }

    // Invite wiring
    const inviteBtn = document.getElementById('inviteBtn');
    if (inviteBtn){
      inviteBtn.addEventListener('click', async ()=>{
        const emailEl = document.getElementById('inviteEmail');
        const roleEl  = document.getElementById('inviteRole');
        const msgEl   = document.getElementById('inviteMsg');
        const email = (emailEl && emailEl.value || '').trim();
        const invRole = (roleEl && roleEl.value) || 'member';
        if (!email){ if(msgEl){ msgEl.className='small text-danger'; msgEl.textContent='Email requis.'; } return; }
        msgEl.className='small'; msgEl.textContent='Invitation en cours…';
        try{
          const r = await fetch(`${API}/accounts/invite?account_id=${aid}`, {
            method:'POST', headers: authHeaders(),
            body: JSON.stringify({ email, role: invRole, appCode: APP })
          });
          const data = await r.json().catch(()=>({}));
          if (!r.ok){
            const errTxt = data && data.error ? data.error : ('Erreur ' + r.status);
            msgEl.className='small text-danger'; msgEl.textContent = 'Invitation impossible: ' + errTxt;
            return;
          }
          msgEl.className='small text-success'; msgEl.textContent = `Invité: ${data.invited} (${data.role}) • Sièges: ${data.seats_total}`;
          // refresh members
          try{
            const r2 = await fetch(`${API}/accounts/members/${APP}?account_id=${aid}`, { headers: authHeaders() });
            if (r2.ok){
              const d2 = await r2.json();
              const total = (d2.members||[]).length;
              const seats = (d2.members||[]).filter(m=>m.has_seat).length;
              setMembersBox(`Membres: ${total} • Sièges assignés: ${seats}`);
            }
          }catch{}
          if (emailEl) emailEl.value = '';
        }catch(e){
          if (msgEl){ msgEl.className='small text-danger'; msgEl.textContent = 'Invitation impossible (réseau).'; }
        }
      });
    }
  });
})();