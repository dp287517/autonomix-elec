
(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';

  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / etude explosion' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi' }
  ];
  const ACCESS_POLICY = { 'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } } };
  function tierName(t){ return t===2?'Pro': (t===1?'Personal':'Free'); }
  function atexApps(){ return APPS.filter(function(a){ return a.group==='ATEX'; }); }
  function minTierFor(appKey, suiteCode){
    return (ACCESS_POLICY[suiteCode] && ACCESS_POLICY[suiteCode].tiers && ACCESS_POLICY[suiteCode].tiers[appKey] !== undefined)
      ? ACCESS_POLICY[suiteCode].tiers[appKey] : 0;
  }

  var currentUser = null;
  async function guard() {
    var token = localStorage.getItem('autonomix_token') || '';
    if (!token) { location.href = 'login.html'; return; }
    try{
      var r = await fetch(API + '/me', { headers:{ Authorization:'Bearer ' + token } });
      if(!r.ok) throw new Error('me ' + r.status);
      var data = await r.json();
      currentUser = { email: data.email, account_id: data.account_id, role: data.role };
      var emailEl = document.getElementById('userEmail');
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
    var btn = document.getElementById('logoutBtn');
    if(btn) btn.addEventListener('click', function(){
      localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    });
  }

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function setSelectedAccountId(v){ if (v!=null) localStorage.setItem(STORAGE_SEL, String(v)); }

  async function myAccounts(){
    var token = localStorage.getItem('autonomix_token') || '';
    var r = await fetch(API + '/accounts/mine', { headers: { Authorization:'Bearer ' + token } });
    if(!r.ok){
      if (r.status === 401) { localStorage.removeItem('autonomix_token'); location.href = 'login.html'; }
      if (r.status === 403) { alert("Tu n'as pas les droits pour lister les espaces (403)."); }
      throw new Error('accounts/mine ' + r.status);
    }
    return r.json();
  }

  async function fetchLicense(appCode, accountId){
    var token = localStorage.getItem('autonomix_token') || '';
    if (!token || !accountId) return null;
    try{
      var r = await fetch(API + '/licenses/' + encodeURIComponent(appCode) + '?account_id=' + accountId, { headers: { Authorization:'Bearer ' + token } });
      if (r.status === 403) return { forbidden: true };
      if(!r.ok) return null; 
      return await r.json();
    }catch(e){ return null; }
  }

  async function createAccountFlow(){
    var name = prompt('Nom du nouvel espace de travail ?');
    if (!name || !name.trim()) return;
    var token = localStorage.getItem('autonomix_token') || '';
    var r = await fetch(API + '/accounts', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body: JSON.stringify({ name: name.trim() }) });
    if (!r.ok) { var e = await r.json().catch(function(){return {};}); alert('Erreur creation: ' + (e && e.error ? e.error : r.status)); return; }
    var acc = await r.json();
    setSelectedAccountId(acc.id);
    alert('Espace cree: ' + acc.name + ' (#' + acc.id + '). Choisis maintenant un abonnement (bouton "Gerer l abonnement").');
    var url = new URL(window.location.origin + '/subscription_atex.html');
    url.searchParams.set('account_id', acc.id);
    location.href = url.toString();
  }

  async function deleteAccountFlow(accountId, role){
    if (role !== 'owner') { alert("Seul l'owner peut supprimer l'espace."); return; }
    if (!confirm("Supprimer cet espace ? Cette action est irreversible.")) return;
    if (!confirm("Confirme encore : toutes les donnees liees a cet espace seront supprimees.")) return;
    var token = localStorage.getItem('autonomix_token') || '';
    var r = await fetch(API + '/accounts/' + accountId, { method:'DELETE', headers: { Authorization:'Bearer ' + token } });
    if (!r.ok) { var e = await r.json().catch(function(){return {};}); alert('Erreur suppression: ' + (e && e.error ? e.error : r.status)); return; }
    var mine = await myAccounts();
    var fallback = null;
    for (var i=0;i<mine.accounts.length;i++){ if (mine.accounts[i].id !== accountId){ fallback = mine.accounts[i].id; break; } }
    fallback = fallback || mine.current_account_id || null;
    if (fallback) setSelectedAccountId(fallback);
    else localStorage.removeItem(STORAGE_SEL);
    location.reload();
  }

  function renderAccountSwitcher(list, current){
    var sel = document.getElementById('accountSwitcher'); if (!sel) return;
    sel.innerHTML = '';
    list.forEach(function(acc){
      var opt = document.createElement('option');
      opt.value = acc.id; opt.textContent = acc.name + ' — ' + acc.role;
      if (String(acc.id) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      setSelectedAccountId(sel.value);
      var url = new URL(window.location.href);
      url.searchParams.set('account_id', sel.value);
      window.location.href = url.toString();
    });
  }

  function renderAtexSubCards(accountId){
    var host = document.getElementById('atexSubCards'); if(!host) return;
    host.innerHTML = '';
    atexApps().forEach(function(app){
      var art = document.createElement('article');
      art.className = 'app-card';
      art.setAttribute('data-href', app.href + '?account_id=' + accountId);
      art.setAttribute('data-app', app.key);
      art.setAttribute('data-group', 'ATEX');
      var html = '' +
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
    var main = document.getElementById('cardATEX');
    var sub = document.getElementById('atexSubCards');
    if(!main || !sub) return;
    main.addEventListener('click', function(){
      sub.style.display = (sub.style.display === 'none' || !sub.style.display) ? 'grid' : 'none';
    });
  }

  function wireActions(accountId, role){
    var createBtn = document.getElementById('createAccountBtn');
    var delBtn = document.getElementById('deleteAccountBtn');
    var manageLink = document.getElementById('manageAtexLink');
    if (manageLink) {
      var url = new URL(window.location.origin + '/subscription_atex.html');
      url.searchParams.set('account_id', accountId);
      manageLink.href = url.toString();
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
      var chip = node.querySelector('[data-chip="usage"]');
      if (chip) chip.textContent = reasonMsg || 'Acces verrouille';
      node.onclick = function(){ alert(reasonMsg || 'Acces verrouille'); };
    });
  }

  function applyLicensingGating(lic){
    if (!lic || lic.forbidden) { lockAllSubCards('Acces refuse a cet espace'); return; }
    if (lic.source === 'seatful' && lic.assigned === false) { lockAllSubCards('Aucun siege assigne sur cet espace'); return; }

    var userTier = lic && typeof lic.tier === 'number' ? lic.tier : 0;
    document.querySelectorAll('#atexSubCards article.app-card').forEach(function(art){
      var appKey = art.getAttribute('data-app');
      var href = art.getAttribute('data-href');
      var need = minTierFor(appKey, 'ATEX');
      var ok = userTier >= need;
      var clone = art.cloneNode(true); art.parentNode.replaceChild(clone, art);
      var node = clone;
      var chip = node.querySelector('[data-chip="usage"]');
      if (chip) chip.textContent = ok ? 'Disponible' : ('Niveau requis: ' + tierName(need));
      if (!ok) {
        node.classList.add('locked');
        node.onclick = function(){
          var params = new URLSearchParams(location.search);
          var acc = params.get('account_id') || (localStorage.getItem(STORAGE_SEL) || '');
          var url = new URL(window.location.origin + '/subscription_atex.html');
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
      var mine = await myAccounts();
      var fromURL = Number((new URLSearchParams(location.search)).get('account_id'));
      var stored = selectedAccountId();
      var preferred = (Number.isFinite(fromURL) && fromURL) ? fromURL : (stored || mine.current_account_id || (mine.accounts[0] ? mine.accounts[0].id : null));
      if ((Number.isFinite(fromURL) && fromURL) || !stored) setSelectedAccountId(preferred);

      renderAccountSwitcher(mine.accounts, preferred);
      renderAtexSubCards(preferred); wireMainAtexCard();

      var lic = await fetchLicense('ATEX', preferred);
      var chipLic = document.getElementById('chipAtexLicense');
      if (lic && lic.forbidden){
        if (chipLic) chipLic.textContent = 'Acces refuse a cet espace';
        applyLicensingGating(lic);
        var meRole = '—';
        for (var i=0;i<mine.accounts.length;i++){ if (mine.accounts[i].id === preferred){ meRole = mine.accounts[i].role; break; } }
        wireActions(preferred, meRole);
        return;
      }
      if (chipLic){
        var label = (lic && typeof lic.tier==='number' && lic.tier>0) ? ('Licence: ' + tierName(lic.tier)) : 'Licence: Free (par defaut)';
        if (lic && lic.source === 'seatful' && lic.assigned === false) label += ' • siege requis';
        chipLic.textContent = label;
      }
      applyLicensingGating(lic);
      var role = (lic && lic.role) || (function(){
        for (var i=0;i<mine.accounts.length;i++){ if (mine.accounts[i].id === preferred){ return mine.accounts[i].role; } }
        return 'member';
      })();
      wireActions(preferred, role);
    }catch(e){
      console.error(e); alert('Impossible de charger vos espaces de travail.');
    }
  });
})();
