// public/js/dashboard.js — v16 (wrap subcards if missing, toggle robustly)
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const log = (...a)=>{ try{ console.info('[dashboard]', ...a);}catch{} };

  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k,v){ try { localStorage.setItem(k, v); } catch {} },
    del(k){ try { localStorage.removeItem(k); } catch {} },
  };
  function token(){ return ls.get('autonomix_token') || ''; }
  function logout(){ ls.del('autonomix_token'); ls.del('autonomix_user'); ls.del('autonomix_selected_account_id'); location.href='login.html'; }
  async function api(path, opts={}){
    const r = await fetch(path, { ...opts, headers: { ...(opts.headers||{}), Authorization: 'Bearer '+token(), 'Content-Type': 'application/json' }});
    if (r.status === 401) { logout(); throw new Error('unauthenticated'); }
    return r;
  }
  function currentUrlAccount(){ const p=new URLSearchParams(location.search).get('account_id'); return p?String(p):null; }

  // Select wiring
  const SELECTORS = ['#headerAccountSelect','#accountSwitcher','[data-account-select="true"]','.js-account-select','#accountSelect'];
  function findSelects(){ const found=[]; for (const s of SELECTORS){ $$(s).forEach(el=>{ if(!found.includes(el)) found.push(el); }); } return found; }
  function ensureFallbackSelect(){
    if (!$('#accountSelect')){
      const host = $('#accountsSection') || document.body;
      const wrap = document.createElement('div');
      wrap.className = 'account-switcher-fallback';
      wrap.innerHTML = `<label for="accountSelect">Espace de travail</label><select id="accountSelect" style="min-width:240px;padding:6px;"></select>`;
      host.prepend(wrap);
    }
  }
  function populate(select, accounts, selected){ if(!select) return; select.innerHTML=''; for(const a of accounts){ const opt=document.createElement('option'); opt.value=String(a.account_id); opt.textContent=`${a.account_name} (${a.role})`; select.appendChild(opt); } if(selected) select.value=String(selected); }
  function syncAllSelects(accounts, selected){
    let selects = findSelects();
    if (selects.length===0){ ensureFallbackSelect(); selects = findSelects(); }
    selects.forEach(sel=>populate(sel, accounts, selected));
    selects.forEach(sel => sel.onchange = () => { const val=sel.value; selects.forEach(o=>{ if(o!==sel) o.value=val; }); onAccountChanged(val); });
  }
  async function onAccountChanged(newId){
    ls.set('autonomix_selected_account_id', String(newId));
    const u = new URL(location.href); u.searchParams.set('account_id', String(newId)); location.href = u.pathname + u.search;
  }

  // Subcards container: find or build wrapper
  function getOrBuildSubcardsContainer(){
    let container = $('#atex-subcards') || $('.atex-subcards');
    if (container) return container;
    const c1 = $('#card-atex-control') || $('a[href*="atex-control.html"]')?.closest('.card, .app-card, article, section, div');
    const c2 = $('#card-epd') || $('a[href*="epd.html"]')?.closest('.card, .app-card, article, section, div');
    const c3 = $('#card-isloop') || $('a[href*="is-loop.html"]')?.closest('.card, .app-card, article, section, div');
    const items = [c1,c2,c3].filter(Boolean);
    if (items.length === 0) return null;
    const parent = items[0].parentElement;
    if (items.every(x => x.parentElement === parent)) {
      container = parent;
    } else {
      container = document.createElement('div');
      container.id = 'atex-subcards';
      items.forEach(x => container.appendChild(x));
      (parent || document.body).appendChild(container);
    }
    return container;
  }

  function hide(el){
    if (!el) return;
    el.style.display = 'none';
    el.classList.add('hidden');
    el.classList.add('d-none');
  }
  function show(el){
    if (!el) return;
    el.style.removeProperty('display');
    el.classList.remove('hidden');
    el.classList.remove('d-none');
  }
  function toggle(el){
    if (!el) return;
    const hidden = el.style.display === 'none' || el.classList.contains('hidden') || el.classList.contains('d-none') || getComputedStyle(el).display === 'none';
    if (hidden) show(el); else hide(el);
  }

  function setDisabled(target, disabled, reason){
    const el = (typeof target==='string') ? $(target) : target;
    if (!el) return;
    el.classList.toggle('disabled', !!disabled);
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    const clickable = el.matches('a,button') ? el : el.querySelector('a,button,[role="button"], a');
    if (clickable){
      clickable.addEventListener('click', (e)=>{
        if (disabled){ e.preventDefault(); alert(reason || 'Fonction non disponible avec votre abonnement.'); }
      });
    }
  }

  function bindAtexUI(selectedId, tier){
    const main = $('#card-atex') || $('[data-app="ATEX"]') || $('#app-atex');
    const container = getOrBuildSubcardsContainer();
    if (container){ hide(container); }
    log('ATEX main card:', !!main, 'subcards container:', !!container);

    if (main){
      main.addEventListener('click', (e)=>{
        if (e.target.closest('#manage-atex, .js-manage-atex, .manage-sub, [data-action="manage-atex"]')) return;
        toggle(container);
      });
    }

    const toUrl = (page) => `${page}?account_id=${encodeURIComponent(selectedId)}`;
    const go = (page)=> (e)=>{ e.preventDefault(); location.href = toUrl(page); };

    const c1 = $('#card-atex-control') || $('a[href*="atex-control.html"]')?.closest('.card, .app-card, article, section, div');
    const c2 = $('#card-epd') || $('a[href*="epd.html"]')?.closest('.card, .app-card, article, section, div');
    const c3 = $('#card-isloop') || $('a[href*="is-loop.html"]')?.closest('.card, .app-card, article, section, div');
    const b1 = c1 && (c1.querySelector('a,button,[role="button"]') || c1);
    const b2 = c2 && (c2.querySelector('a,button,[role="button"]') || c2);
    const b3 = c3 && (c3.querySelector('a,button,[role="button"]') || c3);

    if (b1){ b1.addEventListener('click', go('atex-control.html')); setDisabled(c1, false); }
    if (b2){ b2.addEventListener('click', go('epd.html'));          setDisabled(c2, !(Number(tier)>=2), 'EPD est disponible avec la licence Personnel ou Pro (≥ 2).'); }
    if (b3){ b3.addEventListener('click', go('is-loop.html'));      setDisabled(c3, !(Number(tier)>=3), 'IS Loop est disponible avec la licence Pro (≥ 3).'); }

    $$('#manage-atex, .js-manage-atex, .manage-sub, [data-action="manage-atex"]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{ e.preventDefault(); location.href = `subscription_atex.html?account_id=${encodeURIComponent(selectedId)}`; });
    });
  }

  async function init(){
    try {
      const r = await api('/api/accounts/mine');
      const accounts = await r.json();
      if (!Array.isArray(accounts) || accounts.length === 0){ return; }

      const fromUrl = currentUrlAccount();
      const isMember = (id) => accounts.some(a => String(a.account_id) === String(id));
      let selected = null;
      if (fromUrl && isMember(fromUrl)) selected = String(fromUrl);
      else if (ls.get('autonomix_selected_account_id') && isMember(ls.get('autonomix_selected_account_id'))) selected = String(ls.get('autonomix_selected_account_id'));
      else selected = String(accounts[0].account_id);
      if (ls.get('autonomix_selected_account_id') !== selected) ls.set('autonomix_selected_account_id', selected);

      syncAllSelects(accounts, selected);

      let tier = 0;
      try { const lr = await api(`/api/licenses/ATEX?account_id=${encodeURIComponent(selected)}`); if (lr.ok){ const lic = await lr.json(); tier = Number(lic.tier || 0); } } catch {}

      bindAtexUI(selected, tier);
    } catch (e) { console.error('dashboard init error:', e); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();