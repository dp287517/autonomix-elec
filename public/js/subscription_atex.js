// public/js/subscription_atex.js — clean build with pricing & members list
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  // Pricing per seat (server tier 1..3)
  const PRICE = { 1: 0, 2: 29, 3: 39 };

  // -------- Helpers
  const token = ()=> localStorage.getItem('autonomix_token') || '';
  const authHeaders = ()=> ({ Authorization: 'Bearer ' + token(), 'Content-Type':'application/json' });
  const urlAccId = ()=> { try { return Number(new URLSearchParams(location.search).get('account_id')) || null; } catch { return null; } };
  const selectedAccId = ()=> {
    const u = urlAccId();
    if (u){ try{ localStorage.setItem(STORAGE_SEL, String(u)); }catch{} return u; }
    try{ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }catch{ return null; }
  };
  const labelFromServerTier = (st)=> (st===3 ? 'Pro' : (st===2 ? 'Personal' : 'Free'));
  const toServerTierFromUi = (ui)=> (ui>=0 && ui<=2)? (ui+1) : 1; // 0..2 -> 1..3

  function setOwnerHint(txt){ const el=document.getElementById('ownerHint'); if(el) el.textContent = txt; }
  function setCurrentPlan(txt){ const el=document.getElementById('currentPlan'); if(el) el.textContent = txt; }
  function setMembersBox(html){ const el=document.getElementById('membersBox'); if(el) el.innerHTML = html; }

  // --- Data fetchers
  async function owners(accountId){
    try{
      const r = await fetch(`${API}/accounts/${accountId}/owners`, { headers: authHeaders() });
      if (!r.ok) return [];
      return await r.json();
    }catch{ return []; }
  }
  async function currentSubscription(accountId){
    // Prefer /licenses for tier (more authoritative), /subscriptions for seats_total
    let tier = 1, seats = 1;
    try{
      const r = await fetch(`${API}/licenses/${APP}?account_id=${accountId}`, { headers: authHeaders() });
      if (r.ok){
        const lic = await r.json();
        // tolerate 0..2 or 1..3
        const t = Number(lic.tier||0); tier = (t>=1 && t<=3) ? t : (t+1);
      }
    }catch{}
    try{
      const r2 = await fetch(`${API}/subscriptions/${APP}?account_id=${accountId}`, { headers: authHeaders() });
      if (r2.ok){
        const s = await r2.json();
        const t = Number(s.tier||0);
        tier = (t>=1 && t<=3) ? t : (t+1);
        seats = Number(s.seats_total ?? 1) || 1;
      }
    }catch{}
    return { tier, seats };
  }
  async function fetchMembers(appCode, accountId){
    try{
      const r = await fetch(`${API}/accounts/members/${appCode}?account_id=${accountId}`, { headers: authHeaders() });
      if (!r.ok) return { members: null, status: r.status };
      return await r.json();
    }catch{ return { members: null, status: 0 }; }
  }

  // --- UI behaviors
  function armButtons(currentServerTier, isOwner){
    const btns = Array.from(document.querySelectorAll('button[data-plan]'));
    btns.forEach(btn => {
      const ui = Number(btn.getAttribute('data-plan')); // 0,1,2
      const srv = toServerTierFromUi(ui);               // 1,2,3
      const isCurrent = (srv === currentServerTier);
      btn.disabled = isCurrent || !isOwner;
      btn.classList.toggle('disabled', btn.disabled);
      btn.title = isCurrent ? 'Plan actuel' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
      btn.onclick = ()=> choose(srv);
      // Show price on button
      const price = PRICE[srv] ?? 0;
      if (!btn._priced){
        btn.textContent = btn.textContent + ` — ${price} €/mois /utilisateur`;
        btn._priced = true;
      }
    });
  }
  async function choose(serverTier){
    const aid = selectedAccId(); if (!aid) return;
    try{
      const r = await fetch(`${API}/subscriptions/${APP}/choose?account_id=${aid}`, {
        method:'POST', headers: authHeaders(), body: JSON.stringify({ tier: serverTier })
      });
      let data = {}; try{ data = await r.json(); }catch{}
      if (!r.ok){
        const tech = (data && data.error) ? data.error : ('HTTP ' + r.status);
        alert('Changement de plan refusé: ' + tech); return;
      }
      // After change, refresh in-place to show updated tier & pricing
      location.reload();
    }catch{ alert('Changement de plan impossible (réseau).'); }
  }

  function renderCost(tier, seats){
    const price = PRICE[tier] ?? 0;
    const total = price * (seats || 0);
    const el = document.getElementById('currentCost');
    if (el) el.textContent = `Coût actuel : ${total} € / mois (${price} € x ${seats} utilisateur${seats>1?'s':''})`;
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const aid = selectedAccId();
    if (!aid){ setCurrentPlan('Aucun espace sélectionné'); return; }

    // Owners
    const own = await owners(aid);
    setOwnerHint( own?.length ? ('Owner(s) : ' + own.map(m=>m.email||m).join(', ')) : 'Owner inconnu' );

    // Determine role
    let isOwner = false;
    try{
      const rMine = await fetch(`${API}/accounts/mine`, { headers: authHeaders() });
      if (rMine.ok){
        const mine = await rMine.json();
        const arr = mine.accounts || mine;
        const row = (arr||[]).find(x=> String(x.id||x.account_id) === String(aid));
        isOwner = !!(row && row.role === 'owner');
      }
    }catch{}

    // Current subscription (tier + seats)
    const sub = await currentSubscription(aid);
    setCurrentPlan('Licence actuelle : ' + labelFromServerTier(sub.tier));
    armButtons(sub.tier, isOwner);
    renderCost(sub.tier, sub.seats);

    // Members & seats — show list + counts
    const membersRes = await fetchMembers(APP, aid);
    if (membersRes && membersRes.members){
      const members = membersRes.members;
      const emails = members.map(m => `${m.email} ${m.has_seat ? '• siège' : ''}`).join('<br>');
      const seatsAssigned = members.filter(m=>m.has_seat).length;
      setMembersBox(`Membres: ${members.length} • Sièges assignés: ${seatsAssigned}<br><div class="mt-2">${emails}</div>`);
    } else if (membersRes && membersRes.status === 403){
      setMembersBox('Accès restreint (owner/admin requis).');
    } else {
      setMembersBox('Erreur chargement des membres.');
    }

    // Invite wiring (already works — keep, and also recalc cost after invite)
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
            method:'POST', headers: authHeaders(), body: JSON.stringify({ email, role: invRole, appCode: APP })
          });
          const data = await r.json().catch(()=>({}));
          if (!r.ok){ const err = data && data.error ? data.error : ('Erreur ' + r.status);
            msgEl.className='small text-danger'; msgEl.textContent = 'Invitation impossible: ' + err; return; }
          msgEl.className='small text-success'; msgEl.textContent = `Invité: ${data.invited} (${data.role}) • Sièges: ${data.seats_total}`;
          // refresh members + cost
          const membersRes2 = await fetchMembers(APP, aid);
          if (membersRes2 && membersRes2.members){
            const members = membersRes2.members;
            const emails = members.map(m => `${m.email} ${m.has_seat ? '• siège' : ''}`).join('<br>');
            const seatsAssigned = members.filter(m=>m.has_seat).length;
            setMembersBox(`Membres: ${members.length} • Sièges assignés: ${seatsAssigned}<br><div class="mt-2">${emails}</div>`);
          }
          // Refresh subscription to get latest seats_total
          const sub2 = await currentSubscription(aid);
          renderCost(sub2.tier, sub2.seats);
          if (emailEl) emailEl.value='';
        }catch{
          if (msgEl){ msgEl.className='small text-danger'; msgEl.textContent='Invitation impossible (réseau).'; }
        }
      });
    }
  });
})();