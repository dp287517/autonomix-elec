// public/js/subscription_atex.js — plans + invite + create workspace
(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APP = 'ATEX';

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function accountIdFromURL(){ return Number(new URLSearchParams(location.search).get('account_id')) || null; }
  function accountContext(){ return accountIdFromURL() || selectedAccountId(); }
  function token(){ return localStorage.getItem('autonomix_token') || ''; }
  function authHeaders(){ return { Authorization: `Bearer ${token()}`, 'Content-Type':'application/json' }; }
  function tierLabel(t){ return t===2?'Pro': t===1?'Personal': 'Free'; }

  async function getCurrent(accId){
    const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accId}`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getMembers(accId){
    const r = await fetch(`${API}/accounts/members/${APP}?account_id=${accId}`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function setPlan(accId, tier){
    const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accId}`, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ tier })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      const msg = e?.error || ('Erreur HTTP '+r.status);
      if (r.status === 403) alert("Seuls les owners/admins du compte ciblé peuvent modifier l'abonnement.");
      else if (r.status === 401) alert("Connecte-toi pour continuer.");
      else alert(msg); return;
    }
    await r.json();
    location.href = `dashboard.html`;
  }
  async function invite(accId, email, role){
    const r = await fetch(`${API}/accounts/invite?account_id=${accId}`, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ email, role, appCode: APP })
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || ('Erreur HTTP '+r.status)); }
    return r.json();
  }
  async function createAccount(name){
    const r = await fetch(`${API}/accounts`, { method:'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || ('Erreur HTTP '+r.status)); }
    return r.json(); // {id, name, role:'owner'}
  }

  function renderMembers(box, data){
    if (!data?.members?.length) { box.textContent = 'Aucun membre.'; return; }
    const ul = document.createElement('ul'); ul.className = 'list-unstyled mb-0';
    data.members.forEach(m=>{
      const li = document.createElement('li');
      li.innerHTML = `<strong>${m.email}</strong> — ${m.role} ${m.has_seat?'• a un siège':'• sans siège'}`;
      ul.appendChild(li);
    }); box.innerHTML=''; box.appendChild(ul);
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const accId = accountContext();
    if (!accId){ document.getElementById('currentPlan').textContent = 'Sélectionne un espace depuis le dashboard.'; }

    // Load current plan & members (if a context exists)
    if (accId){
      try {
        const cur = await getCurrent(accId);
        document.getElementById('currentPlan').textContent =
          `Compte #${accId} • Licence actuelle : ${tierLabel(cur.tier)} (scope: ${cur.scope || 'account'}) • sièges: ${cur.seats_total ?? 1}`;
      } catch {
        document.getElementById('currentPlan').textContent = `Licence actuelle : inconnue (connecte-toi)`;
      }
      try{
        const data = await getMembers(accId);
        renderMembers(document.getElementById('membersBox'), data);
      }catch{
        document.getElementById('membersBox').textContent = 'Impossible de charger les membres (droits owner/admin requis).';
      }
    }

    // Choose plan buttons
    document.querySelectorAll('[data-plan]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const t = +btn.getAttribute('data-plan');
        if (!accId){ alert('Choisis ou crée un espace avant de sélectionner un plan.'); return; }
        await setPlan(accId, t);
      });
    });

    // Invite flow
    document.getElementById('inviteBtn').addEventListener('click', async ()=>{
      const email = document.getElementById('inviteEmail').value.trim();
      const role  = document.getElementById('inviteRole').value;
      const msg = document.getElementById('inviteMsg');
      if(!email){ msg.textContent = 'Indique un email.'; return; }
      msg.textContent = 'Invitation en cours…';
      try{
        const res = await invite(accId, email, role);
        msg.textContent = `Invitation envoyée à ${res.invited}. Sièges: ${res.seats_total}`;
        const data = await getMembers(accId);
        renderMembers(document.getElementById('membersBox'), data);
      }catch(e){
        msg.textContent = 'Erreur: ' + e.message;
      }
    });

    // Create new workspace
    const createBtn = document.getElementById('createAccountBtn');
    const nameInput = document.getElementById('newAccountName');
    const copyChk = document.getElementById('copyPlan');
    const createMsg = document.getElementById('createMsg');

    createBtn.addEventListener('click', async ()=>{
      const name = (nameInput.value || '').trim();
      if (!name) { createMsg.textContent = 'Donne un nom à ton espace.'; return; }
      createMsg.textContent = 'Création de l’espace…';
      try{
        const acc = await createAccount(name);
        // persist selection
        localStorage.setItem(STORAGE_SEL, String(acc.id));
        createMsg.textContent = `Espace créé: ${acc.name} (#${acc.id}).`;
        if (copyChk.checked && accId){
          try{
            const cur = await getCurrent(accId);
            await setPlan(acc.id, cur.tier || 0);
          }catch{ /* ignore */ }
        }
        location.href = 'dashboard.html';
      }catch(e){
        createMsg.textContent = 'Erreur: ' + e.message;
      }
    });
  });
})();
