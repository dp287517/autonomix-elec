// public/js/dashboard.js — v14
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
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
    }
  }

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
  function populate(select, accounts, selected){ if(!select) return; select.innerHTML=''; for(const a of accounts){ const opt=document.createElement('option'); opt.value=String(a.account_id); opt.textContent=`${a.account_name} (${a.role})`; select.appendChild(opt); } if(selected) select.value=String(selected); ensureA11Y(select); }
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

  function toggleAtexSubcards(show){
    const container = $('#atex-subcards') || $('.atex-subcards');
    if (!container) return;
    const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
    const makeVisible = show !== undefined ? !!show : isHidden;
    container.style.display = makeVisible ? '' : 'none';
  }

  function setDisabled(target, disabled, reason){
    const el = (typeof target==='string') ? $(target) : target;
    if (!el) return;
    el.classList.toggle('disabled', !!disabled);
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    const clickable = el.matches('a,button') ? el : el.querySelector('a,button');
    if (clickable){
      clickable.onclick = (e)=>{
        if (disabled){ e.preventDefault(); alert(reason || 'Fonction non disponible avec votre abonnement.'); }
      };
      if (!disabled) clickable.removeAttribute('data-disabled-reason');
    }
  }

  function wireAtex(selectedId, tier){
    document.addEventListener('click', (e)=>{
      const main = e.target.closest('#card-atex, [data-app="ATEX"], #app-atex');
      if (main){
        if (e.target.closest('#manage-atex, .manage-sub, [data-action="manage-atex"]')) return;
        toggleAtexSubcards();
      }
    });
    const go = (page)=> (e)=>{ e.preventDefault(); location.href = `${page}?account_id=${encodeURIComponent(selectedId)}`; };
    const c1 = $('#card-atex-control'); const b1 = c1 && (c1.querySelector('a,button') || c1);
    const c2 = $('#card-epd');          const b2 = c2 && (c2.querySelector('a,button') || c2);
    const c3 = $('#card-isloop');       const b3 = c3 && (c3.querySelector('a,button') || c3);
    if (b1){ b1.addEventListener('click', go('atex-control.html')); setDisabled(c1, false); }
    if (b2){ b2.addEventListener('click', go('epd.html'));          setDisabled(c2, !(Number(tier)>=2), 'EPD est disponible avec la licence Personnel ou Pro (≥ 2).'); }
    if (b3){ b3.addEventListener('click', go('is-loop.html'));      setDisabled(c3, !(Number(tier)>=3), 'IS Loop est disponible avec la licence Pro (≥ 3).'); }
    $$('#manage-atex, .js-manage-atex, .manage-sub, [data-action="manage-atex"]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{ e.preventDefault(); location.href = `subscription_atex.html?account_id=${encodeURIComponent(selectedId)}`; });
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
    if (!confirm(`Supprimer l’espace “${current.account_name}” ? Cette action est irréversible.`)) return;
    const r = await api(`/api/accounts/${encodeURIComponent(selectedId)}`, { method:'DELETE' });
    if (!r.ok){ const err = await r.json().catch(()=>({})); alert('Suppression impossible: ' + (err.error || r.status)); return; }
    const u = new URL(location.href);
    u.searchParams.delete('account_id');
    ls.del('autonomix_selected_account_id');
    location.href = u.pathname + u.search;
  }

  async function init(){
    try {
      document.addEventListener('click', async (e)=>{
        const triggerCreate = e.target.closest('#createWorkspace, .js-create-account, [data-action="create-account"]');
        const triggerDelete = e.target.closest('#deleteWorkspace, .js-delete-account, [data-action="delete-account"]');
        if (triggerCreate){ e.preventDefault(); await createAccountFlow(); }
        if (triggerDelete){
          e.preventDefault();
          const r = await api('/api/accounts/mine'); const accounts = await r.json();
          const selected = currentUrlAccount() || ls.get('autonomix_selected_account_id') || (accounts[0] && accounts[0].account_id);
          await deleteAccountFlow(selected, accounts);
        }
      });

      const r = await api('/api/accounts/mine');
      const accounts = await r.json();
      if (!Array.isArray(accounts) || accounts.length === 0){ console.warn('Aucun espace pour cet utilisateur.'); return; }

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
      } catch {}

      wireAtex(selected, tier);
      // toggleAtexSubcards(true);
    } catch (e) {
      console.error('dashboard init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();