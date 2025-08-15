
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
    if (!mine || !mine.accounts) return null;
    for (var i=0;i<mine.accounts.length;i++){
      if (String(mine.accounts[i].id) === String(accId)) return mine.accounts[i].role;
    }
    return null;
  }

  async function startCheckout(opts){ return { ok:true, redirectUrl:null }; } // stub paiement

  async function getCurrent(accId){
    const r = await fetch(API + '/subscriptions/' + APP + '?account_id=' + accId, { headers: authHeaders() });
    if (r.status === 403) return { forbidden:true };
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getOwners(accId){
    const r = await fetch(API + '/accounts/' + accId + '/owners', { headers: authHeaders() });
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getMembers(accId){
    const r = await fetch(API + '/accounts/members/' + APP + '?account_id=' + accId, { headers: authHeaders() });
    if (r.status === 403) return { forbidden:true };
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function setPlan(accId, tier){
    const pay = await startCheckout({ tier: tier, accountId: accId });
    if (!pay.ok) { alert('Le paiement a echoue.'); return; }
    const r = await fetch(API + '/subscriptions/' + APP + '?account_id=' + accId, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ tier: tier })
    });
    if (!r.ok) {
      const e = await r.json().catch(function(){return {};});
      const msg = (e && e.error) ? e.error : ('Erreur HTTP ' + r.status);
      if (r.status === 403) alert("Seul l'owner du compte peut modifier l'abonnement.");
      else if (r.status === 401) alert('Connecte-toi pour continuer.');
      else alert(msg); return;
    }
    await r.json();
    var url = new URL(window.location.origin + '/dashboard.html');
    url.searchParams.set('account_id', accId);
    location.href = url.toString();
  }
  async function invite(accId, email, role){
    const r = await fetch(API + '/accounts/invite?account_id=' + accId, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ email: email, role: role, appCode: APP })
    });
    if (r.status === 403) throw new Error('Seuls les owners ou admins peuvent inviter sur cet espace.');
    if (!r.ok) { const e = await r.json().catch(function(){return {};}); throw new Error((e && e.error) ? e.error : ('Erreur HTTP ' + r.status)); }
    return r.json();
  }

  function ownersText(owners){
    if (!owners || !owners.length) return 'Owner inconnu';
    if (owners.length === 1) return 'Owner : ' + owners[0].email;
    var arr = []; for (var i=0;i<owners.length;i++){ arr.push(owners[i].email); }
    return 'Owners : ' + arr.join(', ');
  }
  function renderMembers(box, data){
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

  document.addEventListener('DOMContentLoaded', async function(){
    const accId = accountContext();
    if (!accId){ document.getElementById('currentPlan').textContent = 'Selectionne ou cree un espace depuis le dashboard.'; return; }

    let mine = null, sub = null, role = null;
    try { mine = await myAccounts(); role = roleForAccount(mine, accId); } catch(e){}

    try {
      sub = await getCurrent(accId);
      if (sub && sub.forbidden){
        const o = await getOwners(accId).catch(function(){return { owners: [] };});
        document.getElementById('ownerHint').textContent = ownersText(o.owners);
        document.getElementById('currentPlan').textContent = "Tu n'as pas acces aux details de l'abonnement pour cet espace.";
        document.querySelectorAll('[data-plan]').forEach(function(b){ b.disabled = true; b.classList.add('disabled'); });
      } else {
        const hint = document.getElementById('ownerHint');
        hint.textContent = (role === 'owner')
          ? ('Tu es owner de l espace #' + accId + '. Tu peux changer le type d abonnement.')
          : ('Ton role sur l espace #' + accId + ' : ' + (role || 'membre') + '. ' + ownersText(sub.owners) + '.');

        document.getElementById('currentPlan').textContent =
          'Compte #' + accId + ' • Licence actuelle : ' + tierLabel(sub.tier) + ' (scope: ' + (sub.scope || 'account') + ') • sieges: ' + (sub.seats_total != null ? sub.seats_total : 1);

        if (role !== 'owner') {
          document.querySelectorAll('[data-plan]').forEach(function(btn){ btn.disabled = true; btn.classList.add('disabled'); });
        }
        disableCurrentPlanButtons(sub.tier);
      }
    } catch(e){
      document.getElementById('currentPlan').textContent = 'Licence actuelle : inconnue (connecte-toi)';
    }

    try{
      const data = await getMembers(accId);
      if (data && data.forbidden){
        const box = document.getElementById('membersBox');
        if (box) box.textContent = "Tu n'as pas les droits pour voir les membres de cet espace.";
      }else{
        renderMembers(document.getElementById('membersBox'), data);
      }
    }catch(e){
      const box = document.getElementById('membersBox');
      if (box) box.textContent = 'Impossible de charger les membres.';
    }

    document.querySelectorAll('[data-plan]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        const t = +btn.getAttribute('data-plan');
        const currentTier = sub && typeof sub.tier==='number' ? sub.tier : -1;
        if (t === currentTier){ return; }
        await setPlan(accId, t);
      });
    });

    document.getElementById('inviteBtn').addEventListener('click', async function(){
      const email = document.getElementById('inviteEmail').value.trim();
      const roleSel  = document.getElementById('inviteRole').value;
      const msg = document.getElementById('inviteMsg');
      if(!email){ msg.textContent = 'Indique un email.'; return; }
      msg.textContent = 'Invitation en cours...';
      try{
        const res = await invite(accId, email, roleSel);
        msg.textContent = 'Invitation envoyee a ' + res.invited + '. Sieges: ' + res.seats_total;
        const data = await getMembers(accId);
        if (data && !data.forbidden) renderMembers(document.getElementById('membersBox'), data);
      }catch(e){
        msg.textContent = e.message;
      }
    });
  });
})();
