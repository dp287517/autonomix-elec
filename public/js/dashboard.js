// public/js/dashboard.js — v15 (self-binding + diagnostics)
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const log = (...a)=>{ try{ console.info('[dashboard]', ...a);}catch{} };
  const warn = (...a)=>{ try{ console.warn('[dashboard]', ...a);}catch{} };

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

  // ---- A11Y for header select ----
  function ensureA11Y(select){
    if (!select) return;
    if (!select.id) select.id = 'headerAccountSelect';
    let label = document.querySelector(`label[for="${select.id}"]`);
    if (!label){
      label = document.createElement('label');
      label.setAttribute('for', select.id);
      label.textContent = 'Espace de travail';
      label.style.position='absolute'; label.style.left='-9999px';
      select.parentElement && select.parentElement.prepend(label);
      log('A11Y label injected for', '#'+select.id);
    }
  }

  // ---- account selects ----
  const SELECTORS = ['#headerAccountSelect','#accountSwitcher','[data-account-select="true"]','.js-account-select','#accountSelect'];
  function findSelects(){ const found=[]; for (const s of SELECTORS){ $$(s).forEach(el=>{ if(!found.includes(el)) found.push(el); }); } return found; }
  function ensureFallbackSelect(){
    if (!$('#accountSelect')){
      const host = $('#accountsSection') || document.body;
      const wrap = document.createElement('div');
      wrap.className = 'account-switcher-fallback';
      wrap.innerHTML = `<label for="accountSelect">Espace de travail</label><select id="accountSelect" style="min-width:240px;padding:6px;"></select>`;
      host.prepend(wrap);
      log('Fallback select injected');
    }
  }
  function populate(select, accounts, selected){ if(!select) return; select.innerHTML=''; for(const a of accounts){ const opt=document.createElement('option'); opt.value=String(a.account_id); opt.textContent=`${a.account_name} (${a.role})`; select.appendChild(opt); } if(selected) select.value=String(selected); ensureA11Y(select); }
  function syncAllSelects(accounts, selected){
    let selects = findSelects();
    if (selects.length===0){ ensureFallbackSelect(); selects = findSelects(); }
    selects.forEach(sel=>populate(sel, accounts, selected));
    selects.forEach(sel => sel.onchange = () => {
      const val=sel.value; selects.forEach(o=>{ if(o!==sel) o.value=val; }); onAccountChanged(val);
    });
    log('Account selects bound:', selects.map(s=>('#'+(s.id||s.name||'unnamed'))));
  }
  async function onAccountChanged(newId){
    ls.set('autonomix_selected_account_id', String(newId));
    const u = new URL(location.href); u.searchParams.set('account_id', String(newId)); location.href = u.pathname + u.search;
  }

  // ---- ATEX card detection (robust) ----
  function findAtexMainCard(){
    const byId = $('#card-atex') || $('[data-app="ATEX"]') || $('#app-atex');
    if (byId) return byId;
    const candidates = $$('[data-card], .card, .app-card, article, section, div');
    let best = null;
    for (const el of candidates){
      const txt = (el.textContent || '').toLowerCase();
      if (txt.includes('atex')){
        if (txt.includes('atex control') || txt.includes('epd') || txt.includes('is loop')) continue;
        best = el; break;
      }
    }
    return best;
  }
  function findAtexSubcardsContainer(){
    const c = $('#atex-subcards') || $('.atex-subcards');
    if (c) return c;
    const main = findAtexMainCard();
    if (main){
      const sib = main.nextElementSibling;
      if (sib && /subcards|cards|grid|row/i.test(sib.className||'')) return sib;
    }
    const ctrl = $('#card-atex-control') || $('a[href*="atex-control.html"]')?.closest('.card, .app-card, article, section, div');
    const epd  = $('#card-epd') || $('a[href*="epd.html"]')?.closest('.card, .app-card, article, section, div');
    if (ctrl && epd && ctrl.parentElement === epd.parentElement) return ctrl.parentElement;
    return null;
  }

  function toggleContainer(container, show){
    if (!container) return;
    const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none' || container.classList.contains('hidden');
    const makeVisible = show !== undefined ? !!show : isHidden;
    container.style.display = makeVisible ? '' : 'none';
    container.classList.toggle('hidden', !makeVisible);
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
    const main = findAtexMainCard();
    const subc = findAtexSubcardsContainer();
    log('ATEX main card:', main, 'subcards container:', subc);

    if (main){
      main.addEventListener('click', (e)=>{
        if (e.target.closest('#manage-atex, .js-manage-atex, .manage-sub, [data-action="manage-atex"]')) return;
        toggleContainer(subc, undefined);
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

    const attachManage = (btn)=> btn && btn.addEventListener('click', (e)=>{ e.preventDefault(); location.href = `subscription_atex.html?account_id=${encodeURIComponent(selectedId)}`; });
    $$('#manage-atex, .js-manage-atex, .manage-sub, [data-action="manage-atex"]').forEach(attachManage);
    document.addEventListener('click', (e)=>{
      const a = e.target.closest('a,button');
      if (!a) return;
      const t = (a.textContent || '').toLowerCase().trim();
      if (t.includes('gérer l’abonnement') || t.includes('gerer l’abonnement') || t.includes('manage subscription')){
        e.preventDefault(); location.href = `subscription_atex.html?account_id=${encodeURIComponent(selectedId)}`;
      }
    });
  }

  async function createAccountFlow(){
    const name = prompt('Nom du nouvel espace :', 'Nouvel espace');
    if (!name) return;
    const r = await api('/api/accounts', { method:'POST', body: JSON.stringify({ name }) });
    if (!r.ok){ const err = await r.json().catch(()=>({})); alert('Création impossible: ' + (err.error || r.status)); return; }
    const acc = await r.json();
    ls.set('autonomix_selected_account_id', String(acc.account_id));
    const u = new URL(location.href); u.searchParams.set('account_id', String(acc.account_id)); location.href = u.pathname + u.search;
  }
  async function deleteAccountFlow(selectedId, accounts){
    const current = accounts.find(a => String(a.account_id) === String(selectedId));
    if (!current){ alert("Aucun espace sélectionné."); return; }
    if (current.role !== 'owner'){ alert("Seul l'owner peut supprimer cet espace."); return; }
    if (!confirm(`Supprimer l’espace “${current.account_name}” ?`)) return;
    const r = await api(`/api/accounts/${encodeURIComponent(selectedId)}`, { method:'DELETE' });
    if (!r.ok){ const err = await r.json().catch(()=>({})); alert('Suppression impossible: ' + (err.error || r.status)); return; }
    const u = new URL(location.href); u.searchParams.delete('account_id'); ls.del('autonomix_selected_account_id'); location.href = u.pathname + u.search;
  }
  function bindCreateDelete(){
    document.addEventListener('click', async (e)=>{
      const triggerCreate = e.target.closest('#createWorkspace, .js-create-account, [data-action="create-account"]');
      const triggerDelete = e.target.closest('#deleteWorkspace, .js-delete-account, [data-action="delete-account"]');
      const txt = (e.target.closest('a,button')?.textContent || '').toLowerCase();
      if (triggerCreate || txt.includes('créer un espace') || txt.includes('create workspace')){ e.preventDefault(); await createAccountFlow(); }
      if (triggerDelete || txt.includes('supprimer l’espace') || txt.includes('delete workspace')){
        e.preventDefault();
        const r = await api('/api/accounts/mine'); const accounts = await r.json();
        const selected = currentUrlAccount() || ls.get('autonomix_selected_account_id') || (accounts[0] && accounts[0].account_id);
        await deleteAccountFlow(selected, accounts);
      }
    });
  }

  async function init(){
    try {
      bindCreateDelete();

      const r = await api('/api/accounts/mine');
      const accounts = await r.json();
      if (!Array.isArray(accounts) || accounts.length === 0){ warn('Aucun espace pour cet utilisateur.'); return; }

      const fromUrl = currentUrlAccount();
      const isMember = (id) => accounts.some(a => String(a.account_id) === String(id));
      let selected = null;
      if (fromUrl && isMember(fromUrl)) selected = String(fromUrl);
      else if (ls.get('autonomix_selected_account_id') && isMember(ls.get('autonomix_selected_account_id'))) selected = String(ls.get('autonomix_selected_account_id'));
      else selected = String(accounts[0].account_id);
      if (ls.get('autonomix_selected_account_id') !== selected) ls.set('autonomix_selected_account_id', selected);

      syncAllSelects(accounts, selected);

      let tier = 0;
      try {
        const lr = await api(`/api/licenses/ATEX?account_id=${encodeURIComponent(selected)}`);
        if (lr.ok){ const lic = await lr.json(); tier = Number(lic.tier || 0); }
      } catch { /* ignore */ }

      bindAtexUI(selected, tier);

      log('Init done. Selected account:', selected, 'tier:', tier);
    } catch (e) {
      console.error('dashboard init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
