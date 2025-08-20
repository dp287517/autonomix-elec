// public/js/epd.js — EPD UI + IA + génération
// Design inchangé. Auth normalisée. Pas de redirection auto sur 401 génériques.

// ---------- Account helper ----------
(function(){
  function getAccountId() {
    try {
      const u = new URL(window.location.href);
      const fromQS = u.searchParams.get('account_id');
      const stored = localStorage.getItem('app_account_id')
                 || localStorage.getItem('selected_account_id')
                 || localStorage.getItem('autonomix_selected_account_id')
                 || localStorage.getItem('account_id');
      const id = fromQS || stored || '10';
      if (id && id !== stored) localStorage.setItem('app_account_id', id);
      return id;
    } catch { return '10'; }
  }
  window.__EPD_ACCOUNT_ID__ = getAccountId();
  window.__withAccount__ = (path) => `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(window.__EPD_ACCOUNT_ID__)}`;
  window.__bodyWithAccount__ = (o = {}) => Object.assign({}, o, { account_id: window.__EPD_ACCOUNT_ID__ });
})();

// ---------- API endpoints ----------
const API = {
  equipments: __withAccount__('/api/atex-equipments'),
  chat: __withAccount__('/api/atex-chat'),
  epd: __withAccount__('/api/epd'),
  epdStatus: (id)=> __withAccount__('/api/epd/' + id + '/status'),
  upload: __withAccount__('/api/upload')
};

// ---------- Token helpers ----------
function _readTokenRaw(){
  try {
    return (
      localStorage.getItem('autonomix_token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('access_token') ||
      (JSON.parse(localStorage.getItem('autonomix_user')||'{}')?.token || '')
    ) || '';
  } catch { return ''; }
}
function _jwtFromRaw(raw){ return String(raw||'').trim().replace(/^Bearer\s+/i, ''); }
function _authHeaderValue(){ const jwt=_jwtFromRaw(_readTokenRaw()); return jwt ? ('Bearer ' + jwt) : ''; }

// ---------- fetchAuth (sans redirection auto) ----------
async function fetchAuth(url, opts={}){
  let u = url;
  if (/^\/api\/(?:atex-|epd)/.test(u) && !/[?&]account_id=/.test(u)) {
    u = __withAccount__(u);
  }
  const headers = Object.assign({}, opts.headers||{}, (() => {
    const jwt = _jwtFromRaw(_readTokenRaw());
    if (!jwt) return {};
    return { Authorization: 'Bearer ' + jwt, 'X-Auth-Token': jwt, 'X-Access-Token': jwt };
  })());
  const res = await fetch(u, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    // on ne redirige pas ici : on laisse la page active pour debug
    throw new Error('401 Unauthorized');
  }
  return res;
}

// --------------------- état & helpers ---------------------
const state = {
  mode: 'projet',
  context: {},
  zones: new Set(),
  attachments: [],
  equipments: [],
  selectedEquip: new Map(),
  zoningSelections: [],
  currentProjectId: null,
};

let saveTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

  bindProjects();
  bindContext();
  bindZoning();
  bindEquipments();
  bindMeasures();
  bindBuild();
  restoreUI();
});

/* ======= Projets ======= */
async function loadProjects() {
  const res = await fetchAuth(API.epd);
  const list = await res.json();
  renderProjects(list);
}

function renderProjects(list) {
  const tbody = document.getElementById('projTableBody');
  tbody.innerHTML = '';
  (list||[]).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name || p.title || 'Sans nom')}</strong></td>
      <td>${escapeHtml(p.secteur || '')}</td>
      <td>${escapeHtml(p.batiment || '')}</td>
      <td>${escapeHtml(p.local || '')}</td>
      <td class="text-muted">${fmtDate(p.updated_at || p.created_at)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" data-action="open" data-id="${p.id}">Ouvrir</button>
        <button class="btn btn-sm btn-outline-danger" data-action="del" data-id="${p.id}">Supprimer</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-action="open"]').forEach(btn => {
    btn.addEventListener('click', () => openProject(btn.dataset.id));
  });
  tbody.querySelectorAll('button[data-action="del"]').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(btn.dataset.id));
  });

  const search = document.getElementById('searchProject');
  if (search && !search.__wired) {
    search.__wired = true;
    search.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      Array.from(tbody.children).forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  const btnNew = document.getElementById('btnNewProject');
  if (btnNew && !btnNew.__wired) {
    btnNew.__wired = true;
    btnNew.addEventListener('click', async () => {
      const name = prompt('Nom du projet ?');
      if (!name) return;
      const res = await fetchAuth(API.epd, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(__bodyWithAccount__({ name, title: name }))
      });
      const p = await res.json();
      await loadProjects();
      await openProject(p.id);
    });
  }
}

