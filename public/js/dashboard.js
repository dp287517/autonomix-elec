// public/js/dashboard.js — fixed (manage link hidden for non-owners + normalized license label)
(()=>{
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';

  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / etude explosion' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi' }
  ];
  const ACCESS_POLICY = { 'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } } };
  function tierName(t){ return t===2?'Pro': (t===1?'Personal':'Free'); }
  function fromServerTier(t){
    if (typeof t !== 'number') return 0;
    if (t>=1 && t<=3) return t-1; // server 1..3 -> 0..2
    if (t>=0 && t<=2) return t;   // already 0..2
    return 0;
  }
  function labelFromServerTier(t){
    if (t===3) return 'Pro'; if (t===2) return 'Personal'; return 'Free';
  }
  function normalizeTierForLabel(t){ if (typeof t==='number' && t>2) return 2; if (typeof t==='number' && t<0) return 0; return t; }
  function atexApps(){ return APPS.filter(a=>a.group==='ATEX'); }
  function minTierFor(appKey, suiteCode){
    return (ACCESS_POLICY[suiteCode] && ACCESS_POLICY[suiteCode].tiers && ACCESS_POLICY[suiteCode].tiers[appKey] !== undefined)
      ? ACCESS_POLICY[suiteCode].tiers[appKey] : 0;
  }

  let currentUser = null;
  async function guard() {
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) { location.href = 'login.html'; return; }
    try{
      const r = await fetch(API + '/me', { headers:{ Authorization:'Bearer ' + token } });
      if(!r.ok) throw new Error('me ' + r.status);
      const data = await r.json();
      currentUser = { email: data.email, account_id: data.account_id, role: data.role };
      const emailEl = document.getElementById('userEmail');
      if (emailEl) {
        emailEl.textContent = (currentUser.email || '') + ' • compte #' +
          (currentUser.account_id != null ? currentUser.account_id : '—') +
          ' • ' + (currentUser.role || '');
      }
    }catch(e){
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    }
  }
  function setupLogout(){
    const btn = document.getElementById('logoutBtn');
    if(btn) btn.addEventListener('click', function(){
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    });
  }

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function setSelectedAccountId(v){ if (v!=null) localStorage.setItem(STORAGE_SEL, String(v)); }

  async function myAccounts(){
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(API + '/accounts/mine', { headers: { Authorization:'Bearer ' + token } });
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
      const r = await fetch(API + '/licenses/' + encodeURIComponent(appCode) + '?account_id=' + accountId, { headers: { Authorization:'Bearer ' + token } });
      if (r.status === 403) return { forbidden: true };
      if(!r.ok) return null; 
      return await r.json();
    }catch(e){ return null; }
  }

  async function createAccountFlow(){
    const name = prompt('Nom du nouvel espace de travail ?');
    if (!name || !name.trim()) return;
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(API + '/accounts', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body: JSON.stringify({ name: name.trim() }) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Erreur creation: ' + (e && e.error ? e.error : r.status)); return; }
    const acc = await r.json();
    const newId   = acc.account_id != null ? acc.account_id : acc.id;
    const newName = acc.account_name || acc.name || 'Nouvel espace';
    setSelectedAccountId(newId);
    alert('Espace cree: ' + newName + ' (#' + newId + '). Choisis maintenant un abonnement (bouton "Gerer l abonnement").');
    const url = new URL(window.location.origin + '/subscription_atex.html');
    url.searchParams.set('account_id', newId);
    location.href = url.toString();
  }

  async function deleteAccountFlow(accountId, role){
    if (role !== 'owner') { alert("Seul l'owner peut supprimer l'espace."); return; }
    if (!confirm("Supprimer cet espace ? Cette action est irreversible.")) return;
    if (!confirm("Confirme encore : toutes les donnees liees a cet espace seront supprimees.")) return;
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(API + '/accounts/' + accountId, { method:'DELETE', headers: { Authorization:'Bearer ' + token } });
    if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Erreur suppression: ' + (e && e.error ? e.error : r.status)); return; }
    const mine = await myAccounts();
    const list = mine.accounts || mine;
    let fallback = null;
    for (let i=0;i<list.length;i++){ if (String(list[i].id) !== String(accountId)){ fallback = list[i].id; break; } }
    if (fallback) setSelectedAccountId(fallback);
    else localStorage.removeItem(STORAGE_SEL);
    location.href = 'dashboard.html';
  }

  function renderAccountSwitcher(mine, current){
    const list = mine.accounts || mine;
    const sel = document.getElementById('accountSwitcher'); if (!sel) return;
    sel.innerHTML = '';
    list.forEach(function(acc){
      const id   = acc.id || acc.account_id;
      const name = acc.name || acc.account_name;
      const role = acc.role || acc.user_role || 'member';
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = name + ' — ' + role;
      if (String(id) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      setSelectedAccountId(sel.value);
      const url = new URL(window.location.href);
      url.searchParams.set('account_id', sel.value);
      window.location.href = url.toString();
    });
  }

  function renderAtexSubCards(accountId){
    const host = document.getElementById('atexSubCards'); if(!host) return;
    host.innerHTML = '';
    atexApps().forEach(function(app){
      const art = document.createElement('article');
      art.className = 'app-card';
      art.setAttribute('data-href', app.href + '?account_id=' + accountId);
      art.setAttribute('data-app', app.key);
      art.setAttribute('data-group', 'ATEX');
      const html = '' +
        '<div class="d-flex justify-content-between align-items-center">' +
          '<div>' +
            '<div class="fw-bold">' + app.title + '</div>' +
            '<div class="text-secondary small">' + (app.sub || '') + '</div>' +
          '</div>' +
          '<span class="chip" data-chip="usage" data-app="' + app.key + '"></span>' +
        '</div>';
      art.innerHTML = html;
      host.appendChild(art);
    });
  }

  function wireMainAtexCard(){
    const main = document.getElementById('cardATEX');
    const sub = document.getElementById('atexSubCards');
    if(!main || !sub) return;
    main.addEventListener('click', function(e){
      const manage = e.target && e.target.closest && e.target.closest('#manageAtexLink');
      if (manage) return;
      const hidden = getComputedStyle(sub).display === 'none' || sub.classList.contains('hidden') || sub.classList.contains('d-none');
      if (hidden){
        sub.style.display = 'grid';
        sub.classList.remove('hidden'); sub.classList.remove('d-none');
      } else {
        sub.style.display = 'none';
        sub.classList.add('hidden');
      }
    });
  }

  function wireActions(accountId, role){
    const createBtn = document.getElementById('createAccountBtn');
    const delBtn = document.getElementById('deleteAccountBtn');
    const manageLink = document.getElementById('manageAtexLink');
    if (manageLink) {
      const url = new URL(window.location.origin + '/subscription_atex.html');
      url.searchParams.set('account_id', accountId);
      manageLink.href = url.toString();
      if (role !== 'owner') {
        manageLink.style.display = 'none';
      } else {
        manageLink.style.display = '';
      }
    }
    if (createBtn) createBtn.onclick = function(){ createAccountFlow(); };
    if (delBtn) {
      if (role === 'owner') {
        delBtn.classList.remove('owner-only');
        delBtn.style.display = 'inline-block';
      } else {
        delBtn.classList.add('owner-only');
        delBtn.style.display = 'none';
      }
      delBtn.onclick = function(){ deleteAccountFlow(accountId, role); };
    }
  }

  function lockAllSubCards(reasonMsg){
    document.querySelectorAll('#atexSubCards article.app-card').forEach(function(node){
      node.classList.add('locked');
      const chip = node.querySelector('[data-chip=\"usage\"]');
      if (chip) chip.textContent = reasonMsg || 'Acces verrouille';
      node.onclick = function(){ alert(reasonMsg || 'Acces verrouille'); };
    });
  }

  function applyLicensingGating(lic){
    if (!lic || lic.forbidden) { lockAllSubCards('Acces refuse a cet espace'); return; }
    if (lic.source === 'seatful' && lic.assigned === false) { lockAllSubCards('Aucun siege assigne sur cet espace'); return; }

    const userTier = fromServerTier(lic && typeof lic.tier === 'number' ? lic.tier : 0);
    document.querySelectorAll('#atexSubCards article.app-card').forEach(function(art){
      const appKey = art.getAttribute('data-app');
      const href = art.getAttribute('data-href');
      const need = minTierFor(appKey, 'ATEX');
      const ok = userTier >= need;
      const clone = art.cloneNode(true); art.parentNode.replaceChild(clone, art);
      const node = clone;
      const chip = node.querySelector('[data-chip=\"usage\"]');
      if (chip) chip.textContent = ok ? 'Disponible' : ('Niveau requis: ' + tierName(need));
      if (!ok) {
        node.classList.add('locked');
        node.onclick = function(){
          const params = new URLSearchParams(location.search);
          const acc = params.get('account_id') || (localStorage.getItem(STORAGE_SEL) || '');
          const url = new URL(window.location.origin + '/subscription_atex.html');
          if (acc) url.searchParams.set('account_id', acc);
          location.href = url.toString();
        };
      } else {
        node.onclick = function(){ location.href = href; };
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async function(){
    await guard(); setupLogout();
    try{
      const mine = await myAccounts();
      const fromURL = Number((new URLSearchParams(location.search)).get('account_id'));
      const stored = selectedAccountId();
      const list = mine.accounts || mine;
      const preferred = (Number.isFinite(fromURL) && fromURL) ? fromURL : (stored || (list[0] ? (list[0].id || list[0].account_id) : null));
      if ((Number.isFinite(fromURL) && fromURL) || !stored) setSelectedAccountId(preferred);

      renderAccountSwitcher(mine, preferred);
      renderAtexSubCards(preferred); wireMainAtexCard();

      const lic = await fetchLicense('ATEX', preferred);
      const chipLic = document.getElementById('chipAtexLicense');
      if (lic && lic.forbidden){
        if (chipLic) chipLic.textContent = 'Acces refuse a cet espace';
        applyLicensingGating(lic);
        let meRole = '—';
        const arr = mine.accounts || mine;
        for (let i=0;i<arr.length;i++){ if (String(arr[i].id||arr[i].account_id) === String(preferred)){ meRole = arr[i].role; break; } }
        wireActions(preferred, meRole);
        return;
      }
      if (chipLic){
        const serverT = (lic && typeof lic.tier==='number') ? lic.tier : 0;
        chipLic.textContent = 'Licence: ' + labelFromServerTier(serverT>=1 && serverT<=3 ? serverT : (serverT+1));
      }
    applyLicensingGating(lic);
      const role = (function(){
        const arr = mine.accounts || mine;
        for (let i=0;i<arr.length;i++){ if (String(arr[i].id||arr[i].account_id) === String(preferred)){ return arr[i].role; } }
        return 'member';
      })();
      wireActions(preferred, role);
    }catch(e){
      console.error(e); alert('Impossible de charger vos espaces de travail.');
    }
  });
})();