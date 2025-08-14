(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const USAGE_KEY_BASE = 'autonomix_app_usage_v1';
  const LAST_ATEX_KEY_BASE = 'autonomix_last_atex_app';
  let currentUser = null;

  // === Process / Config pour futures apps ===
  // Ajoute ici de nouvelles apps ATEX si besoin (title/href/key obligatoires)
  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', href: 'atex-control.html', group: 'ATEX', sub: 'Gestion des équipements, inspections, conformité' },
    { key: 'EPD',          title: 'EPD',          href: 'epd.html',         group: 'ATEX', sub: 'Dossier / étude explosion (à venir)' },
    { key: 'IS Loop',      title: 'IS Loop',      href: 'is-loop.html',     group: 'ATEX', sub: 'Calculs boucles Exi (à venir)' },
  ];
  function atexApps(){ return APPS.filter(a => a.group === 'ATEX'); }

  function scopeSuffix(){
    const acc = (currentUser && currentUser.account_id != null) ? String(currentUser.account_id) : 'anon';
    const user = (currentUser && currentUser.email) ? String(currentUser.email).toLowerCase() : 'anon';
    return `${acc}:${user}`;
  }
  function storageKey(base){ return `${base}:${scopeSuffix()}`; }

  async function guard() {
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) { location.href = 'login.html'; return; }
    try{
      const r = await fetch(`${API}/me`, { headers:{ Authorization:`Bearer ${token}` } });
      if(!r.ok) throw new Error(`me ${r.status}`);
      const data = await r.json();
      currentUser = { email: data.email, account_id: data.account_id, role: data.role };

      if (location.hash && /reset-usage/i.test(location.hash)) {
        try {
          localStorage.removeItem(storageKey(USAGE_KEY_BASE));
          localStorage.removeItem(storageKey(LAST_ATEX_KEY_BASE));
          localStorage.removeItem(USAGE_KEY_BASE);
          localStorage.removeItem(LAST_ATEX_KEY_BASE);
          console.info('[dashboard] usage reset for', scopeSuffix());
        } catch {}
      }

      const emailEl = document.getElementById('userEmail');
      if (emailEl) emailEl.textContent = `${currentUser.email || ''} • compte #${currentUser.account_id ?? '—'} • ${currentUser.role || ''}`;
    }catch{
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    }
  }

  async function fetchUsageFromServer() {
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) return {};
    try {
      // Utilise la liste APPS pour construire la query
      const appsList = atexApps().map(a => a.key).join(',');
      const r = await fetch(`${API}/usage?apps=${encodeURIComponent(appsList)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) throw new Error('Erreur fetch usage');
      const serverUsage = await r.json();
      return serverUsage;
    } catch (e) {
      console.warn('[dashboard] Erreur fetch usage serveur:', e);
      return {};
    }
  }

  function mergeUsage(local, server) {
    const merged = { ...local };
    Object.keys(server).forEach(app => {
      merged[app] = {
        count: server[app].count || 0,
        last: server[app].last_at || new Date().toISOString()
      };
    });
    return merged;
  }

  function getUsage(){
    try{ return JSON.parse(localStorage.getItem(storageKey(USAGE_KEY_BASE)) || '{}'); }catch{ return {}; }
  }
  function setUsage(map){
    localStorage.setItem(storageKey(USAGE_KEY_BASE), JSON.stringify(map || {}));
  }

  async function bump(app){
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) {
      const u = getUsage();
      const v = (u[app]?.count || 0) + 1;
      u[app] = { count: v, last: new Date().toISOString() };
      setUsage(u);
      return;
    }
    try {
      const r = await fetch(`${API}/usage/bump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ app })
      });
      if (!r.ok) throw new Error('Erreur bump');
      const serverData = await r.json();
      const u = getUsage();
      u[app] = { count: serverData.count, last: serverData.last_at };
      setUsage(u);
    } catch (e) {
      console.warn('[dashboard] Erreur bump serveur:', e);
      const u = getUsage();
      const v = (u[app]?.count || 0) + 1;
      u[app] = { count: v, last: new Date().toISOString() };
      setUsage(u);
    }
  }

  function labelUsage(app){
    const u = getUsage();
    return (u[app]?.count || 0) + ' lancement' + ((u[app]?.count || 0) > 1 ? 's' : '');
  }

  async function go(href, app){
    await bump(app);
    if(href && href !== '#') location.href = href;
  }

  function renderSmartShortcuts(){
    const box = document.getElementById('smartShortcuts'); if(!box) return; box.innerHTML='';
    const usage = Object.entries(getUsage())
      .sort((a,b)=> (b[1].count || 0) - (a[1].count || 0))
      .slice(0,3);
    const host = box.querySelector('.host') || box;
    const appUrls = Object.fromEntries(APPS.map(a => [a.key, a.href]));
    usage.forEach(([app, data])=>{
      if (app === 'ATEX-last') return;
      const href = appUrls[app] || '#';
      const card = document.createElement('div'); card.className='mini';
      card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600">${app}</div>
          <div class="opacity-70" style="font-size:12px">${data.count} lancements</div>
        </div>
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </div>`;
      card.onclick = () => go(href, app);
      host.appendChild(card);
    });
  }

  function renderAtexSubCards(){
    const host = document.getElementById('atexSubCards'); if(!host) return;
    host.innerHTML = '';
    atexApps().forEach(app=>{
      const art = document.createElement('article');
      art.className = 'app-card';
      art.setAttribute('data-href', app.href);
      art.setAttribute('data-app', app.key);
      art.setAttribute('data-group', 'ATEX');
      art.innerHTML = `
        <div class="app-head">
          <div class="app-icon">
            <svg class="ico-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M9 12h6M12 9v6"/>
            </svg>
          </div>
          <div>
            <div class="app-title">${app.title}</div>
            <div class="app-sub">${app.sub || ''}</div>
          </div>
        </div>
        <div class="mt-3 d-flex align-items-center gap-2">
          <span class="tag">Suite: ATEX</span>
          <span class="chip" data-chip="usage" data-app="${app.key}">0 lancement</span>
        </div>
      `;
      art.addEventListener('click', async ()=>{
        localStorage.setItem(storageKey(LAST_ATEX_KEY_BASE), app.key);
        await go(app.href, app.key);
      });
      host.appendChild(art);
    });
  }

  async function fetchLicense(appCode){
    // Endpoint “léger” côté serveur (voir section backend)
    const token = localStorage.getItem('autonomix_token') || '';
    if (!token) return null;
    try{
      const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}`, {
        headers: { Authorization:`Bearer ${token}` }
      });
      if(!r.ok) throw new Error('licence http '+r.status);
      return await r.json(); // { app, tier, scope, source }
    }catch(e){
      console.warn('[dashboard] licence error', e);
      return null;
    }
  }

  function wireMainAtexCard(){
    const main = document.getElementById('cardATEX');
    const sub = document.getElementById('atexSubCards');
    if(!main || !sub) return;

    main.addEventListener('click', ()=>{
      sub.style.display = (sub.style.display === 'none' || !sub.style.display) ? 'grid' : 'none';
    });
  }

  function applyUsageLabels(){
    // met à jour “X lancements” sur la card principale et les sous-cards
    const chipMain = document.getElementById('chipAtexUsage');
    if (chipMain) chipMain.textContent = 'Suite ATEX · ' + (labelUsage('ATEX') || '0 lancement');
    document.querySelectorAll('[data-chip="usage"][data-app]').forEach(el=>{
      const k = el.getAttribute('data-app');
      el.textContent = labelUsage(k);
    });
  }

  function setupLogout(){
    const btn = document.getElementById('logoutBtn');
    if(btn) btn.addEventListener('click', ()=>{
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
      location.href = 'login.html';
    });
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    await guard();
    const serverUsage = await fetchUsageFromServer();
    const localUsage = getUsage();
    const merged = mergeUsage(localUsage, serverUsage);
    setUsage(merged);

    // Rendu & events
    renderAtexSubCards();
    wireMainAtexCard();
    applyUsageLabels();
    renderSmartShortcuts();
    setupLogout();

    // Récupération licence ATEX (affiche “Licence: Tier X / non attribuée”)
    const lic = await fetchLicense('ATEX');
    const chipLic = document.getElementById('chipAtexLicense');
    if (chipLic){
      chipLic.textContent = lic?.tier
        ? `Licence: Tier ${lic.tier}${lic.scope ? ' • '+lic.scope : ''}`
        : 'Licence: non attribuée';
    }

    console.info('[dashboard] prêt (scope', scopeSuffix(), ')');
  });
})();
