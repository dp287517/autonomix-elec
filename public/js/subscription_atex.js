(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function accountIdFromURL(){ return Number(new URLSearchParams(location.search).get('account_id')) || null; }
  function accountContext(){ return accountIdFromURL() || selectedAccountId(); }
  function token(){ return localStorage.getItem('autonomix_token') || ''; }
  function authHeaders(){ return { Authorization: 'Bearer ' + token(), 'Content-Type':'application/json' }; }
  function tierLabel(t){ return t===2?'Pro': (t===1?'Personal': 'Free'); }

  async function myAccounts(){
    const r = await fetch(API + '/accounts/mine', { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  function roleForAccount(mine, accId){
    const list = mine.accounts || mine;
    if (!list) return null;
    for (var i=0;i<list.length;i++){
      const id = list[i].id || list[i].account_id;
      if (String(id) === String(accId)) return list[i].role;
    }
    return null;
  }

  async function startCheckout(opts){ return { ok:true, redirectUrl:null }; } // stub paiement

  async function getCurrent(accId){
    // Essai #1: route historique (lecture tier)
    try {
      const r = await fetch(API + '/subscriptions/' + APP + '?account_id=' + accId, { headers: authHeaders() });
      if (r.status === 403) return { forbidden:true };
      if (r.ok) return r.json();
    } catch {}
    // Essai #2: fallback via /licenses (lecture tier minimaliste)
    try {
      const r2 = await fetch(API + '/licenses/' + APP + '?account_id=' + accId, { headers: authHeaders() });
      if (r2.status === 403) return { forbidden:true };
      if (r2.ok){ const lic = await r2.json(); return { tier: (lic && typeof lic.tier==='number')? lic.tier : 0, status:'active', scope:'account' }; }
    } catch {}
    return { tier:0, status:'none', scope:'account' };
  }
  async function getOwners(accId){
    try{
      const r = await fetch(API + '/accounts/' + accId + '/owners', { headers: authHeaders() });
      if(!r.ok) return [];
      return r.json();
    }catch{ return []; }
  }
  function ownersText(owners){
    if (!owners || !owners.length) return 'Owner inconnu';
    const arr = [];
    for (var i=0;i<owners.length;i++){
      if (typeof owners[i] === 'string') arr.push(owners[i]);
      else if (owners[i] && owners[i].email) arr.push(owners[i].email);
    }
    return arr.length ? ('Owner' + (arr.length>1?'s':'') + ' : ' + arr.join(', ')) : 'Owner inconnu';
  }
  async function getMembers(accId){
    try{
      const r = await fetch(API + '/accounts/members/' + APP + '?account_id=' + accId, { headers: authHeaders() });
      if (r.status === 403) return { forbidden:true };
      if (!r.ok) return { members: [] };
      return r.json();
    }catch{ return { members: [] }; }
  }
  function renderMembers(box, data){
    if (!box) return;
    if (!data || !data.members || !data.members.length) { box.textContent = 'Aucun membre.'; return; }
    const ul = document.createElement('ul'); ul.className = 'list-unstyled mb-0';
    data.members.forEach(function(m){
      const li = document.createElement('li');
      li.innerHTML = '<strong>' + m.email + '</strong> — ' + m.role + (m.has_seat?' • a un siege':' • sans siege');
      ul.appendChild(li);
    }); box.innerHTML=''; box.appendChild(ul);
  }
  function disableCurrentPlanButtons(curTier){
    document.querySelectorAll('[data-plan]').forEach(function(btn){
      const t = +btn.getAttribute('data-plan');
      if (t === curTier){
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.textContent = 'Plan actuel';
      }
    });
  }

  async function setPlan(accId, tier){
    const pay = await startCheckout({ tier: tier, accountId: accId });
    if (!pay.ok) { alert('Le paiement a echoue.'); return; }
    // Essai #1: endpoint "choose" moderne
    let r;
    try {
      r = await fetch(API + '/subscriptions/' + APP + '/choose?account_id=' + accId, {
        method:'POST', headers: authHeaders(), body: JSON.stringify({ tier: tier })
      });
      if (r.status === 404) throw new Error('not_found');
    } catch {
      // Essai #2: endpoint historique (POST direct)
      r = await fetch(API + '/subscriptions/' + APP + '?account_id=' + accId, {
        method:'POST', headers: authHeaders(), body: JSON.stringify({ tier: tier })
      });
    }
    if (!r.ok) {
      let msg = 'Erreur HTTP ' + r.status;
      try{ const e = await r.json(); if (e && e.error) msg = e.error; }catch{}
      if (r.status === 403) alert("Seul l'owner du compte peut modifier l'abonnement.");
      else if (r.status === 401) alert('Connecte-toi pour continuer.');
      else alert(msg);
      return;
    }
    await r.json();
    var url = new URL(window.location.origin + '/dashboard.html');
    url.searchParams.set('account_id', accId);
    location.href = url.toString();
  }

  document.addEventListener('DOMContentLoaded', async function(){
    const accId = accountContext();
    if (!accId){ document.getElementById('currentPlan').textContent = 'Selectionne ou cree un espace depuis le dashboard.'; return; }

    let mine=null, role=null, sub=null, owners=[];
    try { mine = await myAccounts(); role = roleForAccount(mine, accId); } catch(e){}

    // Owners (toujours)
    owners = await getOwners(accId);
    const ownerHint = document.getElementById('ownerHint');
    if (ownerHint) ownerHint.textContent = ownersText(owners);

    // Subscription
    sub = await getCurrent(accId);
    const planBox = document.getElementById('currentPlan');
    if (sub && sub.forbidden){
      if (planBox){
        planBox.textContent = "Tu n'as pas acces aux details de l'abonnement pour cet espace.";
      }
      document.querySelectorAll('[data-plan]').forEach(function(b){ b.disabled = true; b.classList.add('disabled'); });
    } else {
      if (planBox){
        planBox.textContent = 'Compte #' + accId + ' • Licence actuelle : ' + tierLabel(sub.tier) +
          ' (scope: ' + (sub.scope || 'account') + ') • sieges: ' + (sub.seats_total != null ? sub.seats_total : 1);
      }
      if (role !== 'owner') {
        document.querySelectorAll('[data-plan]').forEach(function(btn){ btn.disabled = true; btn.classList.add('disabled'); });
      }
      disableCurrentPlanButtons(sub.tier || 0);
    }

    // Members (best effort)
    try{
      const data = await getMembers(accId);
      renderMembers(document.getElementById('membersBox'), data);
    }catch{}

    // Clicks plans
    document.querySelectorAll('[data-plan]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        const t = +btn.getAttribute('data-plan');
        const currentTier = sub && typeof sub.tier==='number' ? sub.tier : -1;
        if (t === currentTier){ return; }
        await setPlan(accId, t);
      });
    });
  });
})();