async function openProject(id) {
  const res = await fetchAuth(`${__withAccount__('/api/epd')}/${id}`);
  const proj = await res.json();
  state.currentProjectId = proj.id;
  document.getElementById('contextText').value = proj.context || proj.payload?.context || '';
  document.getElementById('zoneType').value = proj.zone_type || proj.payload?.zone_type || '';
  document.getElementById('zoneGaz').value = proj.zone_gaz || proj.payload?.zone_gaz || '';
  document.getElementById('zonePoussiere').value = proj.zone_poussiere || proj.payload?.zone_poussiere || '';
  state.attachments = Array.isArray(proj.attachments || proj.payload?.attachments) ? (proj.attachments || proj.payload?.attachments) : [];
  updateGuide();
  switchTab('context');
}

async function deleteProject(id) {
  if (!confirm('Supprimer ce projet ?')) return;
  await fetchAuth(`${__withAccount__('/api/epd')}/${id}`, { method: 'DELETE' });
  if (state.currentProjectId === id) state.currentProjectId = null;
  await loadProjects();
}

function bindProjects() {
  // évite les "Unhandled promise rejection" en dev
  loadProjects().catch(err => console.warn('EPD load error:', err && err.message || err));
}

/* ======= Contexte ======= */
function bindContext() {
  const ta = document.getElementById('contextText');
  if (ta && !ta.__wired) {
    ta.__wired = true;
    ta.addEventListener('input', () => debouncedSave());
  }
}

/* ======= Zonage ======= */
function bindZoning() {
  const zt = document.getElementById('zoneType');
  const zg = document.getElementById('zoneGaz');
  const zp = document.getElementById('zonePoussiere');
  [zt,zg,zp].forEach(el => {
    if (el && !el.__wired) { el.__wired = true; el.addEventListener('change', debouncedSave); }
  });
}

/* ======= Équipements ======= */
function bindEquipments() {
  const search = document.getElementById('equipSearch');
  if (search && !search.__wired) { search.__wired = true; search.addEventListener('input', filterEquip); }

  const add = document.getElementById('btnAddEquip');
  if (add && !add.__wired) { add.__wired = true; add.addEventListener('click', addEquipment); }

  const ia = document.getElementById('btnAskIA');
  if (ia && !ia.__wired) { ia.__wired = true; ia.addEventListener('click', openIA); }

  loadEquipments().catch(err => console.warn('Equip load error:', err && err.message || err));
}

async function loadEquipments() {
  const q = document.getElementById('equipSearch').value || '';
  const base = API.equipments;
  const url = q ? `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}` : base;
  const res = await fetchAuth(url);
  const list = await res.json();
  state.equipments = list || [];
  renderEquipments();
}

function renderEquipments() {
  const tbody = document.getElementById('equipTableBody');
  tbody.innerHTML = '';
  state.equipments.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(e.composant||'')}</td>
      <td>${escapeHtml(e.fournisseur||'')}</td>
      <td>${escapeHtml(e.type||'')}</td>
      <td>${escapeHtml(e.identifiant||'')}</td>
      <td><span class="pill">${escapeHtml(e.marquage_atex||'')}</span></td>
      <td>${escapeHtml(e.conformite||'')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary" data-action="select" data-id="${e.id}">Sélectionner</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-action="select"]').forEach(btn => {
    btn.addEventListener('click', () => toggleEquip(btn.dataset.id));
  });
}

// stub pour bouton "Ajouter"
function addEquipment() {
  alert("Ajout manuel d'équipement (à implémenter). Utilisez la recherche pour sélectionner dans la base.");
}

function toggleEquip(id) {
  const found = state.equipments.find(x => String(x.id) === String(id));
  if (!found) return;
  if (state.selectedEquip.has(id)) state.selectedEquip.delete(id);
  else state.selectedEquip.set(id, found);
  updateGuide();
}

/* ======= Mesures ======= */
function bindMeasures() {
  const ta = document.getElementById('measuresText');
  if (ta && !ta.__wired) { ta.__wired = true; ta.addEventListener('input', debouncedSave); }
}

