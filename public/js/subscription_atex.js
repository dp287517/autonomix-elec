// public/js/subscription_atex.js — v6 (robuste 403 / owner / boutons)
(function(){
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const ls={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};
  const token = ()=> ls.get('autonomix_token') || '';
  const logout=()=>{ ls.del('autonomix_token'); ls.del('autonomix_user'); location.href='login.html'; };
  async function api(path,opts={}){
    const r=await fetch(path,{...opts,headers:{...(opts.headers||{}),'Authorization':'Bearer '+token(),'Content-Type':'application/json'}});
    if(r.status===401){ logout(); throw new Error('unauthenticated'); }
    return r;
  }
  function qid(){ return new URLSearchParams(location.search).get('account_id'); }
  function setStatus(t){ const el=$('#subStatus'); if(el) el.textContent=t; }

  function enableButtons(tier, isOwner){
    const map = { 1:'#btn-tier-free', 2:'#btn-tier-personal', 3:'#btn-tier-pro' };
    Object.entries(map).forEach(([t,sel])=>{
      const btn=$(sel); if(!btn) return;
      const current = Number(tier)===Number(t);
      btn.disabled = current || !isOwner;
      btn.classList.toggle('disabled', btn.disabled);
      btn.title = current ? 'Déjà actif' : (isOwner? '' : "Seul l'owner peut modifier l'abonnement");
    });
  }

  function showOwnerEmails(emails){
    const el = $('#ownerEmails');
    if (!el) return;
    el.innerHTML = '';
    if (!emails || emails.length===0) { el.textContent = 'Owner inconnu'; return; }
    emails.forEach(m=>{
      const li = document.createElement('div'); li.textContent = m; el.appendChild(li);
    });
  }

  async function chooseTier(tier){
    const aid = qid();
    const r = await api(`/api/subscriptions/ATEX/choose?account_id=${encodeURIComponent(aid)}`, { method:'POST', body: JSON.stringify({ tier:Number(tier) }) });
    if (!r.ok){ const err=await r.json().catch(()=>({})); alert('Choix impossible: ' + (err.error || r.status)); return; }
    location.href = `dashboard.html?account_id=${encodeURIComponent(aid)}`;
  }

  async function init(){
    const aid = qid();
    if (!aid){ setStatus('Espace introuvable'); return; }

    const mine = await api('/api/accounts/mine'); const accounts = await mine.json();
    const acc = accounts.find(a=> String(a.account_id)===String(aid));
    if (!acc){ setStatus("Accès refusé à cet espace."); return; }
    const isOwner = acc.role === 'owner';

    try {
      const o = await api(`/api/accounts/${encodeURIComponent(aid)}/owners`);
      const arr = await o.json();
      showOwnerEmails(arr);
    } catch {}

    let tier = 0; let status = 'no_subscription';
    try {
      const r = await api(`/api/subscriptions/ATEX?account_id=${encodeURIComponent(aid)}`);
      if (r.ok){ const s = await r.json(); tier = Number(s.tier || 0); status = s.status || 'active'; }
    } catch {}

    setStatus(`Abonnement — Suite ATEX`);
    enableButtons(tier, isOwner);

    $('#btn-tier-free')     && $('#btn-tier-free')    .addEventListener('click',()=>chooseTier(1));
    $('#btn-tier-personal') && $('#btn-tier-personal').addEventListener('click',()=>chooseTier(2));
    $('#btn-tier-pro')      && $('#btn-tier-pro')     .addEventListener('click',()=>chooseTier(3));
  }

  document.addEventListener('DOMContentLoaded', init);
})();