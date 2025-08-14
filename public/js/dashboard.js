(() => {
  const API = (window.API_BASE_URL || '') + '/api';
  const USAGE_KEY_BASE = 'autonomix_app_usage_v1';
  const LAST_ATEX_KEY_BASE = 'autonomix_last_atex_app';
  let currentUser = null;

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
      const r = await fetch(`${API}/usage?apps=ATEX Control,EPD,IS Loop`, {
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
    console.log('[dashboard] Token utilisé pour bump:', token);
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
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
    console.log('[dashboard] Clic sur app:', app, 'href:', href);
    await bump(app);
    if(href && href !== '#') location.href = href;
  }

  function renderSmartShortcuts(){
    const box = document.getElementById('smartShortcuts'); if(!box) return; box.innerHTML='';
    const usage = Object.entries(getUsage())
      .sort((a,b)=> (b[1].count || 0) - (a[1].count || 0))
      .slice(0,3);
    const host = box.querySelector('.host') || box;
    // Liste des apps avec leurs URLs correctes
    const appUrls = {
      'ATEX Control': 'atex-control.html',
      'EPD': 'epd.html',
      'IS Loop': 'is-loop.html'
    };
    usage.forEach(([app, data])=>{
      // Ignore ATEX-last
      if (app === 'ATEX-last') return;
      const href = appUrls[app] || '#'; // URL par défaut si inconnue
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

  function renderAtexGroup(){
    const host = document.getElementById('atexGroup'); if(!host) return; box.innerHTML=''; // host, pas box
    const last = localStorage.getItem(storageKey(LAST_ATEX_KEY_BASE)) || 'ATEX Control';
    const apps = [
      { title:'Dernier utilisé', key:'ATEX-last', href: last==='EPD' ? 'epd.html' : (last==='IS Loop' ? 'is-loop.html' : 'atex-control.html'), sub: 'Ouvre directement le dernier module ATEX' },
      { title:'ATEX Control', key:'ATEX Control', href:'atex-control.html', sub: 'Gestion équipements / inspections' },
      { title:'EPD', key:'EPD', href:'epd.html', sub: 'Dossier explosion (coming soon)' },
      { title:'IS Loop', key:'IS Loop', href:'is-loop.html', sub: 'Boucles Exi (coming soon)' },
    ];
    apps.forEach(a=>{
      const card = document.createElement('div'); card.className='mini';
      card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600">${a.title}</div>
          <div class="opacity-70" style="font-size:12px">${a.sub}</div>
        </div>
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </div>`;
      card.onclick = () => go(a.href, a.key);
      host.appendChild(card);
    });
  }

  function wireCards(){
    document.querySelectorAll('.app-card').forEach(card=>{
      const href = card.getAttribute('data-href');
      const app  = card.getAttribute('data-app');
      const group= card.getAttribute('data-group');
      const disabled = card.hasAttribute('data-disabled');
      if(disabled){ card.style.opacity=.45; card.style.pointerEvents='none'; }
      const chip = card.querySelector('[data-chip="usage"]');
      if(chip){ chip.textContent = labelUsage(app); }
      card.addEventListener('click', async ()=>{
        if(disabled) return;
        if(group==='ATEX') localStorage.setItem(storageKey(LAST_ATEX_KEY_BASE), app);
        await go(href, app);
      });
    });
  }

  function setupLogout(){
    const btn=document.getElementById('logoutBtn');
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
    setupLogout();
    wireCards();
    renderSmartShortcuts();
    renderAtexGroup();
    console.info('[dashboard] scope', scopeSuffix(), 'usages synced from server');
  });
})();
