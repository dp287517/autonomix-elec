// public/js/dashboard.js — clean build
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';

  // --- Apps and access policy
  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / etude explosion' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi' }
  ];
  // Minimum tiers per app (normalized 0..2 scale). 0=Free, 1=Personal, 2=Pro
  const ACCESS_POLICY = { 'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } } };

  // --- Helpers
  function tierName0(t){ return t===2?'Pro' : (t===1?'Personal':'Free'); }
  function fromServerTier(t){
    if (typeof t !== 'number') return 0;
    if (t>=1 && t<=3) return t-1;   // server 1..3 -> 0..2
    if (t>=0 && t<=2) return t;     // already 0..2
    return 0;
  }
  function serverLabel(t){ if (t===3) return 'Pro'; if (t===2) return 'Personal'; return 'Free'; }

  const token = ()=> localStorage.getItem('autonomix_token') || '';
  const authHeaders = ()=> ({ Authorization: 'Bearer ' + token() });
  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function setSelectedAccountId(v){ if (v!=null) localStorage.setItem(STORAGE_SEL, String(v)); }

  // --- Auth guard
  async function guard(){
    const t = token();
    if (!t){ location.href='login.html'; return null; }
    try{
      const r = await fetch(API + '/me', { headers: authHeaders() });
      if (!r.ok) throw new Error('me ' + r.status);
      const me = await r.json();
      const el = document.getElementById('userEmail');
      if (el) el.textContent = `${me.email || ''} • compte #${me.account_id ?? '—'} • ${me.role || ''}`;
      return me;
    }catch{
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href='login.html'; return null;
    }
  }

  // --- Accounts
  async function myAccounts(){
    const r = await fetch(API + '/accounts/mine', { headers: authHeaders() });
    if (!r.ok) throw new Error('accounts/mine ' + r.status);
    return r.json();
  }
  function renderAccountSwitcher(mine, current){
    const list = mine.accounts || mine;
    const sel = document.getElementById('accountSwitcher'); if (!sel) return;
    sel.innerHTML='';
    list.forEach(acc=>{
      const id = acc.id || acc.account_id;
      const name = acc.name || acc.account_name;
      const role = acc.role || 'member';
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = `${name} — ${role}`;
      if (String(id)===String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = ()=>{
      setSelectedAccountId(sel.value);
      const url = new URL(window.location.href);
      url.searchParams.set('account_id', sel.value);
      window.location.href = url.toString();
    };
  }

  // --- License
  async function fetchLicense(appCode, accountId){
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, { headers: authHeaders() });
      if (!r.ok) return { forbidden: r.status === 403 };
      return await r.json();
    }catch{ return null; }
  }

  // --- UI build
  function atexApps(){ return APPS.filter(a=>a.group==='ATEX'); }
  function minTierFor(appKey){ return ACCESS_POLICY.ATEX.tiers[appKey] ?? 0; }

  function renderAtexSubCards(accountId){
    const host = document.getElementById('atexSubCards'); if (!host) return;
    host.innerHTML = '';
    atexApps().forEach(app=>{
      const art = document.createElement('article');
      art.className = 'app-card';
      art.setAttribute('data-href', `${app.href}?account_id=${accountId}`);
      art.setAttribute('data-app', app.key);
      art.setAttribute('data-group', 'ATEX');
      art.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-bold">${app.title}</div>
            <div class="text-secondary small">${app.sub || ''}</div>
          </div>
          <span class="chip" data-chip="usage" data-app="${app.key}"></span>
        </div>`;
      host.appendChild(art);
    });
  }
  function wireMainAtexCard(){
    const main = document.getElementById('cardATEX');
    const sub  = document.getElementById('atexSubCards');
    if (!main || !sub) return;
    main.addEventListener('click', (e)=>{
      const manage = e.target && e.target.closest && e.target.closest('#manageAtexLink');
      if (manage) return;
      const hidden = getComputedStyle(sub).display === 'none' || sub.classList.contains('hidden') || sub.classList.contains('d-none');
      if (hidden){ sub.style.display='grid'; sub.classList.remove('hidden','d-none'); }
      else { sub.style.display='none'; sub.classList.add('hidden'); }
    });
  }
  function wireActions(accountId, role){
    const manageLink = document.getElementById('manageAtexLink');
    if (manageLink){
      const url = new URL(window.location.origin + '/subscription_atex.html');
      url.searchParams.set('account_id', accountId);
      manageLink.href = url.toString();
      manageLink.style.display = (role === 'owner') ? '' : 'none';
    }
    const createBtn = document.getElementById('createAccountBtn');
    if (createBtn) createBtn.onclick = createAccountFlow;
    const delBtn = document.getElementById('deleteAccountBtn');
    if (delBtn){
      delBtn.style.display = (role === 'owner') ? 'inline-block' : 'none';
      delBtn.onclick = ()=> deleteAccountFlow(accountId, role);
    }
  }

  function lockAllSubCards(msg){
    document.querySelectorAll('#atexSubCards article.app-card').forEach(node=>{
      node.classList.add('locked');
      const chip = node.querySelector('[data-chip="usage"]');
      if (chip) chip.textContent = msg || 'Acces verrouille';
      node.onclick = ()=> alert(msg || 'Acces verrouille');
    });
  }
  function applyLicensingGating(lic){
    if (!lic || lic.forbidden){ lockAllSubCards('Acces refuse a cet espace'); return; }
    const userTier0 = fromServerTier(typeof lic.tier==='number' ? lic.tier : 0);
    document.querySelectorAll('#atexSubCards article.app-card').forEach(node=>{
      const key = node.getAttribute('data-app');
      const need = minTierFor(key);
      const ok = userTier0 >= need;
      const chip = node.querySelector('[data-chip="usage"]');
      if (chip) chip.textContent = ok ? 'Disponible' : `Niveau requis: ${tierName0(need)}`;
      node.onclick = ok ? (()=> location.href = node.getAttribute('data-href')) : (()=>{
        const url = new URL(window.location.origin + '/subscription_atex.html');
        const acc = selectedAccountId();
        if (acc) url.searchParams.set('account_id', acc);
        location.href = url.toString();
      });
      node.classList.toggle('locked', !ok);
    });
  }

  async function createAccountFlow(){
    const name = prompt('Nom du nouvel espace de travail ?');
    if (!name || !name.trim()) return;
    const r = await fetch(API + '/accounts', {
      method:'POST', headers:{ 'Content-Type':'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name.trim() })
    });
    if (!r.ok){ const e = await r.json().catch(()=>({})); alert('Erreur creation: ' + (e && e.error ? e.error : r.status)); return; }
    const acc = await r.json();
    const newId = acc.account_id ?? acc.id;
    setSelectedAccountId(newId);
    // Rediriger directement vers la page Abonnement pour choisir un plan et éviter les 403
    const url = new URL(window.location.origin + '/subscription_atex.html');
    url.searchParams.set('account_id', newId);
    location.href = url.toString();
  }
  async function deleteAccountFlow(accountId, role){
    if (role !== 'owner'){ alert("Seul l'owner peut supprimer l'espace."); return; }
    if (!confirm("Supprimer cet espace ?")) return;
    const r = await fetch(API + '/accounts/' + accountId, { method:'DELETE', headers: authHeaders() });
    if (!r.ok){ const e = await r.json().catch(()=>({})); alert('Erreur suppression: ' + (e && e.error ? e.error : r.status)); return; }
    location.href = 'dashboard.html';
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const me = await guard(); if (!me) return;
    try{
      const mine = await myAccounts();
      const list = mine.accounts || mine;
      const fromURL = Number((new URLSearchParams(location.search)).get('account_id')) || null;
      const fallback = (list[0] ? (list[0].id || list[0].account_id) : null);
      const preferred = fromURL || selectedAccountId() || fallback;
      if (preferred) setSelectedAccountId(preferred);
      renderAccountSwitcher(mine, preferred);

      // Build cards first to avoid empty UI
      renderAtexSubCards(preferred); wireMainAtexCard();

      // Fetch license
      const lic = await fetchLicense('ATEX', preferred);
      const chipLic = document.getElementById('chipAtexLicense');
      if (lic && lic.forbidden){
        if (chipLic) chipLic.textContent = 'Acces refuse a cet espace';
      } else if (lic && typeof lic.tier === 'number'){
        if (chipLic) chipLic.textContent = 'Licence: ' + serverLabel( (lic.tier>=1 && lic.tier<=3) ? lic.tier : (lic.tier+1) );
      } else {
        if (chipLic) chipLic.textContent = 'Licence: Free';
      }

      // Hide cards that exceed allowed tier
      const userTier0 = fromServerTier(lic && typeof lic.tier==='number' ? lic.tier : 0);
      document.querySelectorAll('#atexSubCards article.app-card').forEach(node=>{
        const need = minTierFor(node.getAttribute('data-app'));
        if (userTier0 < need) node.remove();
      });
      // Re-apply gating / click handlers
      applyLicensingGating(lic);

      // Role-specific actions
      const role = (list.find(x => String(x.id||x.account_id)===String(preferred))?.role) || 'member';
      wireActions(preferred, role);
    }catch(e){
      console.error(e); alert('Impossible de charger vos espaces de travail.');
    }
  });
})();