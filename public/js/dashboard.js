// /public/js/dashboard.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'selected_account_id';

  // ---------- helpers ----------
  const token = () => localStorage.getItem('autonomix_token') || '';
  const authHeaders = () => ({ Authorization: 'Bearer ' + token() });
  const $ = (sel) => document.querySelector(sel);

  // tiers backend: 1=Free, 2=Personal, 3=Pro
  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite', href: 'atex-control.html', minTier: 1 },
    { key: 'EPD',          title: 'EPD',          group: 'ATEX', sub: 'Dossier / etude explosion',                         href: 'epd.html',           minTier: 2 },
    { key: 'IS Loop',      title: 'IS Loop',      group: 'ATEX', sub: 'Calculs boucles Exi',                                href: 'is-loop.html',       minTier: 3 }
  ];
  const tierName = (t) => (t === 3 ? 'Pro' : t === 2 ? 'Personal' : 'Free');

  // Styles pour le verrouillage visuel des cards
  function ensureLockStyles() {
    if (document.getElementById('cards-lock-css')) return;
    const css = `
      .app-card{ position:relative; border-radius:14px; padding:12px; background:#fff; box-shadow:0 2px 10px rgba(0,0,0,.06); transition:transform .05s ease; }
      .app-card:not(.disabled):hover{ transform:translateY(-1px); }
      .app-card.disabled{ opacity:.55; filter:grayscale(0.15); cursor:not-allowed; }
      .app-card .app-title{ font-weight:700; margin-bottom:4px; }
      .app-card .app-sub{ font-size:.9rem; opacity:.8; }
      .app-card.disabled .lock{
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        text-align:center; padding:10px; font-weight:700; color:#111; background:linear-gradient(transparent 35%, rgba(255,255,255,.92) 60%);
        pointer-events:none;
      }
      .app-card.disabled .lock small{ display:block; font-weight:500; opacity:.8; margin-top:4px; }
      #atexSubCards.hidden{ display:none !important; }
    `;
    const tag = document.createElement('style');
    tag.id = 'cards-lock-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ---------- API ----------
  async function myAccounts() {
    const r = await fetch(`${API}/accounts/mine`, { headers: authHeaders(), cache: 'no-store' });
    if (r.status === 401) {
      localStorage.removeItem('autonomix_token');
      location.href = 'login.html';
      return [];
    }
    if (!r.ok) throw new Error(`accounts/mine ${r.status}`);
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  }

  async function getMe(accountId) {
    const url = new URL(API + '/me', window.location.origin);
    if (accountId != null) url.searchParams.set('account_id', accountId);
    const r = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error('me ' + r.status);
    return r.json();
  }

  async function fetchLicense(appCode, accountId) {
    const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, {
      headers: authHeaders(),
      cache: 'no-store'
    });
    if (r.status === 403) { const e = new Error('forbidden'); e.code = 403; throw e; }
    if (!r.ok) throw new Error('licenses ' + r.status);
    return r.json();
  }

  async function createAccount(name) {
    const r = await fetch(API + '/accounts', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e && e.error ? e.error : ('HTTP ' + r.status));
    }
    return r.json(); // {account_id, name}
  }

  async function deleteAccount(accountId) {
    const r = await fetch(API + '/accounts/' + accountId, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e && e.error ? e.error : ('HTTP ' + r.status));
    }
    return r.json();
  }

  // ---------- préférences ----------
  function getPreferredAccountIdFromURL() {
    const u = new URL(window.location.href);
    return u.searchParams.get('account_id');
  }
  function getStoredAccountId() {
    return localStorage.getItem(STORAGE_SEL);
  }
  function storeAccountId(id, updateURL = true) {
    localStorage.setItem(STORAGE_SEL, String(id));
    if (updateURL) {
      const u = new URL(window.location.href);
      u.searchParams.set('account_id', String(id));
      window.history.replaceState({}, '', u.toString());
    }
  }

  // ---------- UI ----------
  function renderAccountSwitcher(accounts, selectedId) {
    const select = $('#accountSwitcher'); // <select id="accountSwitcher">
    if (!select) return;

    select.innerHTML = '';
    if (!accounts.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'Aucun espace';
      select.appendChild(opt);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    for (const a of accounts) {
      const id = String(a.id || a.account_id);
      const name = a.name || ('Espace #' + id);
      const role = a.role || '';
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${name} — ${role}`;
      if (String(selectedId) === id) opt.selected = true;
      select.appendChild(opt);
    }

    select.onchange = async (e) => {
      const id = e.target.value;
      await onAccountChanged(id, accounts);
    };
  }

  // (corrigée) — cards visibles, mais verrouillées si non incluses dans le plan
  function renderAtexSubCards(accountId, tier) {
    ensureLockStyles();
    const sub = $('#atexSubCards');
    if (!sub) return;
    sub.innerHTML = '';

    // force tier: si l’API renvoie 0/null → Free (1)
    let t = Number(tier);
    if (!Number.isFinite(t) || t < 1) t = 1;

    APPS.filter(a => a.group === 'ATEX').forEach(app => {
      const allowed = t >= app.minTier;
      const card = document.createElement('div');
      card.className = 'app-card' + (allowed ? '' : ' disabled');

      const title = document.createElement('div');
      title.className = 'app-title';
      title.textContent = app.title;

      const desc = document.createElement('div');
      desc.className = 'app-sub';
      desc.textContent = app.sub;

      card.appendChild(title);
      card.appendChild(desc);

      if (allowed) {
        // clic = ouvre l’app
        card.addEventListener('click', () => {
          const url = new URL(window.location.origin + '/' + app.href);
          url.searchParams.set('account_id', accountId);
          location.href = url.toString();
        });
      } else {
        // bandeau de verrouillage
        const need = (app.minTier === 3 ? 'Pro' : app.minTier === 2 ? 'Personal' : 'Free');
        const lock = document.createElement('div');
        lock.className = 'lock';
        lock.innerHTML = `Débloquez avec niveau ${need}<small>(actuellement: ${tierName(t)})</small>`;
        card.appendChild(lock);
        card.title = `Nécessite le plan ${need}`;
      }

      sub.appendChild(card);
    });
  }

  function wireMainAtexCard() {
    const main = $('#cardATEX');
    const sub  = $('#atexSubCards');
    if (!main || !sub) return;
    main.addEventListener('click', (e) => {
      const isManage = e.target && e.target.closest && e.target.closest('#manageAtexLink');
      if (isManage) return;
      const hidden = getComputedStyle(sub).display === 'none' || sub.classList.contains('d-none') || sub.classList.contains('hidden');
      if (hidden) { sub.style.display = 'grid'; sub.classList.remove('d-none'); sub.classList.remove('hidden'); }
      else { sub.style.display = 'none'; sub.classList.add('hidden'); }
    });
  }

  function wireActions(accountId, role) {
    const createBtn = $('#createAccountBtn');
    const delBtn    = $('#deleteAccountBtn');
    const manage    = $('#manageAtexLink');

    if (manage) {
      const u = new URL(window.location.origin + '/subscription_atex.html');
      if (accountId != null) u.searchParams.set('account_id', accountId);
      manage.href = u.toString();
      if (role !== 'owner' && role !== 'admin') manage.classList.add('disabled');
      else manage.classList.remove('disabled');
    }

    if (createBtn) {
      createBtn.onclick = async () => {
        const name = prompt('Nom du nouvel espace de travail ?');
        if (!name || !name.trim()) return;
        try {
          const acc = await createAccount(name.trim());
          const newId = String(acc.account_id != null ? acc.account_id : acc.id);
          storeAccountId(newId);
          alert('Espace créé. Choisis maintenant un abonnement.');
          const url = new URL(window.location.origin + '/subscription_atex.html');
          url.searchParams.set('account_id', newId);
          location.href = url.toString();
        } catch (e) {
          alert('Erreur création espace: ' + e.message);
        }
      };
    }

    if (delBtn) {
      delBtn.onclick = async () => {
        if (role !== 'owner') { alert("Seul l'owner peut supprimer l'espace."); return; }
        if (!confirm('Supprimer cet espace ?')) return;
        if (!confirm('Action irréversible. Confirmer ?')) return;
        try {
          await deleteAccount(accountId);
          localStorage.removeItem(STORAGE_SEL);
          location.href = 'dashboard.html';
        } catch (e) {
          alert('Erreur suppression: ' + e.message);
        }
      };
    }
  }

  async function onAccountChanged(newId, accounts) {
    storeAccountId(newId);
    await renderForAccount(newId, accounts);
  }

  async function renderForAccount(accountId, accounts) {
    // Profil/rôle
    try {
      const me = await getMe(accountId);
      const r = (me && me.role) ? me.role : (accounts.find(a => String(a.id || a.account_id) === String(accountId))?.role || '');
      const emailEl = $('#userEmail');
      if (emailEl) emailEl.textContent = `${me.email || ''} • compte #${accountId} • ${r || ''}`;
      wireActions(accountId, r || 'member');
    } catch (_) { /* noop */ }

    // Licence
    let lic = null;
    try {
      lic = await fetchLicense('ATEX', accountId); // { tier, source }
    } catch (e) {
      if (e.code === 403) {
        const chip = $('#chipAtexLicense');
        if (chip) chip.textContent = 'Acces refuse a cet espace';
        renderAtexSubCards(accountId, 1); // fallback visuel Free
        return;
      }
      console.error(e); alert('Erreur chargement licence.');
      return;
    }

    // tier sécurisé (force >=1)
    let t = Number(lic && lic.tier);
    if (!Number.isFinite(t) || t < 1) t = 1;

    const chip = $('#chipAtexLicense');
    if (chip) chip.textContent = `Licence: ${tierName(t)}`;
    renderAtexSubCards(accountId, t);

    wireMainAtexCard();
  }

  async function resolveAccessibleAccountId(accounts, preferredId) {
    const ids = accounts.map(a => String(a.id || a.account_id));
    let chosen = preferredId && ids.includes(String(preferredId)) ? String(preferredId) : (ids[0] || null);
    if (!chosen) return null;

    try {
      await fetchLicense('ATEX', chosen);
      return chosen;
    } catch (e) {
      if (e.code !== 403) throw e;
      for (const a of accounts) {
        const id = String(a.id || a.account_id);
        try { await fetchLicense('ATEX', id); return id; } catch (err) { if (err.code !== 403) throw err; }
      }
      return null;
    }
  }

  async function boot() {
    if (!token()) { location.href = 'login.html'; return; }

    // logout
    const logout = $('#logoutBtn');
    if (logout) {
      logout.onclick = () => {
        localStorage.removeItem('autonomix_token');
        localStorage.removeItem('autonomix_user');
        localStorage.removeItem(STORAGE_SEL);
        location.href = 'login.html';
      };
    }

    try {
      const accounts = await myAccounts();
      // sélecteur dès maintenant (même vide) pour feedback UI
      renderAccountSwitcher(accounts, null);

      if (!accounts.length) {
        wireActions(null, 'member');
        return;
      }

      const fallback = String(accounts[0].id || accounts[0].account_id);
      const preferred = getPreferredAccountIdFromURL() || getStoredAccountId() || fallback;
      const accessible = await resolveAccessibleAccountId(accounts, preferred);
      const finalId = accessible || fallback;

      storeAccountId(finalId);
      renderAccountSwitcher(accounts, finalId);
      await renderForAccount(finalId, accounts);
    } catch (e) {
      console.error(e);
      alert('Erreur au chargement du tableau de bord.');
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
