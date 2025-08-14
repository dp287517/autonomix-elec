
// public/js/dashboard.js — multi-account + gating + create/delete workspace + robust errors
(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';

  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des équipements, inspections, conformité' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / étude explosion' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi' },
  ];
  const ACCESS_POLICY = { 'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } } };
  const tierName = (t)=> t===2?'Pro': t===1?'Personal':'Free';
  function atexApps(){ return APPS.filter(a => a.group==='ATEX'); }
  function isAllowed(appKey, suiteCode, userTier){ const need = ACCESS_POLICY[suiteCode]?.tiers?.[appKey] ?? 0; return userTier >= need; }

  // Auth
  let currentUser = null;
  async function guard() {
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) { location.href = 'login.html'; return; }
    try{
      const r = await fetch(`${API}/me`, { headers:{ Authorization:`Bearer ${token}` } });
      if(!r.ok) throw new Error(`me ${r.status}`);
      const data = await r.json();
      currentUser = { email: data.email, account_id: data.account_id, role: data.role };
      const emailEl = document.getElementById('userEmail');
      if (emailEl) emailEl.textContent = `${currentUser.email || ''} • compte #${currentUser.account_id ?? '—'} • ${currentUser.role || ''}`;
    }catch{
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    }
  }
  function setupLogout(){
    const btn = document.getElementById('logoutBtn');
    if(btn) btn.addEventListener('click', ()=>{
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    });
  }

  // Multi-compte
  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function setSelectedAccountId(v){ localStorage.setItem(STORAGE_SEL, String(v)); }
  async function myAccounts(){
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(`${API}/accounts/mine`, { headers: { Authorization:`Bearer ${token}` } });
    if(!r.ok){
      if (r.status === 401) { localStorage.removeItem('autonomix_token'); location.href = 'login.html'; }
      if (r.status === 403) { alert("Tu n'as pas les droits pour lister les espaces (403)."); }
      throw new Error('accounts/mine ' + r.status);
    }
    return r.json();
  }
  async function fetchLicense(appCode, accountId){
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token || !accountId) return null;
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, { headers: { Authorization:`Bearer ${token}` } });
      if(!r.ok) return null; return await r.json();
    }catch{ return null; }
  }
  async function createAccountFlow(){
    const name = prompt('Nom du nouvel espace de travail ?');
    if (!name || !name.trim()) return;
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(`${API}/accounts`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ name: name.trim() }) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Erreur création: ' + (e?.error || r.status)); return; }
    const acc = await r.json();
    setSelectedAccountId(acc.id);
    alert(`Espace créé: ${acc.name} (#${acc.id}). Choisis maintenant un abonnement (bouton "Gérer l’abonnement").`);
    location.href = `subscription_atex.html?account_id=${acc.id}`;
  }
  async function deleteAccountFlow(accountId, role){
    if (role !== 'owner') { alert("Seul l'owner peut supprimer l'espace."); return; }
    if (!confirm("⚠️ Supprimer cet espace ? Cette action est irréversible.")) return;
    if (!confirm("Confirme encore : toutes les données liées à cet espace seront supprimées.")) return;
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(`${API}/accounts/${accountId}`, { method:'DELETE', headers: { Authorization:`Bearer ${token}` } });
    if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Erreur suppression: ' + (e?.error || r.status)); return; }
    const mine = await myAccounts();
    const fallback = mine.accounts.find(a => a.id !== accountId)?.id || mine.current_account_id || null;
    setSelectedAccountId(fallback || '');
    location.reload();
  }

  function renderAccountSwitcher(list, current){
    const sel = document.getElementById('accountSwitcher'); if (!sel) return;
    sel.innerHTML = '';
    list.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id; opt.textContent = `${acc.name} — ${acc.role}`;
      if (String(acc.id) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', ()=>{ setSelectedAccountId(sel.value); location.reload(); });
  }
  function renderAtexSubCards(accountId){
    const host = document.getElementById('atexSubCards'); if(!host) return;
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
    const sub = document.getElementById('atexSubCards');
    if(!main || !sub) return;
    main.addEventListener('click', ()=>{
      sub.style.display = (sub.style.display === 'none' || !sub.style.display) ? 'grid' : 'none';
    });
  }
  function wireActions(accountId, role){
    const createBtn = document.getElementById('createAccountBtn');
    const delBtn = document.getElementById('deleteAccountBtn');
    if (createBtn) createBtn.onclick = () => createAccountFlow();
    if (delBtn) {
      if (role !== 'owner') delBtn.style.display = 'none';
      delBtn.onclick = () => deleteAccountFlow(accountId, role);
    }
  }
  function applyLicensingGating(userTier){
    document.querySelectorAll('#atexSubCards article.app-card').forEach(art=>{
      const appKey = art.getAttribute('data-app');
      const href = art.getAttribute('data-href');
      const ok = isAllowed(appKey, 'ATEX', userTier);
      const clone = art.cloneNode(true); art.parentNode.replaceChild(clone, art);
      const node = clone;
      const chip = node.querySelector('[data-chip="usage"]');
      if (chip) chip.textContent = ok ? 'Disponible' : 'Verrouillé';
      if (!ok) {
        node.classList.add('locked');
        node.onclick = () => { location.href = 'subscription_atex.html'; };
      } else {
        node.onclick = () => { location.href = href; };
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    await guard(); setupLogout();
    try{
      const mine = await myAccounts();
      const preferredFromURL = Number(new URLSearchParams(location.search).get('account_id')) || null;
      const preferred = preferredFromURL || selectedAccountId() || mine.current_account_id || (mine.accounts[0]?.id || null);
      if (preferred) setSelectedAccountId(preferred);
      renderAccountSwitcher(mine.accounts, preferred);
      renderAtexSubCards(preferred); wireMainAtexCard();

      const lic = await fetchLicense('ATEX', preferred);
      const chipLic = document.getElementById('chipAtexLicense');
      if (chipLic){
        chipLic.textContent = lic?.tier
          ? `Licence: ${tierName(lic.tier)}${lic.assigned===false ? ' • seat requis' : ''}`
          : 'Licence: Free (par défaut)';
      }
      applyLicensingGating(lic?.tier ?? 0);
      const role = lic?.role || (mine.accounts.find(a => a.id === preferred)?.role) || 'member';
      wireActions(preferred, role);
    }catch(e){
      console.error(e); alert('Impossible de charger vos espaces de travail.');
    }
  });
})();
