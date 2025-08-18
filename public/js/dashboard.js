// /public/js/dashboard.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'selected_account_id';

  const token = () => localStorage.getItem('autonomix_token') || '';
  const authHeaders = () => ({ Authorization: 'Bearer ' + token() });
  const $ = (sel) => document.querySelector(sel);

  // tiers: 1=Free, 2=Personal, 3=Pro
  const APPS = [
    { title: 'ATEX Control', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite', href: 'atex-control.html', minTier: 1 },
    { title: 'EPD',          group: 'ATEX', sub: 'Dossier / etude explosion',                         href: 'epd.html',           minTier: 2 },
    { title: 'IS Loop',      group: 'ATEX', sub: 'Calculs boucles Exi',                                href: 'is-loop.html',       minTier: 3 }
  ];
  const tierName = (t) => (t === 3 ? 'Pro' : t === 2 ? 'Personal' : 'Free');

  function ensureLockStyles() { /* déjà géré côté CSS global */ }

  // --- API ---
  async function myAccounts() {
    const r = await fetch(`${API}/accounts/mine`, { headers: authHeaders(), cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem('autonomix_token'); location.href = 'login.html'; return []; }
    if (!r.ok) throw new Error(`accounts/mine ${r.status}`);
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  }
  async function getMe(accountId) {
    const url = new URL(API + '/me', window.location.origin);
    if (accountId != null) url.searchParams.set('account_id', accountId);
    const r = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error('me ' + r.status);
    return r.json();
  }
  async function fetchLicense(appCode, accountId) {
    const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, {
      headers: authHeaders(), cache: 'no-store'
    });
    if (r.status === 403) { const e = new Error('forbidden'); e.code = 403; throw e; }
    if (!r.ok) throw new Error('licenses ' + r.status);
    return r.json();
  }
  async function createAccount(name) {
    const r = await fetch(API + '/accounts', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || ('HTTP ' + r.status)); }
    return r.json();
  }
  async function deleteAccount(accountId) {
    const r = await fetch(API + '/accounts/' + accountId, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || ('HTTP ' + r.status)); }
    return r.json();
  }

  // --- prefs ---
  function getPreferredAccountIdFromURL() {
    const u = new URL(window.location.href); return u.searchParams.get('account_id');
  }
  function getStoredAccountId() { return localStorage.getItem(STORAGE_SEL); }
  function storeAccountId(id, updateURL = true) {
    localStorage.setItem(STORAGE_SEL, String(id));
    if (updateURL) {
      const u = new URL(window.location.href); u.searchParams.set('account_id', String(id));
      window.history.replaceState({}, '', u.toString());
    }
  }

  // --- UI ---
  function renderAccountSwitcher(accounts, selectedId) {
    const select = $('#accountSwitcher'); if (!select) return;
    select.innerHTML = '';
    if (!accounts.length) {
      const opt = document.createElement('option'); opt.value=''; opt.textContent='Aucun espace';
      select.appendChild(opt); select.disabled = true; return;
    }
    select.disabled = false;
    for (const a of accounts) {
      const id = String(a.id || a.account_id);
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = `${a.name || ('Espace #'+id)} — ${a.role || ''}`;
      if (String(selectedId) === id) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = async (e)=> { await onAccountChanged(e.target.value, accounts); };
  }

  function renderAtexSubCards(accountId, tier) {
    const sub = $('#atexSubCards'); if (!sub) return;
    sub.innerHTML = '';
    let t = Number(tier); if (!Number.isFinite(t) || t < 1) t = 1;
    APPS.forEach(app => {
      const allowed = t >= app.minTier;
      const card = document.createElement('div');
      card.className = 'app-card' + (allowed ? '' : ' disabled');
      const title = document.createElement('div'); title.className='app-title'; title.textContent = app.title;
      const desc  = document.createElement('div'); desc.className='app-sub';   desc.textContent = app.sub;
      card.appendChild(title); card.appendChild(desc);
      if (allowed) {
        card.addEventListener('click', ()=>{
          const url = new URL(window.location.origin + '/' + app.href);
          url.searchParams.set('account_id', accountId); location.href = url.toString();
        });
      } else {
        const need = (app.minTier===3?'Pro':app.minTier===2?'Personal':'Free');
        const lock = document.createElement('div'); lock.className='lock';
        lock.innerHTML = `Débloquez avec niveau ${need}<small>(actuellement: ${t===3?'Pro':t===2?'Personal':'Free'})</small>`;
        card.appendChild(lock); card.title = `Nécessite le plan ${need}`;
      }
      sub.appendChild(card);
    });
  }

  function wireMainAtexCard(role) {
    const main = $('#cardATEX'); const sub = $('#atexSubCards'); if (!main || !sub) return;
    if (role === 'member') { // members: toujours visible, pas de toggle
      sub.style.display = 'grid'; sub.classList.remove('d-none','hidden');
      main.onclick = (e)=>{ const isManage = e.target?.closest?.('#manageAtexLink'); if (isManage) return; };
      return;
    }
    sub.style.display = 'none'; sub.classList.add('hidden');
    main.onclick = (e)=>{
      const isManage = e.target?.closest?.('#manageAtexLink'); if (isManage) return;
      const hidden = getComputedStyle(sub).display === 'none' || sub.classList.contains('hidden');
      if (hidden) { sub.style.display='grid'; sub.classList.remove('hidden'); }
      else { sub.style.display='none'; sub.classList.add('hidden'); }
    };
  }

  function wireActions(accountId, role) {
    const createBtn = $('#createAccountBtn');
    const delBtn    = $('#deleteAccountBtn');
    const manage    = $('#manageAtexLink');

    if (manage) {
      const u = new URL(window.location.origin + '/subscription_atex.html');
      if (accountId != null) u.searchParams.set('account_id', accountId);
      manage.href = u.toString();
      if (role !== 'owner' && role !== 'admin') manage.classList.add('disabled'); else manage.classList.remove('disabled');
    }

    if (createBtn) {
      createBtn.onclick = async ()=>{
        const name = await UI.prompt({ title:'Nouvel espace', label:'Nom de l’espace', placeholder:'Ex. Mon entreprise', okText:'Créer' });
        if (!name) return;
        try{
          const acc = await createAccount(name.trim());
          const newId = String(acc.account_id ?? acc.id);
          storeAccountId(newId);
          UI.toast('Espace créé. Choisissez un abonnement.');
          const url = new URL(window.location.origin + '/subscription_atex.html');
          url.searchParams.set('account_id', newId); location.href = url.toString();
        }catch(e){ UI.toast('Erreur création espace: '+e.message, 2600); }
      };
    }

    if (delBtn) {
      delBtn.onclick = async ()=>{
        if (role !== 'owner') { UI.toast("Seul l'owner peut supprimer l'espace."); return; }
        const ok = await UI.confirm({ title:'Supprimer cet espace ?', message:'Action irréversible. Confirmez la suppression.' });
        if (!ok) return;
        try{
          await deleteAccount(accountId);
          localStorage.removeItem(STORAGE_SEL);
          UI.toast('Espace supprimé.');
          setTimeout(()=> location.href = 'dashboard.html', 300);
        }catch(e){ UI.toast('Erreur suppression: '+e.message, 2600); }
      };
    }
  }

  async function onAccountChanged(newId, accounts) {
    storeAccountId(newId);
    await renderForAccount(newId, accounts);
  }

  async function renderForAccount(accountId, accounts) {
    let role = 'member';
    try{
      const me = await getMe(accountId);
      role = me?.role || (accounts.find(a => String(a.id||a.account_id)===String(accountId))?.role || 'member');
      const emailEl = $('#userEmail');
      if (emailEl) emailEl.textContent = `${me.email || ''} • compte #${accountId} • ${role}`;
      wireActions(accountId, role);
    }catch{}

    let lic = null;
    try{
      lic = await fetchLicense('ATEX', accountId);
    }catch(e){
      if (e.code === 403){
        const chip = $('#chipAtexLicense'); if (chip) chip.textContent = 'Acces refuse a cet espace';
        renderAtexSubCards(accountId, 1); wireMainAtexCard(role); return;
      }
      UI.toast('Erreur chargement licence.', 2400); return;
    }

    let t = Number(lic?.tier); if (!Number.isFinite(t) || t < 1) t = 1;
    const chip = $('#chipAtexLicense'); if (chip) chip.textContent = `Licence: ${tierName(t)} (globale)`;
    renderAtexSubCards(accountId, t);
    wireMainAtexCard(role);
  }

  async function resolveAccessibleAccountId(accounts, preferredId) {
    const ids = accounts.map(a => String(a.id || a.account_id));
    let chosen = preferredId && ids.includes(String(preferredId)) ? String(preferredId) : (ids[0] || null);
    if (!chosen) return null;

    try{ await fetchLicense('ATEX', chosen); return chosen; }
    catch(e){
      if (e.code !== 403) throw e;
      for (const a of accounts){
        const id = String(a.id || a.account_id);
        try{ await fetchLicense('ATEX', id); return id; }catch(err){ if (err.code !== 403) throw err; }
      }
      return null;
    }
  }

  async function boot() {
    if (!token()) { location.href = 'login.html'; return; }
    const logout = $('#logoutBtn');
    if (logout) logout.onclick = ()=>{ localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user'); localStorage.removeItem(STORAGE_SEL); location.href='login.html'; };

    try{
      const accounts = await myAccounts();
      renderAccountSwitcher(accounts, null);
      if (!accounts.length) return;

      const fallback = String(accounts[0].id || accounts[0].account_id);
      const preferred = getPreferredAccountIdFromURL() || getStoredAccountId() || fallback;
      const accessible = await resolveAccessibleAccountId(accounts, preferred);
      const finalId = accessible || fallback;

      storeAccountId(finalId);
      renderAccountSwitcher(accounts, finalId);
      await renderForAccount(finalId, accounts);
    }catch(e){
      console.error(e); UI.toast('Erreur au chargement du tableau de bord.', 2400);
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
