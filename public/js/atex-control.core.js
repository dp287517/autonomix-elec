// public/js/atex-control.core.js — v14 
(function () {
  if (window.lucide) {
    try { window.lucide.createIcons(); } catch {}
  }

  // ---------- Account helper ----------
  function getAccountId() {
    try {
      const u = new URL(window.location.href);
      const fromQS = u.searchParams.get('account_id');
      const stored = localStorage.getItem('app_account_id');
      const id = fromQS || stored || '10';
      if (id !== stored) localStorage.setItem('app_account_id', id);
      return id;
    } catch { return '10'; }
  }
  const ACCOUNT_ID = getAccountId();
  function withAccount(path) {
    return `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(ACCOUNT_ID)}`;
  }

  // ---------- API endpoints ----------
  const API = {
    secteurs: withAccount('/api/atex-secteurs'),
    equipments: withAccount('/api/atex-equipments'),
    equipment: (id) => withAccount('/api/atex-equipments/' + id),
    inspect: withAccount('/api/atex-inspect'),
    help: (id) => withAccount('/api/atex-help/' + id),
    chat: withAccount('/api/atex-chat'),                 // POST: envoi message + persistance par utilisateur
    chatFor: (id) => withAccount('/api/atex-chat/' + id),// GET: thread d'un équipement (user courant) | DELETE: effacer
    chatThreads: withAccount('/api/atex-chat-threads'),  // GET: tous les threads (user courant)
    photo: (id) => withAccount('/api/atex-photo/' + id),
    // viewer-friendly endpoint (attachments/photo normalisés)
    equipViewer: (id) => withAccount('/api/equip/' + id),

    // Import
    importExcel: withAccount('/api/atex-import-excel'),
    importColumns: withAccount('/api/atex-import-columns'),
    importCsvTpl: withAccount('/api/atex-import-template'),
    importXlsxTpl: withAccount('/api/atex-import-template.xlsx'),
  };
  const bodyWithAccount = (o = {}) => Object.assign({}, o, { account_id: ACCOUNT_ID });

  // ---------- State / Storage ----------
  let equipments = [];
  let currentIA = null;

  const THREADS_KEY = 'atexThreadsByEquip_v2';
  const HISTORY_KEY = 'atexHistory_v2';
  const HELP_CACHE_KEY = 'atexHelpCache_v2';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function getThreads() {
    try { return JSON.parse(localStorage.getItem(THREADS_KEY) || '{}'); } catch { return {}; }
  }
  function setThreads(o) {
    localStorage.setItem(THREADS_KEY, JSON.stringify(o || {}));
  }
  function getThread(id) {
    const all = getThreads();
    return Array.isArray(all[id]) ? all[id] : [];
  }
  function setThread(id, arr) {
    const all = getThreads();
    all[id] = arr || [];
    setThreads(all);
    if (currentIA === id) {
      renderThread($('#iaThread'), arr);
      renderThread($('#chatThread'), arr);
    }
  }
  function deleteThread(id) {
    const all = getThreads();
    delete all[id];
    setThreads(all);
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function setHistory(h) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h || []));
    renderHistory();
    renderHistoryChat();
  }
  function addToHistory(item) {
    const h = getHistory();
    const ix = h.findIndex((x) => x.id === item.id);
    if (ix >= 0) h[ix] = Object.assign(h[ix], item);
    else h.unshift(item);
    setHistory(h.slice(0, 200));
  }
  function removeFromHistory(id) {
    const h = getHistory().filter((x) => x.id !== id);
    setHistory(h);
  }
  function clearAllHistory() {
    setHistory([]);
    setThreads({});
    $('#iaHistoryListChat').innerHTML = '';
    $('#chatHtml').innerHTML = '';
    $('#chatThread').innerHTML = '';
    $('#chatHeader').textContent = '';
    $('#chatEnriched').style.display = 'none';
    currentIA = null;
  }

  function getHelpCache() {
    try { return JSON.parse(localStorage.getItem(HELP_CACHE_KEY) || '{}'); } catch { return {}; }
  }
  function setHelpCache(o) { localStorage.setItem(HELP_CACHE_KEY, JSON.stringify(o || {})); }
  function cacheHelp(id, payload) {
    const m = getHelpCache();
    m[id] = payload;
    setHelpCache(m);
  }
  function getCachedHelp(id) {
    const m = getHelpCache();
    return m[id];
  }
  function deleteHelpCache(id) {
    const m = getHelpCache();
    delete m[id];
    setHelpCache(m);
  }

  function toast(msg, variant = 'primary') {
    const id = 't' + Date.now();
    const html = `<div id="${id}" class="toast text-bg-${variant} border-0 mb-2" role="alert"><div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`;
    const cont = document.getElementById('toasts') || (function () {
      const d = document.createElement('div');
      d.id = 'toasts';
      d.className = 'toast-container position-fixed top-0 end-0 p-3';
      document.body.appendChild(d);
      return d;
    })();
    cont.insertAdjacentHTML('beforeend', html);
    const t = new bootstrap.Toast(document.getElementById(id), { delay: 2500 });
    t.show();
    setTimeout(() => document.getElementById(id)?.remove(), 3000);
  }

  function fmtDate(d) {
    if (!d) return 'N/A';
    const date = new Date(d);
    if (isNaN(date)) return d;
    const dd = String(date.getDate()).padStart(2, '0'),
      mm = String(date.getMonth() + 1).padStart(2, '0'),
      yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  function addMonthsISO(dateISO, nbMonths) {
    const d = new Date(dateISO);
    if (isNaN(d)) return null;
    d.setMonth(d.getMonth() + (Number(nbMonths) || 0));
    return d.toISOString();
  }

  function computeStatus(nextDate) {
    if (!nextDate) return 'ok';
    const d = new Date(nextDate);
    if (isNaN(d)) return 'ok';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dn = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((dn - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'late';
    if (diffDays === 0) return 'today';
    if (diffDays <= 30) return 'soon';
    return 'ok';
  }
  function statusBadge(st) {
    if (st === 'late') return '<span class="badge badge-st late">En retard</span>';
    if (st === 'today') return '<span class="badge badge-st today">Aujourd’hui</span>';
    if (st === 'soon') return '<span class="badge badge-st soon">Bientôt</span>';
    return '<span class="badge badge-st ok">OK</span>';
  }

  // ---------- IA threads <-> server ----------
  function normalizeServerIaHistory(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
    return arr
      .map(m => (!m || typeof m !== 'object') ? null : {
        role: (m.role === 'assistant' ? 'assistant' : 'user'),
        content: String(m.content || ''),
      })
      .filter(Boolean);
  }
  function restoreThreadsFromEquipments(list) {
    // Fallback legacy (si certains équipements ont encore ia_history côté équipement)
    const all = getThreads();
    let restored = 0;
    (list || []).forEach(eq => {
      if (!eq || !eq.id) return;
      const local = all[eq.id];
      if (Array.isArray(local) && local.length) return; // déjà présent
      const fromDb = normalizeServerIaHistory(eq.ia_history);
      if (fromDb.length) {
        all[eq.id] = fromDb;
        restored++;
      }
    });
    if (restored) {
      setThreads(all);
      if (currentIA) {
        renderThread($('#iaThread'), getThread(currentIA));
        renderThread($('#chatThread'), getThread(currentIA));
      }
    }
  }

  async function restoreUserThreads() {
    // Nouvelle restauration PAR UTILISATEUR (table atex_chat_threads)
    try {
      const r = await fetch(API.chatThreads);
      if (!r.ok) throw new Error('Erreur chargement threads');
      const arr = await r.json(); // [{equipment_id, history, updated_at}, ...]
      const all = getThreads();
      let restored = 0;
      (arr || []).forEach(row => {
        const id = row.equipment_id;
        const thread = Array.isArray(row.history) ? row.history : [];
        if (thread.length) {
          all[id] = thread;
          restored++;
          // Alimente l'historique de droite si vide
          const firstAssistant = thread.find(m => m.role === 'assistant');
          addToHistory({
            id,
            composant: `Équipement ${id}`,
            content: firstAssistant ? firstAssistant.content : '—',
            enriched: {},
            meta: {}
          });
        }
      });
      if (restored) {
        setThreads(all);
        renderHistory();
        renderHistoryChat();
      }
    } catch (e) {
      console.warn('[restoreUserThreads] fail', e);
    }
  }

  // ---------- Table ----------
  async function loadEquipments() {
    try {
      const r = await fetch(API.equipments);
      equipments = await r.json();
      equipments = (equipments || []).map(eq => {
        if (!eq.next_inspection_date && eq.last_inspection_date) {
          const months = Number(eq.frequence);
          const iso = addMonthsISO(eq.last_inspection_date, Number.isFinite(months) ? months : 36);
          if (iso) eq.next_inspection_date = iso;
        }
        return eq;
      });

      // Legacy fallback: restaurer depuis ia_history (niveau équipement)
      restoreThreadsFromEquipments(equipments);

      renderTable(equipments);
      buildFilterLists();
      toast('Équipements chargés', 'info');
    } catch (e) {
      toast('Erreur chargement équipements', 'danger');
    }
  }

  function renderTable(list) {
    const tbody = document.getElementById('equipmentsTable'); if (!tbody) return;
    tbody.innerHTML = '';
    (list || []).forEach(eq => {
      const st = computeStatus(eq.next_inspection_date);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="rowchk" data-id="${eq.id || ''}"></td>
        <td>${eq.id || ''}</td>
        <td>${eq.composant || ''}</td>
        <td>${eq.secteur || ''}</td>
        <td>${eq.batiment || ''}</td>
        <td>${eq.local || ''}</td>
        <td>${eq.zone_gaz || ''}</td>
        <td>${eq.zone_poussieres || eq.zone_poussiere || ''}</td>
        <td class="col-conf">${String(eq.conformite || '').toLowerCase().includes('non') ? '<span class="badge-conf ko">Non Conforme</span>' : '<span class="badge-conf ok">Conforme</span>'}</td>
        <td>${statusBadge(st)}</td>
        <td>${eq.risque ?? ''}</td>
        <td>${fmtDate(eq.last_inspection_date)}</td>
        <td>${fmtDate(eq.next_inspection_date)}</td>
        <td class="actions">
          <button class="btn btn-sm btn-outline-primary" data-action="edit-equipment" data-id="${eq.id}" title="Éditer"><i data-lucide="edit-3"></i></button>
          <button class="btn btn-sm btn-outline-secondary" data-action="open-attachments" data-id="${eq.id}" title="Pièces jointes"><i data-lucide="paperclip"></i> Pièces</button>
          <button class="btn btn-sm ${String(eq.conformite || '').toLowerCase().includes('non') ? 'btn-warning' : 'btn-outline-secondary'}" data-action="open-ia" data-id="${eq.id}" title="IA"><i data-lucide="sparkles"></i> IA</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-equipment" data-id="${eq.id}" data-label="${(eq.composant || '').replace(/\"/g, '&quot;')}" title="Supprimer"><i data-lucide="trash-2"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
    window.lucide?.createIcons();
    $$('.rowchk').forEach(c => c.addEventListener('change', updateBulkBtn));
  }

  // --------- Filters ---------
  const activeFilters = { secteurs: new Set(), batiments: new Set(), conformites: new Set(), statut: new Set(), text: '' };
  function buildFilterLists() {
    const secteurs = [...new Set(equipments.map(e => e.secteur).filter(Boolean))].sort();
    const bats = [...new Set(equipments.map(e => e.batiment).filter(Boolean))].sort();

    const secBox = document.getElementById('dd-secteurs'); secBox.innerHTML = '';
    secteurs.forEach((s, i) => { const id = 'cks_' + i; secBox.insertAdjacentHTML('beforeend', `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s}" id="${id}"><label class="form-check-label" for="${id}">${s}</label></div>`); });
    secBox.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => toggleFilterSet(activeFilters.secteurs, inp.value, inp.checked)));

    const batBox = document.getElementById('dd-batiments'); batBox.innerHTML = '';
    bats.forEach((s, i) => { const id = 'ckb_' + i; batBox.insertAdjacentHTML('beforeend', `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s}" id="${id}"><label class="form-check-label" for="${id}">${s}</label></div>`); });
    batBox.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => toggleFilterSet(activeFilters.batiments, inp.value, inp.checked)));

    $$('#dd-conformite input').forEach(inp => inp.addEventListener('change', () => toggleFilterSet(activeFilters.conformites, inp.value, inp.checked)));
    $$('#dd-statut input').forEach(inp => inp.addEventListener('change', () => toggleFilterSet(activeFilters.statut, inp.value, inp.checked)));

    document.getElementById('filterText').addEventListener('input', (e) => { activeFilters.text = e.target.value.toLowerCase(); renderPills(); applyFilters(); });
    renderPills();
  }
  function toggleFilterSet(set, value, checked) { if (checked) set.add(value); else set.delete(value); renderPills(); }
  function clearFilters() {
    activeFilters.secteurs.clear(); activeFilters.batiments.clear();
    activeFilters.conformites.clear(); activeFilters.statut.clear(); activeFilters.text = '';
    $$('#dd-secteurs input, #dd-batiments input, #dd-conformite input, #dd-statut input').forEach(i => i.checked = false);
    document.getElementById('filterText').value = ''; renderPills(); applyFilters();
  }
  function renderPills() {
    const box = document.getElementById('activePills'); if (!box) return;
    box.innerHTML = '';
    const pill = (l) => `<span class="badge text-bg-light">${l}</span>`;
    activeFilters.secteurs.forEach(s => box.insertAdjacentHTML('beforeend', pill('Secteur: ' + s)));
    activeFilters.batiments.forEach(s => box.insertAdjacentHTML('beforeend', pill('Bâtiment: ' + s)));
    activeFilters.conformites.forEach(s => box.insertAdjacentHTML('beforeend', pill('Conf: ' + s)));
    activeFilters.statut.forEach(s => { const m = { late: 'En retard', today: 'Aujourd’hui', soon: 'Bientôt', ok: 'OK' }; box.insertAdjacentHTML('beforeend', pill('Statut: ' + (m[s] || s))); });
    if (activeFilters.text) box.insertAdjacentHTML('beforeend', pill('Texte: ' + activeFilters.text));
  }
  function applyFilters() {
    let filtered = equipments.slice();
    if (activeFilters.secteurs.size) filtered = filtered.filter(e => activeFilters.secteurs.has(e.secteur));
    if (activeFilters.batiments.size) filtered = filtered.filter(e => activeFilters.batiments.has(e.batiment));
    if (activeFilters.conformites.size) filtered = filtered.filter(e => activeFilters.conformites.has(e.conformite));
    if (activeFilters.statut.size) filtered = filtered.filter(e => activeFilters.statut.has(computeStatus(e.next_inspection_date)));
    if (activeFilters.text) filtered = filtered.filter(e => {
      const blob = [e.composant, e.type, e.marquage_atex, e.identifiant, e.comments].join(' ').toLowerCase();
      return blob.includes(activeFilters.text);
    });
    renderTable(filtered);
  }

  // --------- Bulk delete ---------
  function updateBulkBtn() {
    const sel = $$('.rowchk:checked').map(i => +i.dataset.id);
    const b = document.getElementById('btnBulkDelete');
    if (b) b.disabled = sel.length === 0;
  }
  function toggleAll(e) {
    const checked = e.target.checked; $$('.rowchk').forEach(c => { c.checked = checked; }); updateBulkBtn();
  }
  async function confirmBulkDelete(ids) {
    try {
      await Promise.all(ids.map(id => fetch(API.equipment(id), { method: 'DELETE' })));
      toast('Suppression en masse OK', 'success');
      await loadEquipments();
    } catch (e) {
      toast('Erreur suppression masse: ' + (e.message || e), 'danger');
    } finally {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).hide();
    }
  }

  // --------- Secteurs ---------
  async function loadSecteurs() {
    try {
      const r = await fetch(API.secteurs);
      const arr = await r.json();
      const sel = document.getElementById('secteur-input');
      if (!sel) return;
      sel.innerHTML = '<option value="" disabled selected>— Sélectionner —</option>';
      (arr || []).forEach(s => {
        const name = (typeof s === 'string') ? s : (s && s.name) ? s.name : '';
        if (!name) return;
        const o = document.createElement('option'); o.value = name; o.text = name; sel.appendChild(o);
      });
    } catch { }
  }
  function openModalSecteur() {
    const html = `
    <div class="modal fade" id="modalSecteur" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Nouveau secteur</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <input id="newSecteurName" class="form-control" placeholder="Nom du secteur">
          <div id="secteurSaveMsg" class="small-muted mt-2"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
          <button class="btn btn-primary" id="saveSecteurBtn">Enregistrer</button>
        </div>
      </div></div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('modalSecteur'), modal = new bootstrap.Modal(el); modal.show();
    el.querySelector('#saveSecteurBtn').addEventListener('click', async () => {
      const name = (el.querySelector('#newSecteurName').value || '').trim();
      if (!name) { el.querySelector('#secteurSaveMsg').textContent = 'Nom requis.'; return; }
      try {
        const r = await fetch(API.secteurs, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyWithAccount({ name })) });
        if (!r.ok) throw new Error('Erreur API');
        await loadSecteurs(); document.getElementById('secteur-input').value = name; toast('Secteur enregistré', 'success'); modal.hide(); el.remove();
      } catch (err) { el.querySelector('#secteurSaveMsg').textContent = 'Erreur: ' + (err.message || err); }
    }, { once: true });
    el.addEventListener('hidden.bs.modal', () => el.remove(), { once: true });
  }

  // --------- Save / Edit ---------
  function clearForm() {
    ['equipId', 'secteur-input', 'batiment-input', 'local-input', 'zone-g-input', 'zone-d-input', 'composant-input', 'fournisseur-input', 'type-input', 'identifiant-input', 'marquage_atex-input', 'comments-input', 'last-inspection-input'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const file = document.getElementById('photo-input'); if (file) file.value = '';
  }
  async function saveEquipment() {
    const reqd = ['secteur-input', 'batiment-input', 'composant-input'];
    const missing = reqd.filter(id => !((document.getElementById(id) || {}).value || '').trim());
    if (missing.length) { toast('Champs manquants : ' + missing.join(', '), 'warning'); return; }

    const id = (document.getElementById('equipId') || {}).value || null;
    const data = bodyWithAccount({
      secteur: (document.getElementById('secteur-input') || {}).value,
      batiment: (document.getElementById('batiment-input') || {}).value,
      local: (document.getElementById('local-input') || {}).value,
      composant: (document.getElementById('composant-input') || {}).value,
      fournisseur: (document.getElementById('fournisseur-input') || {}).value,
      type: (document.getElementById('type-input') || {}).value,
      identifiant: (document.getElementById('identifiant-input') || {}).value,
      marquage_atex: (document.getElementById('marquage_atex-input') || {}).value,
      comments: (document.getElementById('comments-input') || {}).value,
      last_inspection_date: (document.getElementById('last-inspection-input') || {}).value || null,
      zone_gaz: (document.getElementById('zone-g-input') || {}).value || null,
      zone_poussieres: (document.getElementById('zone-d-input') || {}).value || null,
      zone_poussiere: (document.getElementById('zone-d-input') || {}).value || null,
      photo: null
    });

    try {
      const r = await fetch(id ? API.equipment(id) : API.equipments, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) {
        if (r.status === 409) throw new Error('Identifiant déjà utilisé.');
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || 'Erreur enregistrement');
      }
      await r.json(); // id/ok
      toast('Équipement sauvegardé.', 'success');
      await loadEquipments();
      document.getElementById('list-tab')?.click();
      clearForm();
    } catch (e) { toast('Erreur: ' + (e.message || e), 'danger'); }
  }
  async function editEquipment(id) {
    try {
      document.getElementById('add-tab')?.click(); await new Promise(r => setTimeout(r, 0));
      const r = await fetch(API.equipment(id)); if (!r.ok) throw new Error('Erreur chargement équipement');
      const eq = await r.json();
      (document.getElementById('equipId') || {}).value = eq.id;
      (document.getElementById('secteur-input') || {}).value = eq.secteur || '';
      (document.getElementById('batiment-input') || {}).value = eq.batiment || '';
      (document.getElementById('local-input') || {}).value = eq.local || '';
      (document.getElementById('zone-g-input') || {}).value = eq.zone_gaz || '';
      (document.getElementById('zone-d-input') || {}).value = (eq.zone_poussieres || eq.zone_poussiere) || '';
      (document.getElementById('composant-input') || {}).value = eq.composant || '';
      (document.getElementById('fournisseur-input') || {}).value = eq.fournisseur || '';
      (document.getElementById('type-input') || {}).value = eq.type || '';
      (document.getElementById('identifiant-input') || {}).value = eq.identifiant || '';
      (document.getElementById('marquage_atex-input') || {}).value = eq.marquage_atex || '';
      (document.getElementById('comments-input') || {}).value = eq.comments || '';
      (document.getElementById('last-inspection-input') || {}).value = eq.last_inspection_date ? new Date(eq.last_inspection_date).toISOString().slice(0, 10) : '';

      // legacy fallback: restaurer thread depuis équipement si présent
      const fromDb = normalizeServerIaHistory(eq.ia_history);
      if (fromDb.length) setThread(eq.id, fromDb);
    } catch (e) { toast('Erreur édition: ' + (e.message || e), 'danger'); }
  }

  // --------- IA helpers ---------
  function stripCodeFences(s) { if (typeof s !== 'string') return ''; return s.replace(/(?:^```(?:html)?|```$)/g, '').trim(); }
  function renderHTML(el, raw) {
    let s = stripCodeFences(raw || '').trim();
    const looksHTML = /<\/?[a-z][\s\S]*>/i.test(s);
    if (!looksHTML) { s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>"); }
    el.innerHTML = s || '—';
  }

  function renderThread(el, thread) {
    if (!el) return;
    el.innerHTML = '';
    thread.forEach(m => {
      const div = document.createElement('div');
      div.className = 'ia-chat-msg ' + (m.role === 'user' ? 'ia-chat-user' : 'ia-chat-assistant');
      if (m.role === 'assistant') { renderHTML(div, m.content); } else { div.textContent = m.content; }
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function renderHistory() {
    const ul = document.getElementById('iaHistoryListChat'); if (!ul) return;
    const h = getHistory();
    ul.innerHTML = '';
    if (!h.length) { ul.innerHTML = '<li class="list-group-item text-muted">Aucune analyse.</li>'; return; }
    h.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.innerHTML = `<div><strong>${it.composant || 'Équipement'}</strong> — ID ${it.id}<div class="small-muted">${it.meta?.secteur || '-'} • ${it.meta?.batiment || '-'}</div></div><button class="btn btn-sm btn-outline-secondary" data-idx="${idx}" data-act="open">Ouvrir</button>`;
      li.addEventListener('click', (e) => { const i = Number(e.target.getAttribute('data-idx') || 0); selectHistoryChat(i); });
      ul.appendChild(li);
    });
  }
  function renderHistoryChat() {
    const h = getHistory();
    const it = h[0];
    if (!it) {
      (document.getElementById('chatHeader') || {}).textContent = '';
      (document.getElementById('chatHtml') || {}).innerHTML = '';
      (document.getElementById('chatThread') || {}).innerHTML = '';
      (document.getElementById('chatEnriched') || {}).style.display = 'none';
      return;
    }
    (document.getElementById('chatHeader') || {}).textContent = `${it.composant || 'Équipement'} — ID ${it.id}`;
    renderHTML(document.getElementById('chatHtml'), it.content || '—');
    const enr = it.enriched || {};
    const toLis = (arr) => (arr || []).map(li => `<li>${li}</li>`).join('') || '<li class="text-muted">—</li>';
    (document.getElementById('chatWhy') || {}).innerHTML = enr.why || '';
    (document.getElementById('chatPalliative') || {}).innerHTML = toLis(enr.palliatives);
    (document.getElementById('chatPreventive') || {}).innerHTML = toLis(enr.preventives);
    (document.getElementById('chatRefs') || {}).innerHTML = toLis(enr.refs);
    (document.getElementById('chatCosts') || {}).innerHTML = toLis(enr.costs);
    (document.getElementById('chatEnriched') || {}).style.display = 'block';
    renderThread(document.getElementById('chatThread'), getThread(it.id));
  }
  function selectHistoryChat(idx) {
    const h = getHistory();
    const it = h[idx]; if (!it) return;
    currentIA = it.id;
    (document.getElementById('chatHeader') || {}).textContent = `${it.composant || 'Équipement'} — ID ${it.id}`;
    renderHTML(document.getElementById('chatHtml'), it.content || '—');
    const enr = it.enriched || {};
    const toLis = (arr) => (arr || []).map(li => `<li>${li}</li>`).join('') || '<li class="text-muted">—</li>';
    (document.getElementById('chatWhy') || {}).innerHTML = enr.why || '';
    (document.getElementById('chatPalliative') || {}).innerHTML = toLis(enr.palliatives);
    (document.getElementById('chatPreventive') || {}).innerHTML = toLis(enr.preventives);
    (document.getElementById('chatRefs') || {}).innerHTML = toLis(enr.refs);
    (document.getElementById('chatCosts') || {}).innerHTML = toLis(enr.costs);
    (document.getElementById('chatEnriched') || {}).style.display = 'block';
    renderThread(document.getElementById('chatThread'), getThread(it.id));
  }

  function requiredCategoryForZone(zg, zd) {
    const zgNum = String(zg || '').replace(/[^0-9]/g, '') || '';
    const zdNum = String(zd || '').replace(/[^0-9]/g, '') || '';
    if (zgNum === '0' || zdNum === '20') return 'II 1GD';
    if (zgNum === '1' || zdNum === '21') return 'II 2GD';
    return 'II 3GD';
  }
  function buildDynamicSuggestions(eq) {
    const cont = document.getElementById('autoLinks');
    if (!cont) return;
    cont.innerHTML = '';
    const isNC = String(eq?.conformite || '').toLowerCase().includes('non');
    const req = requiredCategoryForZone(eq?.zone_gaz, eq?.zone_poussieres);
    const comp = (eq?.composant || '').toLowerCase();

    const items = [];
    if (comp.includes('pression') || comp.includes('capteur')) {
      items.push({ type: 'Capteur pression ATEX', name: 'IFM PN7092', href: 'https://www.ifm.com/' });
    }
    if (comp.includes('moteur') || comp.includes('pompe')) {
      items.push({ type: 'Moteur Ex d', name: 'WEG W22X', href: 'https://www.weg.net/' });
    }
    items.push({ type: 'Boîte de jonction Ex e', name: 'R. STAHL série 8146/5-V', href: 'https://r-stahl.com/' });
    items.push({ type: 'Presse-étoupe Ex e/Ex d', name: 'Hawke 501/421', href: 'https://www.ehawke.com/' });
    items.push({ type: 'Câble & accessoires ATEX', name: 'RS Components', href: 'https://uk.rs-online.com/' });

    cont.innerHTML = `
      <div class="small-muted mb-2">Catégorie requise estimée : <strong>${req}</strong></div>
      ${!isNC ? '<div class="text-muted small mb-2">Équipement conforme — suggestions générales :</div>' : '<div class="text-danger small mb-2">Équipement non conforme — remplacements conseillés :</div>'}
      <ul class="mb-2">${items.map(it => `<li><strong>${it.type}</strong> — ${it.name} • <a href="${it.href}" target="_blank" rel="noopener">Voir</a></li>`).join('')}</ul>
      <div class="small-muted">Ajusté en fonction du composant et des zones (G/D).</div>
    `;
  }

  async function openIA(id) {
    currentIA = id;
    const loading = document.getElementById('chatLoading'); if (loading) loading.style.display = 'block';
    try {
      let eq; const cached = getCachedHelp(id);
      if (cached && cached.eq) eq = cached.eq;
      else {
        const r = await fetch(API.equipment(id)); if (!r.ok) throw new Error('Équipement introuvable');
        eq = await r.json();
      }

      // Legacy fallback: si pas encore de thread local, tenter depuis eq.ia_history
      const fromDb = normalizeServerIaHistory(eq.ia_history);
      if (fromDb.length && getThread(eq.id).length === 0) setThread(eq.id, fromDb);

      let help = cached && cached.help;
      if (!help) {
        const hr = await fetch(API.help(id));
        help = await hr.json();
        cacheHelp(id, { eq, help });
      }

      const cleaned = help?.response || 'Aucune analyse IA disponible.';
      addToHistory({
        id: eq.id, composant: eq.composant || 'Équipement',
        content: cleaned, enriched: help?.enrich || {},
        meta: { secteur: eq.secteur || '', batiment: eq.batiment || '', last: fmtDate(eq.last_inspection_date), next: fmtDate(eq.next_inspection_date) }
      });

      renderHistory();
      renderHistoryChat();
      renderThread(document.getElementById('iaThread'), getThread(eq.id));
      buildDynamicSuggestions(eq);
      toast('Analyse IA chargée', 'success');
    } catch (e) { toast('Erreur IA: ' + (e.message || e), 'danger'); }
    finally { if (loading) loading.style.display = 'none'; }
  }
  window.openIA = openIA;

  async function sendChat(origin) {
    const input = origin === 'panel' ? document.getElementById('iaPrompt') : document.getElementById('chatPrompt');
    if (!input) return; const text = (input.value || '').trim(); if (!text || !currentIA) return;
    try {
      const thread = getThread(currentIA);

      // Persist PAR UTILISATEUR: POST /api/atex-chat
      const resp = await fetch(API.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyWithAccount({
          question: text,
          equipment_id: currentIA,
          equipment: null,
          history: thread.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        }))
      });
      const data = await resp.json();
      const iaText = data?.response || 'Réponse indisponible.';

      const next = [...thread, { role: 'user', content: text }, { role: 'assistant', content: iaText }];
      setThread(currentIA, next);
      input.value = '';
      renderThread(origin === 'panel' ? document.getElementById('iaThread') : document.getElementById('chatThread'), next);
    } catch (e) { toast('Erreur chat: ' + (e.message || e), 'danger'); }
  }

  // ---------- Wiring ----------
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnApplyFilters')?.addEventListener('click', applyFilters);
    document.getElementById('btnClearFilters')?.addEventListener('click', clearFilters);
    document.getElementById('btnSync')?.addEventListener('click', loadEquipments);
    document.getElementById('chkAll')?.addEventListener('change', toggleAll);
    document.getElementById('btnBulkDelete')?.addEventListener('click', () => {
      const sel = $$('.rowchk:checked').map(i => +i.dataset.id);
      if (!sel.length) return;
      document.getElementById('deleteMsg').textContent = `Supprimer ${sel.length} équipement(s) sélectionné(s) ?`;
      document.getElementById('deleteMeta').textContent = 'IDs: ' + sel.join(', ');
      bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).show();
      document.getElementById('confirmDeleteBtn').addEventListener('click', () => confirmBulkDelete(sel), { once: true });
    });

    document.getElementById('btnSave')?.addEventListener('click', saveEquipment);
    document.getElementById('btnCancel')?.addEventListener('click', () => { document.getElementById('list-tab').click(); });
    document.getElementById('btnAddSecteur')?.addEventListener('click', openModalSecteur);

    // Chat onglet
    document.getElementById('btnSend')?.addEventListener('click', () => sendChat('tab'));
    document.getElementById('btnClearChat')?.addEventListener('click', clearAllHistory);
    document.getElementById('btnDeleteDiscussion')?.addEventListener('click', async () => {
      if (!currentIA) return;
      try {
        // Efface le thread PAR UTILISATEUR (table atex_chat_threads)
        await fetch(API.chatFor(currentIA), { method: 'DELETE' });
      } catch {}
      deleteThread(currentIA); removeFromHistory(currentIA); deleteHelpCache(currentIA);
      (document.getElementById('chatThread') || {}).innerHTML = '';
      (document.getElementById('chatHtml') || {}).innerHTML = '';
      currentIA = null;
      renderHistoryChat(); renderHistory();
      toast('Discussion supprimée', 'info');
    });
    document.getElementById('btnReanalyse')?.addEventListener('click', () => { if (currentIA) openIA(currentIA); });
    document.getElementById('btnCopier')?.addEventListener('click', () => {
      const text = ($('#chatHtml')?.innerText || '') + '\n\n' + ($('#chatThread')?.innerText || '');
      navigator.clipboard.writeText(text).then(() => toast('Contenu copié', 'success'));
    });

    // Chat panel (offcanvas)
    document.getElementById('iaSend')?.addEventListener('click', () => sendChat('panel'));
    document.getElementById('btnClearOne')?.addEventListener('click', async () => {
      if (!currentIA) return;
      try {
        await fetch(API.chatFor(currentIA), { method: 'DELETE' });
      } catch {}
      deleteThread(currentIA); removeFromHistory(currentIA); deleteHelpCache(currentIA);
      renderHistory(); renderHistoryChat();
      toast('Discussion supprimée', 'info');
    });
    document.getElementById('btnOpenInChat')?.addEventListener('click', () => {
      const tabBtn = document.getElementById('chat-tab'); tabBtn && tabBtn.click();
      renderHistoryChat();
    });

    // Table actions
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === 'edit-equipment') { editEquipment(Number(btn.dataset.id)); }
      if (act === 'delete-equipment') {
        const id = Number(btn.dataset.id);
        document.getElementById('deleteMsg').textContent = 'Voulez-vous vraiment supprimer cet équipement ATEX ?';
        document.getElementById('deleteMeta').textContent = btn.dataset.label ? `Équipement : ${btn.dataset.label} (ID ${id})` : `ID ${id}`;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).show();
        document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
          try { const r = await fetch(API.equipment(id), { method: 'DELETE' }); if (!r.ok) throw new Error('Erreur suppression'); toast('Supprimé !', 'success'); await loadEquipments(); }
          catch (e) { toast('Erreur suppression: ' + (e.message || e), 'danger'); }
          finally { bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).hide(); }
        }, { once: true });
      }
      if (act === 'open-attachments') {
        const id = Number(btn.dataset.id);
        // Utilise l'endpoint viewer pour normaliser photo + pièces
        fetch(API.equipViewer(id)).then(r => r.json()).then(payload => {
          window.openAttachmentViewer && window.openAttachmentViewer(payload);
        }).catch(err => toast('Erreur pièce jointe: ' + (err.message || err), 'danger'));
      }
      if (act === 'open-ia') { openIA(Number(btn.dataset.id)); }
    });

    // Chargement initial : équipements puis restauration de TOUS mes threads
    loadEquipments().then(() => restoreUserThreads());
    loadSecteurs();
  });
})();

