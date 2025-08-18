// /public/js/subscription_atex.js
(function () {
  const API = (window.API_BASE_URL || '') + '/api';
  const $ = (sel) => document.querySelector(sel);
  const token = () => localStorage.getItem('autonomix_token') || '';
  const authHeaders = () => ({ Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' });

  // tiers: 1=Free, 2=Personal, 3=Pro
  const TIER_NAME = (t) => (t === 3 ? 'Pro' : t === 2 ? 'Personal' : 'Free');
  const TIER_PRICE = { 1: 0, 2: 29, 3: 39 };

  function getAccountId() {
    const u = new URL(window.location.href);
    return u.searchParams.get('account_id') || localStorage.getItem('selected_account_id') || null;
  }

  // ---- API helpers
  async function getMe(accountId) {
    const url = new URL(API + '/me', window.location.origin);
    if (accountId) url.searchParams.set('account_id', accountId);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token() }, cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem('autonomix_token'); location.href = 'login.html'; return null; }
    if (!r.ok) throw new Error('me ' + r.status);
    return r.json();
  }

  async function getCurrentTier(accountId) {
    const r = await fetch(`${API}/subscriptions/ATEX?account_id=${accountId}`, {
      headers: { Authorization: 'Bearer ' + token() }, cache: 'no-store'
    });
    if (r.status === 403) return { tier: 1, source: 'forbidden' }; // fallback visuel
    if (!r.ok) throw new Error('subscriptions ' + r.status);
    return r.json(); // { tier, source }
  }

  async function getOwners(accountId) {
    const r = await fetch(`${API}/accounts/${accountId}/owners`, { headers: { Authorization: 'Bearer ' + token() } });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    return Array.isArray(d.owners) ? d.owners : [];
  }

  async function getMembers(accountId) {
    // route existante chez toi : /api/accounts/members/ATEX?account_id=ID
    const r = await fetch(`${API}/accounts/members/ATEX?account_id=${accountId}`, { headers: { Authorization: 'Bearer ' + token() } });
    if (!r.ok) return { members: [], seats_assigned: 0 };
    const d = await r.json().catch(() => ({}));
    return {
      members: Array.isArray(d.members) ? d.members : [],
      seats_assigned: Number(d.seats_assigned ?? d.members?.length ?? 0)
    };
  }

  async function choosePlan(accountId, tierOrPlan) {
    const body = typeof tierOrPlan === 'number'
      ? { tier: tierOrPlan }
      : { plan: String(tierOrPlan).toLowerCase() };
    const r = await fetch(`${API}/subscriptions/ATEX/choose?account_id=${accountId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(data?.error || ('HTTP ' + r.status));
    return data;
  }

  async function invite(accountId, email, role) {
    const r = await fetch(`${API}/accounts/invite?account_id=${accountId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, role })
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
    return d;
  }

  // ---- Renders
  function setPlanButtonsState(currentTier, myRole) {
    const btnFree = $('#btn-tier-free');
    const btnPer  = $('#btn-tier-personal');
    const btnPro  = $('#btn-tier-pro');

    const map = [
      { btn: btnFree, tier: 1, label: 'Choisir Free' },
      { btn: btnPer,  tier: 2, label: 'Choisir Personal' },
      { btn: btnPro,  tier: 3, label: 'Choisir Pro' },
    ];

    map.forEach(({btn, tier, label}) => {
      if (!btn) return;
      btn.textContent = (tier === currentTier) ? 'Plan actuel' : label;
      btn.classList.toggle('disabled', tier === currentTier || myRole === 'member');
      btn.disabled = (tier === currentTier) || (myRole === 'member');
    });

    // Si member : tooltip simple
    if (myRole === 'member') {
      [btnFree, btnPer, btnPro].forEach(b => { if (b) b.title = 'Seul un owner/admin peut modifier l’abonnement.'; });
    }
  }

  function renderCurrentStatus(tier, owners, membersCount) {
    const txt = $('#currentLicenseText');
    const ob  = $('#ownersBadge');
    if (txt) {
      const price = TIER_PRICE[tier] ?? 0;
      const total = price * (membersCount || 0);
      txt.textContent = `Licence actuelle : ${TIER_NAME(tier)} • Total estimé: ${total} € / mois ( ${membersCount || 0} membre(s) × ${price} € )`;
    }
    if (ob) {
      const names = owners.map(o => o.email || o.name || '').filter(Boolean);
      ob.textContent = names.length ? `Owners: ${names.join(', ')}` : 'Owners: —';
    }
  }

  function renderMembersBlock(members, seatsAssigned) {
    const summary = $('#seatsSummary');
    const list    = $('#membersList');
    if (summary) summary.textContent = `Membres: ${members.length} • Sièges assignés: ${seatsAssigned}`;
    if (list) {
      list.innerHTML = '';
      members.forEach(m => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.border = '1px solid var(--border)';
        row.style.borderRadius = '10px';
        row.style.padding = '8px 10px';
        row.style.marginTop = '8px';

        const left = document.createElement('div');
        left.textContent = `${m.email || ''}  (${m.role || 'member'})`;

        row.appendChild(left);
        list.appendChild(row);
      });
    }
  }

  function wireInvite(accountId, myRole, refresh) {
    const btn = $('#inviteBtn');
    const emailInput = $('#inviteEmail');
    const roleSelect = $('#inviteRole');

    if (!btn || !emailInput || !roleSelect) return;

    // Si member, pas d’invitation
    if (myRole === 'member') {
      btn.disabled = true; btn.classList.add('disabled');
      emailInput.disabled = true; roleSelect.disabled = true;
      btn.title = 'Seul un owner/admin peut inviter des membres.';
      return;
    }

    btn.onclick = async () => {
      const email = (emailInput.value || '').trim().toLowerCase();
      const role  = roleSelect.value || 'member';
      if (!email) { window.UI?.toast ? UI.toast('Email requis') : alert('Email requis'); return; }
      try {
        await invite(accountId, email, role);
        window.UI?.toast ? UI.toast('Invitation envoyée') : null;
        emailInput.value = '';
        await refresh();
      } catch (e) {
        window.UI?.toast ? UI.toast('Erreur invitation: ' + e.message, 2400) : alert('Erreur invitation: ' + e.message);
      }
    };
  }

  function wirePlanButtons(accountId, myRole, refresh, currentTier) {
    const map = [
      { el: $('#btn-tier-free'),     tier: 1, plan: 'free' },
      { el: $('#btn-tier-personal'), tier: 2, plan: 'personal' },
      { el: $('#btn-tier-pro'),      tier: 3, plan: 'pro' },
    ];
    map.forEach(({el, tier, plan}) => {
      if (!el) return;
      el.onclick = async () => {
        if (myRole === 'member') return;
        if (tier === currentTier) return;
        try {
          await choosePlan(accountId, plan); // plan texte accepté côté serveur
          window.UI?.toast ? UI.toast(`Plan ${TIER_NAME(tier)} appliqué`) : null;
          await refresh();
        } catch (e) {
          window.UI?.toast ? UI.toast('Erreur changement de plan: ' + e.message, 2600) : alert('Erreur: ' + e.message);
        }
      };
    });
  }

  // ---- Main
  async function boot() {
    if (!token()) { location.href = 'login.html'; return; }
    const accountId = getAccountId();
    if (!accountId) { location.href = 'dashboard.html'; return; }

    async function loadAll() {
      // rôle
      let me = null;
      try { me = await getMe(accountId); } catch {}
      const myRole = me?.role || 'member';

      // tier
      const sub = await getCurrentTier(accountId);
      let tier = Number(sub?.tier); if (!Number.isFinite(tier) || tier < 1) tier = 1;

      // owners + members
      const [owners, membersObj] = await Promise.all([ getOwners(accountId), getMembers(accountId) ]);
      const members = membersObj.members || [];
      const seats   = Number(membersObj.seats_assigned || members.length || 0);

      // render
      renderCurrentStatus(tier, owners, members.length);
      renderMembersBlock(members, seats);
      setPlanButtonsState(tier, myRole);
      wirePlanButtons(accountId, myRole, loadAll, tier);
      wireInvite(accountId, myRole, loadAll);
    }

    await loadAll();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
