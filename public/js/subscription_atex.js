
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

  // Placeholder paiement — à intégrer plus tard (Stripe/PayPal/etc.)
  async function startCheckout({ tier, accountId }){
    // TODO: lancer la création de session de paiement côté serveur, récupérer l'URL de checkout
    // et rediriger l'utilisateur dessus. Ici on simule juste un succès.
    console.debug('[paiement] startCheckout simulé', { tier, accountId });
    return { ok:true, redirectUrl: null };
  }

  async function me(){
    const r = await fetch(`${API}/me`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getCurrent(accId){
    const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accId}`, { headers: authHeaders() });
    if (r.status === 403) return { forbidden:true };
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getOwners(accId){
    const r = await fetch(`${API}/accounts/${accId}/owners`, { headers: authHeaders() });
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function getMembers(accId){
    const r = await fetch(`${API}/accounts/members/${APP}?account_id=${accId}`, { headers: authHeaders() });
    if (r.status === 403) return { forbidden:true };
    if (!r.ok) throw new Error('http '+r.status);
    return r.json();
  }
  async function setPlan(accId, tier){
    const pay = await startCheckout({ tier, accountId: accId });
    if (!pay.ok) { alert("Le paiement a échoué."); return; }

    const r = await fetch(`${API}/subscriptions/${APP}?account_id=${accId}`, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ tier })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      const msg = e?.error || ('Erreur HTTP '+r.status);
      if (r.status === 403) alert("Seul l'owner du compte peut modifier l'abonnement.");
      else if (r.status === 401) alert("Connecte-toi pour continuer.");
      else alert(msg); return;
    }
    await r.json();
    location.href = `dashboard.html?account_id=${accId}`;
  }
  async function invite(accId, email, role){
    const r = await fetch(`${API}/accounts/invite?account_id=${accId}`, {
      method:'POST', headers: authHeaders(), body: JSON.stringify({ email, role, appCode: APP })
    });
    if (r.status === 403) throw new Error("Seuls les owners ou admins peuvent inviter sur cet espace.");
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || ('Erreur HTTP '+r.status)); }
    return r.json();
  }

  function ownersText(owners){
    if (!owners || !owners.length) return 'Owner inconnu';
    if (owners.length === 1) return `Owner : ${owners[0].email}`;
    return 'Owners : ' + owners.map(o => o.email).join(', ');
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

  function disableCurrentPlanButtons(curTier){
    document.querySelectorAll('[data-plan]').forEach(btn=>{
      const t = +btn.getAttribute('data-plan');
      if (t === curTier){
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.textContent = 'Plan actuel';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const accId = accountContext();
    if (!accId){ document.getElementById('currentPlan').textContent = 'Sélectionne ou crée un espace depuis le dashboard.'; return; }

    let m = null, sub = null;
    try { m = await me(); } catch {}

    try {
      sub = await getCurrent(accId);
      if (sub?.forbidden){
        const o = await getOwners(accId).catch(()=>({owners:[]}));
        const ownerHint = document.getElementById('ownerHint');
        ownerHint.textContent = ownersText(o.owners);
        document.getElementById('currentPlan').textContent = `Tu n'as pas accès aux détails de l'abonnement pour cet espace.`;
        document.querySelectorAll('[data-plan]').forEach(b => { b.disabled = true; b.classList.add('disabled'); });
      } else {
        const ownerHint = document.getElementById('ownerHint');
        ownerHint.textContent = (m?.role === 'owner')
          ? `Tu es owner de l’espace #${accId}. Tu peux changer le type d’abonnement.`
          : `Tu es ${m?.role || 'membre'} sur l’espace #${accId}. ${ownersText(sub.owners)}.`;

        document.getElementById('currentPlan').textContent =
          `Compte #${accId} • Licence actuelle : ${tierLabel(sub.tier)} (scope: ${sub.scope || 'account'}) • sièges: ${sub.seats_total ?? 1}`;

        if (m?.role !== 'owner') {
          document.querySelectorAll('[data-plan]').forEach(btn => { btn.disabled = true; btn.classList.add('disabled'); });
        }
        disableCurrentPlanButtons(sub.tier);
      }
    } catch {
      document.getElementById('currentPlan').textContent = `Licence actuelle : inconnue (connecte-toi)`;
    }

    try{
      const data = await getMembers(accId);
      if (data?.forbidden){
        const box = document.getElementById('membersBox');
        if (box) box.textContent = "Tu n'as pas les droits pour voir les membres de cet espace.";
      }else{
        renderMembers(document.getElementById('membersBox'), data);
      }
    }catch{
      const box = document.getElementById('membersBox');
      if (box) box.textContent = 'Impossible de charger les membres.';
    }

    document.querySelectorAll('[data-plan]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const t = +btn.getAttribute('data-plan');
        const currentTier = sub?.tier ?? -1;
        if (t === currentTier){ return; }
        await setPlan(accId, t);
      });
    });

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
        if (!data?.forbidden) renderMembers(document.getElementById('membersBox'), data);
      }catch(e){
        msg.textContent = e.message;
      }
    });
  });
})();
