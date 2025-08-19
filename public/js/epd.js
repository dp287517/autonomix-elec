// public/js/epd.js — IA propre + génération CDC + UI modales

const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',          // endpoint IA déjà présent dans ton app
  epd: '/api/epd',
  epdStatus: (id)=> `/api/epd/${id}/status`,
  upload: '/api/upload'
};

function getToken(){
  return localStorage.getItem('autonomix_token')
      || localStorage.getItem('token')
      || localStorage.getItem('auth_token')
      || localStorage.getItem('access_token')
      || (JSON.parse(localStorage.getItem('autonomix_user')||'{}')?.token || '');
}

async function fetchAuth(url, opts={}){
  const token = getToken();
  const headers = Object.assign({}, opts.headers||{}, token ? { Authorization: 'Bearer '+token } : {});
  const res = await fetch(url, Object.assign({}, opts, { headers, credentials:'include' }));
  if (res.status === 401) {
    localStorage.removeItem('autonomix_token');
    localStorage.removeItem('token');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('autonomix_user');
    window.location.href = 'login.html';
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
  if (window.lucide) window.lucide.createIcons();
  bindProjects();
  bindContext();
  bindZoning();
  bindEquipments();
  bindMeasures();
  bindBuild();
  restoreUI();
});

// ………………………………………
// (Le reste de TON FICHIER ORIGINAL est conservé tel quel ci-dessous.)
// J’ai uniquement renforcé getToken() et fetchAuth() ci-dessus.
// ………………………………………

/* ======= Projets ======= */
async function loadProjects() {
  const res = await fetchAuth(API.epd);
  const list = await res.json();
  renderProjects(list);
}

function renderProjects(list) {
  const tbody = document.getElementById('projTableBody');
  tbody.innerHTML = '';
  list.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name || 'Sans nom')}</strong></td>
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

  document.getElementById('searchProject').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    Array.from(tbody.children).forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  document.getElementById('btnNewProject').addEventListener('click', async () => {
    const name = prompt('Nom du projet ?');
    if (!name) return;
    const res = await fetchAuth(API.epd, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const p = await res.json();
    await loadProjects();
    await openProject(p.id);
  });
}

async function openProject(id) {
  const res = await fetchAuth(`${API.epd}/${id}`);
  const proj = await res.json();
  state.currentProjectId = proj.id;
  // hydrate UI
  document.getElementById('contextText').value = proj.context || '';
  document.getElementById('zoneType').value = proj.zone_type || '';
  document.getElementById('zoneGaz').value = proj.zone_gaz || '';
  document.getElementById('zonePoussiere').value = proj.zone_poussiere || '';
  state.attachments = Array.isArray(proj.attachments) ? proj.attachments : [];
  updateGuide();
  switchTab('context');
}

async function deleteProject(id) {
  if (!confirm('Supprimer ce projet ?')) return;
  await fetchAuth(`${API.epd}/${id}`, { method: 'DELETE' });
  if (state.currentProjectId === id) state.currentProjectId = null;
  await loadProjects();
}

/* ======= Contexte ======= */
function bindContext() {
  const ta = document.getElementById('contextText');
  ta.addEventListener('input', () => debouncedSave());
}

function bindProjects() { loadProjects(); }

/* ======= Zonage ======= */
function bindZoning() {
  document.getElementById('zoneType').addEventListener('change', debouncedSave);
  document.getElementById('zoneGaz').addEventListener('change', debouncedSave);
  document.getElementById('zonePoussiere').addEventListener('change', debouncedSave);
}

/* ======= Équipements ======= */
function bindEquipments() {
  document.getElementById('equipSearch').addEventListener('input', filterEquip);
  document.getElementById('btnAddEquip').addEventListener('click', addEquipment);
  document.getElementById('btnAskIA').addEventListener('click', openIA);
  loadEquipments();
}

async function loadEquipments() {
  const q = document.getElementById('equipSearch').value || '';
  const url = q ? `${API.equipments}?q=${encodeURIComponent(q)}` : API.equipments;
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

function toggleEquip(id) {
  const found = state.equipments.find(x => String(x.id) === String(id));
  if (!found) return;
  if (state.selectedEquip.has(id)) state.selectedEquip.delete(id);
  else state.selectedEquip.set(id, found);
  updateGuide();
}

/* ======= Mesures ======= */
function bindMeasures() {
  document.getElementById('measuresText').addEventListener('input', debouncedSave);
}

/* ======= Build ======= */
function bindBuild() {
  document.getElementById('btnNext').addEventListener('click', nextStep);
  document.getElementById('btnBuild').addEventListener('click', () => switchTab('build'));
  document.getElementById('btnGenerate').addEventListener('click', generateEpd);
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
  const payload = {
    context: document.getElementById('contextText').value || '',
    zone_type: document.getElementById('zoneType').value || '',
    zone_gaz: document.getElementById('zoneGaz').value || '',
    zone_poussiere: document.getElementById('zonePoussiere').value || '',
    equipments: Array.from(state.selectedEquip.values()).map(e => e.id),
    measures: document.getElementById('measuresText').value || '',
    attachments: state.attachments || []
  };
  await fetchAuth(`${API.epd}/${state.currentProjectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  updateGuide();
}

async function generateEpd() {
  if (!state.currentProjectId) { alert('Ouvrez un projet EPD.'); return; }
  const el = document.getElementById('buildStatus');
  el.textContent = 'Génération en cours…';
  const res = await fetchAuth(`${API.epd}/${state.currentProjectId}/build`, { method: 'POST' });
  const data = await res.json();
  const out = document.getElementById('buildOutput');
  out.innerHTML = marked.parse(data.html || data.text || '—');
  el.textContent = 'Terminé';
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
    body: JSON.stringify({ question: q, equipment: anyEquip, history: [] })
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

