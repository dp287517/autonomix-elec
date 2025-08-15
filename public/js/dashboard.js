// public/js/dashboard.js — listing & sélection d'espaces robuste
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function token(){ try { return localStorage.getItem('autonomix_token') || ''; } catch { return ''; } }
  function saveSelectedAccount(id){ try { localStorage.setItem('autonomix_selected_account_id', String(id)); } catch{} }
  function getSelectedAccount(){ try { return localStorage.getItem('autonomix_selected_account_id'); } catch { return null; } }
  function logout(){
    try{
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
      localStorage.removeItem('autonomix_selected_account_id');
    }catch{}
    location.href = 'login.html';
  }

  async function api(path){
    const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token() }});
    if (r.status === 401) { logout(); throw new Error('unauthenticated'); }
    return r;
  }

  function buildSelect(accounts, currentId){
    let select = $('#accountSelect');
    if (!select) {
      // créer un select minimal si absent
      const holder = $('#accountsSection') || $('.accounts') || $('main') || document.body;
      const wrap = document.createElement('div');
      wrap.className = 'account-switcher';
      wrap.innerHTML = `
        <label style="display:block;margin:8px 0;">Espace de travail</label>
        <select id="accountSelect" style="min-width:260px;padding:6px;"></select>
        <span id="accountRole" style="margin-left:8px;opacity:.7;"></span>
      `;
      holder.prepend(wrap);
      select = $('#accountSelect');
    }
    select.innerHTML = '';
    accounts.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.account_id;
      opt.textContent = `${a.account_name} (${a.role})`;
      select.appendChild(opt);
    });
    if (currentId) select.value = String(currentId);
    const roleSpan = $('#accountRole');
    const cur = accounts.find(a => String(a.account_id) === String(select.value));
    if (roleSpan && cur) roleSpan.textContent = cur.role === 'owner' ? 'Owner' : 'Member';
    select.onchange = () => {
      const val = select.value;
      saveSelectedAccount(val);
      // recharger la page principale avec le bon ?account_id
      const u = new URL(location.href);
      u.searchParams.set('account_id', val);
      location.href = u.pathname + u.search;
    };
  }

  async function load(){
    try {
      // 1) Mes espaces
      const r = await api('/api/accounts/mine');
      const accounts = await r.json();
      if (!Array.isArray(accounts) || accounts.length === 0) {
        // pas d'espace: UI minimale
        buildSelect([], null);
        return;
      }
      // 2) Choisir un espace valide
      const stored = getSelectedAccount();
      let selected = stored && accounts.some(a => String(a.account_id) === String(stored)) ? stored : String(accounts[0].account_id);
      if (!stored || stored !== selected) saveSelectedAccount(selected);
      buildSelect(accounts, selected);

      // 3) Charger la licence ATEX de l'espace sélectionné pour activer/désactiver les cards
      const lr = await api(`/api/licenses/ATEX?account_id=${encodeURIComponent(selected)}`);
      if (lr.ok) {
        const lic = await lr.json(); // {tier: number}
        const tier = Number(lic.tier || 0);
        // Gérer l'état des sous-cards (grisé / clickable)
        const card = (id) => $(id);
        const setState = (el, enabled) => {
          if (!el) return;
          el.classList.toggle('disabled', !enabled);
          const btn = el.tagName === 'A' ? el : el.querySelector('a,button');
          if (btn) {
            btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            btn.tabIndex = enabled ? 0 : -1;
            if (!enabled) btn.addEventListener('click', (e)=>{ e.preventDefault(); });
          }
        };
        // Règles: tier0 Control, tier2 EPD, tier3 IS Loop
        setState($('#card-atex-control'), true);
        setState($('#card-epd'), tier >= 2);
        setState($('#card-isloop'), tier >= 3);
      }
    } catch (e) {
      console.error('dashboard init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();