// /public/js/dashboard.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';
  const STORAGE_SEL = 'selected_account_id'; // clé locale pour sauvegarder l’espace choisi
  const token = () => localStorage.getItem('autonomix_token') || '';
  const authHeaders = () => ({ Authorization: 'Bearer ' + token() });

  // --- mapping d’accès aux apps ATEX ---
  const APPS = [
    { key: 'ATEX Control', title: 'ATEX Control', group: 'ATEX', sub: 'Gestion des equipements, inspections, conformite', href: 'atex-control.html', minTier: 0 },
    { key: 'EPD',          title: 'EPD',          group: 'ATEX', sub: 'Dossier / etude explosion',                         href: 'epd.html',           minTier: 1 },
    { key: 'IS Loop',      title: 'IS Loop',      group: 'ATEX', sub: 'Calculs boucles Exi',                                href: 'is-loop.html',       minTier: 2 }
  ];
  const tierName = (t) => (t === 2 ? 'Pro' : t === 1 ? 'Personal' : 'Free');

  // --- utilitaires DOM ---
  const $ = (sel) => document.querySelector(sel);
  const createEl = (tag, attrs = {}, children = []) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    });
    children.forEach((c) => el.appendChild(c));
    return el;
  };

  // --- API calls ---
  async function getMe(accountId = null) {
    const url = new URL(API + '/me', window.location.origin);
    if (accountId != null) url.searchParams.set('account_id', accountId);
    const r = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error('me ' + r.status);
    return r.json();
  }

  async function myAccounts() {
    const r = await fetch(API + '/accounts/mine', { headers: authHeaders(), cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem('autonomix_token'); location.href = 'login.html'; return []; }
    if (!r.ok) throw new Error('accounts/mine ' + r.status);
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  }

  async function fetchLicense(appCode, accountId) {
    const r = await fetch(`${API}/licenses/${encodeURIComponent(appCode)}?account_id=${accountId}`, {
      headers: authHeaders(),
      cache: 'no-store'
    });
    if (r.status === 403) {
      const err = new Error('forbidden_account'); err.code = 403; throw err;
    }
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
    return r.json(); // { account_id, name } (ou {id,name})
  }

  async function deleteAccount(accountId) {
    const r = await fetch(API + '/accounts/' + accountId, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e && e.error ? e.error : ('HTTP ' + r.status));
    }
    return r.json();
  }

  // --- préférences d’espace ---
  function getPreferredAccountIdFromURL() {
    const u = new URL(window.location.href);
    const v = u.searchParams.get('account_id');
    return v ? String(v) : null;
  }
  function getStoredAccountId() {
    const v = localStorage.getItem(STORAGE_SEL);
    return v ? String(v) : null;
  }
  function storeAccountId(id, updateURL = true) {
    localStorage.setItem(STORAGE_SEL, String(id));
    if (updateURL) {
      const u = new URL(window.location.href);
      u.searchParams.set('account_id', String(id));
      window.history.replaceState({}, '', u.toString());
    }
  }

  // --- rendu UI ---
  function renderAccountSwitcher(accounts, selectedId) {
    const host = $('#accountSwitcher');
    if (!host) return;

    host.innerHTML = '';
    const label = createEl('label', { class: 'input-group-text', for: 'accountSelect', text: 'Espace' });
    const select = createEl('select', { id: 'accountSelect', class: 'form-select form-select-sm' });

    accounts.forEach((a) => {
      const id = String(a.id || a.account_id);
      const opt = createEl('option', { value: id, text: `${a.name || ('Espace #' + id)} — ${a.role}` });
      if (String(selectedId) === id) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', async (e) => {
      const id = e.target.value;
      await onAccountChanged(id, accounts);
    });

    const group = createEl('div', { class: 'input-group input-group-sm', style: 'width: 260px;' }, [label, select]);
    host.appendChild(group);
  }

  function renderAtexSubCards(accountId, tier) {
    const sub = $('#atexSubCards');
    if (!sub) return;
    sub.innerHTML = '';

    APPS.filter(a => a.group === 'ATEX').forEach(app => {
      const allowed = (typeof tier === 'number') ? (tier >= app.minTier) : (app.minTier === 0);
      const card = createEl('div', { class: 'app-card' + (allowed ? '' : ' disabled') });
      const title = createEl('div', { class: 'app-title', text: app.title });
      const desc  = createEl('div', { class: 'app-sub',   text: app.sub });
      card.appendChild(title); card.appendChild(desc);

      if (allowed) {
        card.addEventListener('click', () => {
          const url = new URL(window.location.origin + '/' + app.href);
          url.searchParams.set('account_id', accountId);
          location.href = url.toString();
        });
      } else {
        card.title = `Nécessite le plan ${tierName(app.minTier)}`;
      }
      sub.appendChild(card);
    });
  }

  function wireMainAtexCard() {
    const main = $('#cardATEX');
    const sub  = $('#atexSubCards');
    if (!main || !sub) return;
    main.addEventListener('click', (e) => {
      const manage = e.target && e.target.closest && e.target.closest('#manageAtexLink');
      if (manage) return;
      // toggle
      const hidden = getComputedStyle(sub).display === 'none' || sub.classList.contains('d-none') || sub.classList.contains('hidden');
      if (hidden) {
        sub.style.display = 'grid'; sub.classList.remove('d-none'); sub.classList.remove('hidden');
      } else {
        sub.style.display = 'none'; sub.classList.add('hidden');
      }
    });
  }

  function wireActions(accountId, role) {
    const createBtn = $('#createAccountBtn');
    const delBtn    = $('#deleteAccountBtn');
    const manage    = $('#manageAtexLink');

    if (manage) {
      const u = new URL(window.location.origin + '/subscription_atex.html');
      u.searchParams.set('account_id', accountId);
      manage.href = u.toString();
      // si member => pas de gestion abonnement
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

  // --- orchestration ---
  async function resolveAccessibleAccountId(accounts, preferredId) {
    const ids = accounts.map(a => String(a.id || a.account_id));
    let chosen = preferredId && ids.includes(String(preferredId)) ? String(preferredId) : (ids[0] || null);
    if (!chosen) return null;

    try {
      await fetchLicense('ATEX', chosen);
      return chosen;
    } catch (e) {
      if (e.code !== 403) throw e;
      // cherche le premier accessible
      for (const a of accounts) {
        const id = String(a.id || a.account_id);
        try { await fetchLicense('ATEX', id); return id; } catch (err) { if (err.code !== 403) throw err; }
      }
      return null; // aucun accessible (cas extrême)
    }
  }

  async function onAccountChanged(newId, accounts) {
    storeAccountId(newId);
    await renderForAccount(newId, accounts);
  }

  async function renderForAccount(accountId, accounts) {
    // /me pour afficher email + rôle
    try {
      const me = await getMe(accountId);
      const emailEl = $('#userEmail');
      if (emailEl) {
        const r = (me && me.role) ? me.role : (accounts.find(a => String(a.id || a.account_id) === String(accountId))?.role || '');
        emailEl.textContent = `${me.email || ''} • compte #${accountId} • ${r || ''}`;
      }
    } catch (_) {}

    // licence ATEX
    let lic = null;
    try {
      lic = await fetchLicense('ATEX', accountId);
    } catch (e) {
      if (e.code === 403) {
        const chip = $('#chipAtexLicense');
        if (chip) chip.textContent = 'Acces refuse a cet espace';
        renderAtexSubCards(accountId, null);
        const role = accounts.find(a => String(a.id || a.account_id) === String(accountId))?.role || 'member';
        wireActions(accountId, role);
        return;
      }
      console.error(e); alert('Erreur chargement licence.');
      return;
    }

    const chip = $('#chipAtexLicense');
    if (chip) {
      let label = (lic && typeof lic.tier === 'number') ? ('Licence: ' + tierName(lic.tier)) : 'Licence: Free (par defaut)';
      if (lic && lic.source === 'seatful' && lic.assigned === false) label += ' • siege requis';
      chip.textContent = label;
    }

    const tier = (lic && typeof lic.tier === 'number') ? lic.tier : 0;
    renderAtexSubCards(accountId, tier);

    const role = accounts.find(a => String(a.id || a.account_id) === String(accountId))?.role || 'member';
    wireActions(accountId, role);
    wireMainAtexCard();
  }

  async function boot() {
    // protection basique
    if (!token()) { location.href = 'login.html'; return; }

    // bouton logout
    const logout = $('#logoutBtn');
    if (logout) {
      logout.onclick = () => { localStorage.removeItem('autonomix_token'); localStorage.removeItem('autonomix_user'); location.href = 'login.html'; };
    }

    try {
      const accounts = await myAccounts(); // 200 même si aucun (via middleware basic côté serveur)
      if (!accounts.length) {
        // aucun espace: l’UI reste affichée, seul le bouton "Créer un espace" sera utile
        renderAccountSwitcher([], null);
        wireActions(null, 'member');
        return;
      }

      // choix de l’espace
      const fromURL = getPreferredAccountIdFromURL();
      const fromStore = getStoredAccountId();
      const fallback = String(accounts[0].id || accounts[0].account_id);
      let preferred = fromURL || fromStore || fallback;

      // résout un espace réellement accessible (évite le 403 au premier chargement)
      const accessible = await resolveAccessibleAccountId(accounts, preferred);
      if (!accessible) {
        // aucun espace accessible (cas très rare) → on laisse l’UI minimale
        renderAccountSwitcher(accounts, preferred);
        return;
      }

      storeAccountId(accessible);
      renderAccountSwitcher(accounts, accessible);
      await renderForAccount(accessible, accounts);
    } catch (e) {
      console.error(e);
      alert('Erreur au chargement du tableau de bord.');
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
