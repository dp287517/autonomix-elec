(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'autonomix_selected_account_id';
  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des équipements, inspections, conformité' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / étude explosion (à venir)' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi (à venir)' },
  ];
  const ACCESS_POLICY = { 'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } } };
  function atexApps(){ return APPS.filter(a => a.group==='ATEX'); }
  function isAllowed(appKey, suiteCode, userTier){ const need = ACCESS_POLICY[suiteCode]?.tiers?.[appKey] ?? 0; return userTier >= need; }

  function selectedAccountId(){ return Number(localStorage.getItem(STORAGE_SEL) || '0') || null; }
  function setSelectedAccountId(v){ localStorage.setItem(STORAGE_SEL, String(v)); }

  async function myAccounts(){
    const token = localStorage.getItem('autonomix_token') || '';
    const r = await fetch(`${API}/accounts/mine`, { headers: { Authorization:`Bearer ${token}` } });
    if(!r.ok) throw new Error('accounts/mine '+r.status);
    return r.json();
  }

  async function fetchLicense(appCode, accountId){
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token || !accountId) return null;
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, { headers: { Authorization:`Bearer ${token}` } });
      if(!r.ok) throw 0; return await r.json();
    }catch{ return null; }
  }

  function renderAccountSwitcher(list, current){
    const sel = document.getElementById('accountSwitcher');
    if (!sel) return;
    sel.innerHTML = '';
    list.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id; opt.textContent = `${acc.name} — ${acc.role}`;
      if (String(acc.id) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', ()=>{
      setSelectedAccountId(sel.value);
      location.reload();
    });
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
          <span class="tag" data-chip="usage" data-app="${app.key}">Sous-app</span>
        </div>
      `;
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

  function applyLicensingGating(userTier){
    document.querySelectorAll('#atexSubCards article.app-card').forEach(art=>{
      const appKey = art.getAttribute('data-app');
      const href = art.getAttribute('data-href');
      const ok = isAllowed(appKey, 'ATEX', userTier);

      const clone = art.cloneNode(true);
      art.parentNode.replaceChild(clone, art);
      const node = clone;

      if (!ok) {
        node.classList.add('locked');
        const lock = document.createElement('div');
        lock.style.position='absolute'; lock.style.top='12px'; lock.style.right='12px';
        lock.className='tag'; lock.textContent='Verrouillé';
        node.appendChild(lock);
        node.onclick = () => { location.href = 'subscription_atex.html'; };
      } else {
        node.onclick = () => { location.href = href; };
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    try{
      const mine = await myAccounts();
      const preferred = selectedAccountId() || mine.current_account_id || (mine.accounts[0]?.id || null);
      if (preferred) setSelectedAccountId(preferred);
      renderAccountSwitcher(mine.accounts, preferred);

      renderAtexSubCards(preferred);
      wireMainAtexCard();

      const lic = await fetchLicense('ATEX', preferred);
      const chipLic = document.getElementById('chipAtexLicense');
      if (chipLic){
        chipLic.textContent = lic?.tier
          ? `Licence: ${lic.tier===2?'Pro': lic.tier===1?'Personal':'Free'}${lic.scope ? ' • '+lic.scope : ''}${lic.assigned===false ? ' • seat requis' : ''}`
          : 'Licence: non attribuée';
      }
      const userTier = lic?.tier ?? 0;
      applyLicensingGating(userTier);
    }catch(e){
      console.error(e);
      alert('Impossible de charger vos espaces de travail.');
    }
  });
})();
