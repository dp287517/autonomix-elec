(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const APP = 'ATEX';

  function token(){ return localStorage.getItem('autonomix_token') || ''; }
  function authHeaders(){ return { Authorization: `Bearer ${token()}`, 'Content-Type':'application/json' }; }

  async function getCurrent(){
    const r = await fetch(`${API}/subscriptions/${APP}`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json(); // { app, tier, scope, status, seats_total }
  }
  async function getMembers(){
    const r = await fetch(`${API}/accounts/members/${APP}`, { headers: authHeaders() });
    if (!r.ok) throw new Error('http '+r.status);
    return r.json(); // { app, members: [...] }
  }
  function tierLabel(t){ return t===2?'Pro': t===1?'Personal': 'Free'; }

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

  async function invite(email, role){
    const r = await fetch(`${API}/accounts/invite`, {
      method:'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, role, appCode: APP })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(e?.error || ('Erreur HTTP '+r.status));
    }
    return r.json();
  }

  function renderMembers(box, data){
    if (!data?.members?.length) { box.textContent = 'Aucun membre.'; return; }
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled mb-0';
    data.members.forEach(m=>{
      const li = document.createElement('li');
      li.innerHTML = `<strong>${m.email}</strong> — ${m.role} ${m.has_seat?'• a un siège':'• sans siège'}`;
      ul.appendChild(li);
    });
    box.innerHTML = '';
    box.appendChild(ul);
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    try {
      const cur = await getCurrent();
      document.getElementById('currentPlan').textContent =
        `Licence actuelle : ${tierLabel(cur.tier)} (scope: ${cur.scope || 'account'}) • sièges: ${cur.seats_total ?? 1}`;
    } catch {
      document.getElementById('currentPlan').textContent = `Licence actuelle : inconnue (connecte-toi)`;
    }

    document.querySelectorAll('[data-plan]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const t = +btn.getAttribute('data-plan');
        await setPlan(t);
      });
    });

    try{
      const data = await getMembers();
      renderMembers(document.getElementById('membersBox'), data);
    }catch{
      document.getElementById('membersBox').textContent = 'Impossible de charger les membres (droits owner/admin requis).';
    }

    document.getElementById('inviteBtn').addEventListener('click', async ()=>{
      const email = document.getElementById('inviteEmail').value.trim();
      const role  = document.getElementById('inviteRole').value;
      const msg = document.getElementById('inviteMsg');
      if(!email){ msg.textContent = 'Indique un email.'; return; }
      msg.textContent = 'Invitation en cours…';
      try{
        const res = await invite(email, role);
        msg.textContent = `Invitation envoyée à ${res.invited}. Sièges: ${res.seats_total}`;
        const data = await getMembers();
        renderMembers(document.getElementById('membersBox'), data);
      }catch(e){
        msg.textContent = 'Erreur: ' + e.message;
      }
    });
  });
})();
