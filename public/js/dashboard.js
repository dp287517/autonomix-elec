// public/js/dashboard.js — v13
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k,v){ try { localStorage.setItem(k, v); } catch {} },
    del(k){ try { localStorage.removeItem(k); } catch {} },
  };

  function token(){ return ls.get('autonomix_token') || ''; }
  function logout(){
    ls.del('autonomix_token'); ls.del('autonomix_user'); ls.del('autonomix_selected_account_id');
    location.href = 'login.html';
  }
  async function api(path){
    const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token() } });
    if (r.status === 401) { logout(); throw new Error('unauthenticated'); }
    return r;
  }
  function currentUrlAccount(){
    const p = new URLSearchParams(location.search).get('account_id');
    return p ? String(p) : null;
  }

  // ---- Account select wiring ----
  const SELECTORS = [
    '#headerAccountSelect',        // ton sélecteur dans le bandeau
    '#accountSwitcher',            // autre nom fréquent
    '[data-account-select="true"]',
    '.js-account-select',
    '#accountSelect'               // fallback interne
  ];
  function findSelects(){
    const found = [];
    for (const s of SELECTORS) {
      $$(s).forEach(el => { if (!found.includes(el)) found.push(el); });
    }
    return found;
  }
  function ensureFallbackSelect(){
    if (!$('#accountSelect')){
      const host = $('#accountsSection') || document.body;
      const wrap = document.createElement('div');
      wrap.className = 'account-switcher-fallback';
      wrap.style.margin = '8px 0';
      wrap.innerHTML = `
        <label style="display:block;margin-bottom:4px;">Espace de travail</label>
        <select id="accountSelect" style="min-width:260px;padding:6px;"></select>
      `;
      host.prepend(wrap);
    }
  }
  function populateSelect(select, accounts, selectedId){
    if (!select) return;
    select.innerHTML = '';
    for (const a of accounts){
      const opt = document.createElement('option');
      opt.value = String(a.account_id);
      opt.textContent = `${a.account_name} (${a.role})`
      select.appendChild(opt);
    }
    if (selectedId) select.value = String(selectedId);
  }
  function syncAllSelects(accounts, selectedId){
    const selects = findSelects();
    if (selects.length === 0) ensureFallbackSelect();
    const all = findSelects();
    all.forEach(sel => populateSelect(sel, accounts, selectedId));
    // keep them in sync
    all.forEach(sel => {
      sel.onchange = () => {
        const val = sel.value;
        all.forEach(other => { if (other !== sel) other.value = val; });
        onAccountChanged(val);
      };
    });
  }

  async function onAccountChanged(newId){
    ls.set('autonomix_selected_account_id', String(newId));
    const u = new URL(location.href);
    u.searchParams.set('account_id', String(newId));
    location.href = u.pathname + u.search;
  }

  // ---- Cards & subscription wiring ----
  function el(id){ return (typeof id === 'string' && id.startsWith('#')) ? $(id) : id; }
  function setDisabled(target, disabled, reason){
    const elem = el(target);
    if (!elem) return;
    elem.classList.toggle('disabled', !!disabled);
    elem.setAttribute('aria-disabled', !!disabled ? 'true' : 'false');
    const clickable = elem.matches('a,button') ? elem : elem.querySelector('a,button');
    if (clickable){
      const handler = (e) => {
        const rsn = clickable.getAttribute('data-disabled-reason') || "Fonction non disponible avec votre abonnement.";
        e.preventDefault();
        alert(rsn);
      };
      if (disabled){
        clickable.setAttribute('data-disabled-reason', reason || '');
        clickable.addEventListener('click', handler);
      } else {
        clickable.removeAttribute('data-disabled-reason');
      }
    }
  }

  function toggleAtexSubcards(show){
    const container = $('#atex-subcards') || $('.atex-subcards');
    if (!container) return;
    const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
    const makeVisible = show !== undefined ? !!show : isHidden;
    container.style.display = makeVisible ? '' : 'none';
  }

  function wireAtexMainCard(selectedId, tier){
    // Main ATEX card
    const main = $('#card-atex') || $('[data-app="ATEX"]') || $('#app-atex');
    if (main){
      main.addEventListener('click', (e) => {
        // éviter conflit si click sur bouton "gérer abonnement"
        const t = e.target;
        if (t && (t.closest('.manage-sub') || t.closest('[data-action="manage-sub"]'))) return;
        toggleAtexSubcards();
      });
    }
    // Subcards
    const toUrl = (page) => `${page}?account_id=${encodeURIComponent(selectedId)}`;
    const open = (page) => (e) => { e.preventDefault(); location.href = toUrl(page); };

    const cControl = $('#card-atex-control');
    const cEPD     = $('#card-epd');
    const cIS      = $('#card-isloop');

    if (cControl){
      const btn = cControl.querySelector('a,button') || cControl;
      btn.addEventListener('click', open('atex-control.html'));
      setDisabled(cControl, false);
    }
    if (cEPD){
      const btn = cEPD.querySelector('a,button') || cEPD;
      btn.addEventListener('click', open('epd.html'));
      setDisabled(cEPD, !(Number(tier) >= 2), "EPD est disponible avec l’abonnement Personnel ou Pro (≥ 2).");
    }
    if (cIS){
      const btn = cIS.querySelector('a,button') || cIS;
      btn.addEventListener('click', open('is-loop.html'));
      setDisabled(cIS, !(Number(tier) >= 3), "IS Loop est disponible avec l’abonnement Pro (≥ 3).");
    }

    // Manage subscription buttons
    const manageBtns = [
      '#manage-atex', '.js-manage-atex', '.manage-sub'
    ].flatMap(sel => Array.from(document.querySelectorAll(sel)));
    manageBtns.forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = `subscription_atex.html?account_id=${encodeURIComponent(selectedId)}`;
      });
    });
  }

  async function init(){
    try {
      // 1) Mes espaces
      const r = await api('/api/accounts/mine');
      const accounts = await r.json();
      if (!Array.isArray(accounts) || accounts.length === 0){
        console.warn('Aucun espace pour cet utilisateur.');
        return;
      }

      // 2) Choisir un espace valide: URL > stored > first
      const fromUrl = currentUrlAccount();
      const isMember = (id) => accounts.some(a => String(a.account_id) === String(id));
      let selected = null;
      if (fromUrl && isMember(fromUrl)) selected = String(fromUrl);
      else if (ls.get('autonomix_selected_account_id') && isMember(ls.get('autonomix_selected_account_id'))) selected = String(ls.get('autonomix_selected_account_id'));
      else selected = String(accounts[0].account_id);
      if (ls.get('autonomix_selected_account_id') !== selected) ls.set('autonomix_selected_account_id', selected);

      // 3) Sync selects (header + fallback si besoin)
      syncAllSelects(accounts, selected);

      // 4) Licence ATEX de l'espace sélectionné
      let tier = 0;
      try {
        const lr = await api(`/api/licenses/ATEX?account_id=${encodeURIComponent(selected)}`);
        if (lr.ok) {
          const lic = await lr.json();
          tier = Number(lic.tier || 0);
        }
      } catch (e) {
        console.warn('Licence ATEX non disponible (fallback tier 0).');
      }

      // 5) Câbler les cards
      wireAtexMainCard(selected, tier);
      // Afficher d'emblée les subcards si tu préfères
      // toggleAtexSubcards(true);
    } catch (e) {
      console.error('dashboard init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
