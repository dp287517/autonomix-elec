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

      // Reset on explicit hash (per-account+user)
      if (location.hash && /reset-usage/i.test(location.hash)) {
        try {
          localStorage.removeItem(storageKey(USAGE_KEY_BASE));
          localStorage.removeItem(storageKey(LAST_ATEX_KEY_BASE));
          // also clear any legacy global keys once
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

  function getUsage(){
    try{ return JSON.parse(localStorage.getItem(storageKey(USAGE_KEY_BASE)) || '{}'); }catch{ return {}; }
  }
  function setUsage(map){
    localStorage.setItem(storageKey(USAGE_KEY_BASE), JSON.stringify(map || {}));
  }
  function bump(app){
    const u=getUsage(); const v=(u[app]?.count||0)+1;
    u[app] = { count:v, last:new Date().toISOString() };
    setUsage(u);
  }

  function renderSmartShortcuts(){
    const box = document.getElementById('smartShortcuts'); if(!box) return; box.innerHTML='';
    const usage = Object.entries(getUsage())
      .sort((a,b)=> (b[1].count||0)-(a[1].count||0))
      .slice(0, 6);

    const defaults = [
      { title:'ATEX Control', href:'atex-control.html' },
      { title:'EPD', href:'epd.html' },
      { title:'IS Loop', href:'is-loop.html' },
    ];

    const entries = usage.length ? usage.map(([k,v])=>({ title:k, href: pickHref(k), meta:v })) : defaults;
    entries.forEach(e=>{
      const div = document.createElement('div');
      div.className = 'mini';
      div.innerHTML = `<div style="font-weight:600">${e.title}</div><div class="opacity-70" style="font-size:12px">${labelUsage(e.title)}</div>`;
      div.onclick = ()=> go(e.href, e.title);
      box.appendChild(div);
    });

    const lastAtex = localStorage.getItem(storageKey(LAST_ATEX_KEY_BASE));
    const smartLine = document.getElementById('smartLine');
    if(smartLine){
      smartLine.textContent = lastAtex ? `Reprendre sur ${lastAtex} (ATEX).` : 'Personnalisées selon tes usages récents.';
    }
  }

  function labelUsage(app){ const u=getUsage()[app]||{}; return u.count ? `${u.count} lancement${u.count>1?'s':''}` : 'Nouveau'; }
  function pickHref(app){
    if(/atex control/i.test(app)) return 'atex-control.html';
    if(/^epd$/i.test(app)) return 'epd.html';
    if(/is\s*loop/i.test(app)) return 'is-loop.html';
    return '#';
  }

  function renderAtexGroup(){
    const host = document.getElementById('atexGroup'); if(!host) return; host.innerHTML='';
    const last = localStorage.getItem(storageKey(LAST_ATEX_KEY_BASE));
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
      card.onclick = ()=> go(a.href, a.key);
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
      card.addEventListener('click', ()=>{
        if(disabled) return;
        if(group==='ATEX') localStorage.setItem(storageKey(LAST_ATEX_KEY_BASE), app);
        go(href, app);
      });
    });
  }

  function go(href, app){
    bump(app);
    if(href && href !== '#') location.href = href;
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
    setupLogout();
    wireCards();
    renderSmartShortcuts();
    renderAtexGroup();
    console.info('[dashboard] scope', scopeSuffix());
  });
})();