/* ======= Build ======= */
function bindBuild() {
  const btnNext = document.getElementById('btnNext');
  const btnBuildTab = document.getElementById('btnBuild');
  const btnGenerate = document.getElementById('btnGenerate');

  if (btnNext && !btnNext.__wired) { btnNext.__wired = true; btnNext.addEventListener('click', nextStep); }
  if (btnBuildTab && !btnBuildTab.__wired) { btnBuildTab.__wired = true; btnBuildTab.addEventListener('click', () => switchTab('build')); }
  if (btnGenerate && !btnGenerate.__wired) { btnGenerate.__wired = true; btnGenerate.addEventListener('click', generateEpd); }
}

function switchTab(id) {
  const tabTrigger = document.querySelector(`[data-bs-target="#${id}"]`);
  if (tabTrigger) new bootstrap.Tab(tabTrigger).show();
}

function nextStep() {
  const order = ['projects','context','zoning','equip','measures','build'];
  const active = document.querySelector('.nav-link.active')?.getAttribute('data-bs-target')?.slice(1) || 'projects';
  const idx = order.indexOf(active);
  const next = order[Math.min(idx+1, order.length-1)];
  switchTab(next);
}

function updateGuide() {
  const okCtx = !!document.getElementById('contextText').value.trim();
  const okZone = !!(document.getElementById('zoneType').value || document.getElementById('zoneGaz').value || document.getElementById('zonePoussiere').value);
  const okEquip = state.selectedEquip.size > 0;
  const okMes = !!document.getElementById('measuresText').value.trim();

  setStatus('st-context', okCtx);
  setStatus('st-zoning', okZone);
  setStatus('st-equip', okEquip);
  setStatus('st-measures', okMes);
  setStatus('st-projects', !!state.currentProjectId);
  setStatus('st-build', okCtx && okZone && okEquip);
}

function setStatus(id, ok) {
  const el = document.getElementById(id);
  el.classList.remove('status-green','status-orange');
  el.classList.add(ok ? 'status-green':'status-orange');
}

function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 500);
}

async function saveProject() {
  if (!state.currentProjectId) return;
  const payload = __bodyWithAccount__({
    context: document.getElementById('contextText').value || '',
    zone_type: document.getElementById('zoneType').value || '',
    zone_gaz: document.getElementById('zoneGaz').value || '',
    zone_poussiere: document.getElementById('zonePoussiere').value || '',
    equipments: Array.from(state.selectedEquip.values()).map(e => e.id),
    measures: document.getElementById('measuresText').value || '',
    attachments: state.attachments || []
  });
  await fetchAuth(`${__withAccount__('/api/epd')}/${state.currentProjectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  updateGuide();
}

async function generateEpd() {
  if (!state.currentProjectId) { alert('Ouvrez un projet EPD.'); return; }
  const el = document.getElementById('buildStatus');
  if (el) el.textContent = 'Génération en cours…';
  const res = await fetchAuth(`${__withAccount__('/api/epd')}/${state.currentProjectId}/build`, { method: 'POST' });
  const data = await res.json();
  const out = document.getElementById('buildOutput');
  out.innerHTML = (window.marked && (data.html || data.text)) ? marked.parse(data.html || data.text) : (data.html || data.text || '—');
  if (el) el.textContent = 'Terminé';
}

/* ======= Upload ======= */
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetchAuth(API.upload, { method: 'POST', body: fd });
  return res.json(); // { url, name, size }
}

/* ======= IA ======= */
function openIA() {
  const off = new bootstrap.Offcanvas('#offIA');
  off.show();
  document.getElementById('btnIaAsk').onclick = askIA;
}

async function askIA() {
  const q = document.getElementById('iaQuestion').value.trim();
  if (!q) return;
  const anyEquip = Array.from(state.selectedEquip.values())[0] || null;

  const res = await fetchAuth(API.chat, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(__bodyWithAccount__({
      question: q,
      equipment_id: anyEquip?.id || null,
      equipment: null,
      history: []
    }))
  });
  const data = await res.json();
  document.getElementById('iaResponse').innerHTML = data.response || '<em>Aucune réponse</em>';
}

/* ======= Utils ======= */
function escapeHtml(s) {
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function fmtDate(s) {
  try { const d = new Date(s); return d.toLocaleString(); } catch { return ''; }
}
function restoreUI(){ updateGuide(); }

// filtrage côté équipements
function filterEquip(){
  const q = (document.getElementById('equipSearch').value || '').toLowerCase();
  const rows = Array.from(document.getElementById('equipTableBody').children || []);
  rows.forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
