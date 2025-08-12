
// epd.js — Front-end EPD/DRPCE — v3 (Projets + Upload serveur)
const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',
  epd: '/api/epd',
  uploads: '/api/uploads'
};

const state = {
  currentId: null, // projet en cours (si ouvert depuis /api/epd/:id)
  mode: 'projet', // 'projet' | 'inspection'
  context: {},
  zones: new Set(),
  equipments: [],
  selectedEquip: new Map(),
  attachments: [], // {name,type,size,url}
};

// ===== Boot
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  bindContext();
  bindZoning();
  bindEquipments();
  bindMeasuresAI();
  bindBuildExport();
  bindAttachments();
  bindProjects();
  restore();
  loadEquip();
  window.addEventListener('beforeunload', onBeforeUnload);
});

// ===== Save status
let dirty = false;
let saveTimer = null;
const KEY='EPD_BUILDER';

function markDirty(){
  dirty = true;
  setSaveState('Enregistrement…', 'orange');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 500);
}
function setSaveState(text, color='inherit'){
  const dot = document.getElementById('saveStateDot');
  const t = document.getElementById('saveStateText');
  if (dot) dot.style.color = color;
  if (t) t.textContent = text;
}
function onBeforeUnload(e){
  if (dirty) { e.preventDefault(); e.returnValue = 'Des modifications non enregistrées pourraient être perdues.'; }
}

// ===== Persistence (local only)
function saveLocal(){
  const json = buildJsonPayload();
  localStorage.setItem(KEY, JSON.stringify(json));
  dirty = false;
  setSaveState('Enregistré localement', 'green');
}
function restore(){
  try{
    const data = JSON.parse(localStorage.getItem(KEY)||'{}');
    if (!data || Object.keys(data).length===0) return;
    state.mode = data.mode || 'projet';
    state.context = data.context || {};
    state.zones = new Set(data.zones || []);
    state.attachments = data.attachments || [];
    Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
    document.getElementById('projectTitle').value = data.title || '';
    document.getElementById('projectStatus').value = data.status || 'Brouillon';
    document.getElementById('modeProjet').checked = state.mode==='projet';
    document.getElementById('modeInspection').checked = state.mode==='inspection';
    document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
    renderAttachmentThumbs();
    setSaveState('Restauré', 'green');
  }catch{ setSaveState('Prêt'); }
}

// ===== Context + Mode + Attachments
function bindContext(){
  ['org','site','address','author','processDesc','fluids','operating'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.context[id] = el.value; markDirty(); });
  });
  document.getElementsByName('modeEPD').forEach(r => r.addEventListener('change', () => {
    state.mode = document.getElementById('modeProjet').checked ? 'projet' : 'inspection';
    markDirty();
  }));
  const titleEl = document.getElementById('projectTitle');
  const statEl  = document.getElementById('projectStatus');
  titleEl.addEventListener('input', markDirty);
  statEl.addEventListener('change', markDirty);
  document.getElementById('btnSaveServerTop').addEventListener('click', saveServer);
  document.getElementById('btnSaveServer').addEventListener('click', saveServer);
  on('#btnScopeChecklist','click', async () => {
    const prompt = `Agis en ingénieur process safety. À partir de ces infos (fluids: ${state.context.fluids||'-'}, operating: ${state.context.operating||'-'}), rédige une checklist de cadrage projet ATEX/EPD (données à collecter, normes, interfaces HSE, essais requis) en 12 points.`;
    openIA(await callAI(prompt), true);
  });
  on('#btnScopeHazid','click', async () => {
    const prompt = `Agis en HAZID leader. Sur la base du procédé décrit: ${state.context.processDesc||'-'} et des produits ${state.context.fluids||'-'}, propose une pré-HAZID structurée (sources ATEX, scénarios, barrières, actions) format Markdown.`;
    openIA(await callAI(prompt), true);
  });
}
function bindAttachments(){
  const input = document.getElementById('attachments');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files||[]);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try{
      const r = await fetch(API.uploads, { method:'POST', body: fd });
      const data = await r.json();
      const added = (data.files||[]).map(f => ({ name:f.originalname, type:f.mimetype, size:f.size, url:f.url }));
      state.attachments.push(...added);
      renderAttachmentThumbs();
      markDirty();
      toast(`${added.length} fichier(s) envoyé(s)`, 'success');
    }catch(e){ toast('Erreur upload fichiers', 'danger'); }
    input.value = '';
  });
}
function renderAttachmentThumbs(){
  const holder = document.getElementById('attachmentPreview');
  if (!holder) return;
  holder.innerHTML = '';
  state.attachments.forEach((a,idx)=>{
    const isImg = (a.type||'').startsWith('image/');
    const html = isImg
      ? `<div class="d-inline-block me-2 mb-2 text-center"><img class="thumb" src="${a.url}" alt="${a.name}"><div class="small-muted">${a.name}</div></div>`
      : `<div class="d-inline-block me-2 mb-2 text-center"><div class="thumb d-flex align-items-center justify-content-center bg-light">PDF</div><div class="small-muted">${a.name}</div></div>`;
    holder.insertAdjacentHTML('beforeend', html);
  });
}

// ===== Zoning
function bindZoning(){
  document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value); markDirty(); });
  });
  on('#btnAIIntroZoning','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI('Explique brièvement les zones ATEX 0/1/2/20/21/22 et leurs critères, en 120 mots.');
    openIA(reply, true);
  });
  on('#btnAIProposeZoning','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const prompt = `Tu es expert ATEX. En te basant sur: produits=${state.context.fluids||'-'}, procédé=${state.context.processDesc||'-'}, conditions=${state.context.operating||'-'}, propose un schéma de zonage (zones, étendue, critères 60079-10-x) + hypothèses et limites.`;
    openIA(await callAI(prompt), true);
  });
}

// ===== Equipements
function bindEquipments(){
  on('#btnSyncEquip','click', loadEquip);
  on('#fSecteur','input', renderEquip);
  on('#fBat','input', renderEquip);
  on('#fConf','change', renderEquip);
  on('#checkAll','change', (e) => {
    document.querySelectorAll('.row-check').forEach(ch => { ch.checked = e.target.checked; toggleSelect(ch); });
  });
  on('#btnAIEq','click', async () => {
    const selected = [...state.selectedEquip.values()];
    if (!selected.length) return openIA('Sélectionne au moins un équipement.');
    const sample = selected.slice(0, 12).map(e => `${e.id} ${e.composant} [${e.zone_type||e.exterieur||e.interieur}] ${e.marquage_atex||''} ${e.conformite||''}`).join('\n');
    const prompt = `Analyse les équipements ATEX sélectionnés, signale les non-conformités potentielles (catégorie/zone/IP/Temp), et propose 5 actions correctives priorisées:\n${sample}`;
    openIA(await callAI(prompt), true);
  });
  on('#btnAIProposeEquip','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const prompt = `Mode=${state.mode}. Propose une liste d'équipements ATEX types (moteurs, capteurs, coffrets, éclairage...) adaptée aux zones [${[...state.zones].join(',')||'n/a'}], aux produits=${state.context.fluids||'-'}, et au procédé=${state.context.processDesc||'-'}. Inclure marquage attendu et catégorie minimale.`;
    openIA(await callAI(prompt), true);
  });
  on('#btnAILocalQA','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const groups = groupByLocal(state.equipments);
    const keys = Object.keys(groups).slice(0,5);
    const sample = keys.map(k => {
      const arr = groups[k].slice(0,5).map(e => `${e.composant} [${e.zone_type||e.exterieur||e.interieur}] ${e.marquage_atex||''}`).join('; ');
      return `Local ${k}: ${arr}`;
    }).join('\n');
    const prompt = `Pour chaque local listé, génère un Q&R d'inspection ciblé (alimentation, IP, marquage, équipements de sécurité, mise à la terre, maintenance) en 6 questions:\n${sample}`;
    openIA(await callAI(prompt), true);
  });
}
async function loadEquip(){
  try{
    const r = await fetch(API.equipments);
    state.equipments = await r.json();
    renderEquip();
    toast('Équipements chargés','info');
  }catch(e){ toast('Erreur chargement équipements','danger'); }
}
function renderEquip(){
  const tbody = qs('#equipTable tbody');
  const s = (val('#fSecteur') || '').toLowerCase();
  const b = (val('#fBat') || '').toLowerCase();
  const c = (val('#fConf') || '');
  const rows = (state.equipments || []).filter(eq =>
    (!s || (eq.secteur||'').toLowerCase().includes(s)) &&
    (!b || (eq.batiment||'').toLowerCase().includes(b)) &&
    (!c || (eq.conformite||'') === c)
  );
  tbody.innerHTML = rows.map(eq => {
    const zone = eq.zone_type || eq.exterieur || eq.interieur || '';
    const catMin = minCategoryFromZone(zone);
    return `<tr>
      <td><input class="form-check-input row-check" type="checkbox" data-id="${eq.id}"></td>
      <td>${safe(eq.id)}</td><td>${safe(eq.composant)}</td><td>${safe(eq.secteur)}</td>
      <td>${safe(eq.batiment)}</td><td>${safe(eq.local)}</td>
      <td><span class="pill">${safe(zone) || 'n/a'}</span></td>
      <td class="code">${safe(eq.marquage_atex)}</td>
      <td class="code">${safe(catMin)}</td>
      <td>${safe(eq.conformite)}</td>
      <td>${safe(eq.risque)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.row-check').forEach(ch => ch.addEventListener('change', () => toggleSelect(ch)));
}
function toggleSelect(ch){
  const id = Number(ch.dataset.id);
  const item = state.equipments.find(e => e.id === id);
  if (!item) return;
  if (ch.checked) state.selectedEquip.set(id, item); else state.selectedEquip.delete(id);
  markDirty();
}
function groupByLocal(arr){
  const m = {};
  (arr||[]).forEach(e=>{
    const key = e.local || 'n/a';
    (m[key] ||= []).push(e);
  });
  return m;
}
function minCategoryFromZone(zone){
  zone = String(zone || '');
  if (zone === '0' || zone.startsWith('0')) return 'II 1G T135°C';
  if (zone === '1' || zone.startsWith('1')) return 'II 2G T135°C';
  if (zone === '2' || zone.startsWith('2')) return 'II 3G T135°C';
  if (zone === '20') return 'II 1D T135°C';
  if (zone === '21') return 'II 2D T135°C';
  return 'II 3D T135°C'; // 22 par défaut
}

// ===== Mesures (IA working)
function bindMeasuresAI(){
  document.querySelectorAll('[data-ai]')?.forEach(btn => btn.addEventListener('click', async ()=>{
    const kind = btn.dataset.ai;
    openIA('Réflexion en cours…', false, true);
    const ctx = `mode=${state.mode}, zones=[${[...state.zones].join(',')}], produits=${state.context.fluids||'-'}, procédé=${state.context.processDesc||'-'}`;
    const prompts = {
      'prev': `À partir de ${ctx}, propose 8 mesures de PREVENTION ATEX (éviter l'atmosphère explosive et les sources d'inflammation). Format puces.`,
      'prev-check': `Vérifie de façon critique ces mesures de PREVENTION ATEX, ajoute si besoin des contrôles/essais et références normatives: \n${val('#measuresPrev')||'-'}`,
      'prot': `À partir de ${ctx}, propose 8 mesures de PROTECTION ATEX (limiter les effets: évents, découplage, confinement, SIS/ESD, zones inertes). Format puces.`,
      'prot-check': `Vérifie de façon critique ces mesures de PROTECTION ATEX, ajoute surveillances, critères d'acceptation et périodicités: \n${val('#measuresProt')||'-'}`,
      'training': `Conçois un programme de FORMATION ATEX adapté à ${ctx} (public, objectifs, contenus, périodicité, traçabilité). 150 mots.`,
      'maintenance': `Propose un PLAN DE MAINTENANCE ATEX (périodicité, inspections, métrologie détecteurs, critères de rejet, consignations). 150 mots pour ${ctx}.`
    };
    const reply = await callAI(prompts[kind]);
    const map = { 'prev':'#measuresPrev','prev-check':'#measuresPrev','prot':'#measuresProt','prot-check':'#measuresProt','training':'#training','maintenance':'#maintenance' };
    const sel = map[kind];
    if (sel){ const el = qs(sel); el.value = (el.value ? el.value + '\n' : '') + reply; markDirty(); }
    openIA(reply, true);
  }));
}

// ===== Build / Export
function bindBuildExport(){
  on('#btnBuild','click', () => {
    const md = buildMarkdown();
    qst('#mdPreview', md);
    qs('#htmlPreview').innerHTML = marked.parse(md);
  });
  on('#btnExportMD','click', () => {
    const md = getMdFromPreviewOrBuild();
    downloadFile('EPD.md', md, 'text/markdown;charset=utf-8');
  });
  on('#btnExportJSON','click', () => {
    const json = buildJsonPayload();
    downloadFile('EPD.json', JSON.stringify(json, null, 2), 'application/json');
  });
  on('#btnSaveServer','click', saveServer);
  on('#btnReset','click', () => { localStorage.removeItem(KEY); location.reload(); });
}

function buildMarkdown(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort((a,b)=>Number(a)-Number(b)).join(', ');
  const equip = [...state.selectedEquip.values()];
  const rows = equip.map(e => `| ${e.id} | ${e.composant||''} | ${e.secteur||''} | ${e.batiment||''} | ${e.local||''} | ${e.zone_type||e.exterieur||e.interieur||''} | ${e.marquage_atex||''} | ${minCategoryFromZone(e.zone_type||e.exterieur||e.interieur)} | ${e.conformite||''} | ${e.risque??''} |`).join('\n');
  return `# Document Relatif à la Protection Contre les Explosions (EPD)

## 1. Informations générales
- **Titre** : ${val('#projectTitle')||''}
- **Statut** : ${val('#projectStatus')||'Brouillon'}
- **Entreprise** : ${ctx.org||''}
- **Site / Installation** : ${ctx.site||''}
- **Adresse** : ${ctx.address||''}
- **Rédacteur** : ${ctx.author||''}
- **Mode** : ${state.mode}

## 2. Description du procédé
${ctx.processDesc||''}

## 3. Données projet / exploitation
- **Produits / fluides** : ${ctx.fluids||''}
- **Conditions opératoires** : ${ctx.operating||''}

## 4. Zonage ATEX
Zones présentes : ${zones||'—'}
Commentaires : ${ctx.zoningNotes||''}

## 5. Équipements inclus dans le périmètre
| ID | Composant | Secteur | Bâtiment | Local | Zone | Marquage ATEX | Catégorie minimale | Conformité | Risque |
|---:|---|---|---|---|---|---|---|---|---:|
${rows||''}

## 6. Mesures de prévention
${val('#measuresPrev')||''}

## 7. Mesures de protection
${val('#measuresProt')||''}

## 8. Formation
${val('#training')||''}

## 9. Maintenance et contrôles
${val('#maintenance')||''}

## 10. Pièces jointes
${(state.attachments||[]).map(a=>`- [${a.name}](${a.url}) (${a.type||'?'}, ${a.size||0} o)`).join('\n')}
`;
}

function getMdFromPreviewOrBuild(){
  const node = qs('#mdPreview');
  if (!node || !node.textContent) return buildMarkdown();
  return node.textContent;
}

function buildJsonPayload(){
  return {
    title: val('#projectTitle') || (state.context?.site || 'EPD'),
    status: val('#projectStatus') || 'Brouillon',
    mode: state.mode,
    context: state.context,
    zones: [...state.zones],
    equipments: [...state.selectedEquip.values()],
    attachments: state.attachments
  };
}

// ===== Export / Server
function downloadFile(name, content, mime){
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function saveServer(){
  try{
    const body = buildJsonPayload();
    const payload = { ...body }; // stocker tout dans payload côté DB
    if (state.currentId) {
      const r = await fetch(`${API.epd}/${state.currentId}`, {
        method:'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ title: body.title, status: body.status, payload })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('Projet mis à jour', 'success');
    } else {
      const r = await fetch(API.epd, {
        method:'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ title: body.title, status: body.status, payload })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      state.currentId = data.id;
      toast('Projet enregistré (id: '+data.id+')', 'success');
    }
    dirty = false; setSaveState('Synchronisé serveur', 'green');
    // refresh list silently
    try { await loadProjects(); } catch {}
  }catch(e){
    toast('Enregistrement serveur indisponible. Vérifie /api/epd', 'warning');
  }
}

// ===== Projects tab
function bindProjects(){
  on('#btnReloadProjects','click', () => loadProjects());
  on('#projFilter','change', () => loadProjects());
  on('#projSearch','input', () => { clearTimeout(window.__searchT); window.__searchT=setTimeout(loadProjects, 400); });
  document.getElementById('projects-tab').addEventListener('shown.bs.tab', loadProjects);
}
async function loadProjects(){
  const status = val('#projFilter') || '';
  const q = val('#projSearch') || '';
  const url = new URL(location.origin + API.epd);
  if (status) url.searchParams.set('status', status);
  if (q) url.searchParams.set('q', q);
  const r = await fetch(url);
  const rows = await r.json();
  renderProjects(rows);
}
function renderProjects(rows){
  const tbody = qs('#projectsTable tbody');
  tbody.innerHTML = (rows||[]).map(x => {
    const date = new Date(x.updated_at || x.created_at || Date.now()).toLocaleString();
    return `<tr>
      <td>${x.id}</td>
      <td>${safe(x.title||'')}</td>
      <td>
        <select class="form-select form-select-sm proj-status" data-id="${x.id}">
          ${['Brouillon','En cours','Terminé'].map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>${date}</td>
      <td class="d-flex gap-2">
        <button class="btn btn-sm btn-primary proj-open" data-id="${x.id}"><i data-lucide="folder-open"></i> Ouvrir</button>
        <button class="btn btn-sm btn-outline-secondary proj-clone" data-id="${x.id}"><i data-lucide="copy"></i> Cloner</button>
        <button class="btn btn-sm btn-outline-danger proj-del" data-id="${x.id}"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.proj-open').forEach(b => b.addEventListener('click', () => openProject(b.dataset.id)));
  tbody.querySelectorAll('.proj-del').forEach(b => b.addEventListener('click', () => deleteProject(b.dataset.id)));
  tbody.querySelectorAll('.proj-clone').forEach(b => b.addEventListener('click', () => cloneProject(b.dataset.id)));
  tbody.querySelectorAll('.proj-status').forEach(s => s.addEventListener('change', () => changeStatus(s.dataset.id, s.value)));
  if (window.lucide) window.lucide.createIcons();
}
async function openProject(id){
  const r = await fetch(`${API.epd}/${id}`);
  if (!r.ok) return toast('Projet introuvable', 'danger');
  const data = await r.json();
  const p = data.payload || {};
  // charge l'état
  state.currentId = data.id;
  state.mode = p.mode || 'projet';
  state.context = p.context || {};
  state.zones = new Set(p.zones || []);
  state.attachments = p.attachments || [];
  state.selectedEquip = new Map(); // on repart propre pour la sélection
  // hydrate UI
  document.getElementById('projectTitle').value = data.title || '';
  document.getElementById('projectStatus').value = data.status || 'Brouillon';
  document.getElementById('modeProjet').checked = state.mode==='projet';
  document.getElementById('modeInspection').checked = state.mode==='inspection';
  Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
  document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
  renderAttachmentThumbs();
  markDirty(); saveLocal(); // on synchronise le brouillon local
  // switch tab
  new bootstrap.Tab(document.getElementById('context-tab')).show();
  toast('Projet chargé', 'info');
}
async function deleteProject(id){
  if (!confirm('Supprimer ce projet ?')) return;
  const r = await fetch(`${API.epd}/${id}`, { method:'DELETE' });
  if (!r.ok) return toast('Suppression impossible', 'danger');
  await loadProjects();
  toast('Projet supprimé', 'success');
}
async function cloneProject(id){
  const r = await fetch(`${API.epd}/${id}`);
  if (!r.ok) return toast('Clonage impossible', 'danger');
  const data = await r.json();
  const payload = data.payload || {};
  const resp = await fetch(API.epd, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ title: (data.title || 'EPD') + ' (copie)', status: 'Brouillon', payload })
  });
  if (!resp.ok) return toast('Clonage impossible', 'danger');
  await loadProjects();
  toast('Projet cloné', 'success');
}
async function changeStatus(id, status){
  const r = await fetch(`${API.epd}/${id}/status`, {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status })
  });
  if (!r.ok) return toast('Statut non mis à jour', 'danger');
  toast('Statut mis à jour', 'success');
}

// ===== IA + UI helpers
async function callAI(question){
  try{
    const r = await fetch(API.chat, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question }) });
    const data = await r.json();
    return (data && (data.response || data.answer)) || '';
  }catch(e){ return '⚠️ IA indisponible.'; }
}

function openIA(html, isMarkdown=false, showLoader=false){
  const panel = document.getElementById('iaPanel');
  const content = document.getElementById('iaDetails');
  const load = document.getElementById('iaLoading');
  if (showLoader){ content.style.display='none'; load.style.display='block'; }
  const oc = bootstrap.Offcanvas.getOrCreateInstance(panel);
  oc.show();
  setTimeout(() => {
    if (isMarkdown) content.innerHTML = marked.parse(html||''); else content.innerHTML = html || '<p class="text-muted">—</p>';
    load.style.display='none'; content.style.display='block';
  }, showLoader ? 350 : 0);
}

function qs(sel, root=document){ return root.querySelector(sel); }
function on(sel, evt, fn){ const el = qs(sel); if (el) el.addEventListener(evt, fn); }
function val(sel){ const el = qs(sel); return el ? el.value : ''; }
function qst(sel, text){ const el = qs(sel); if (el) el.textContent = text; }
function safe(x){ return (x==null? '' : String(x)).replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s])); }

function toast(message, variant='primary'){
  const id='t'+Date.now();
  const html = `
    <div id="${id}" class="toast text-bg-${variant} border-0 mb-2" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  const cont = document.getElementById('toasts');
  cont.insertAdjacentHTML('beforeend', html);
  const t = new bootstrap.Toast(document.getElementById(id), {delay:3000}); t.show();
  setTimeout(()=> document.getElementById(id)?.remove(), 3500);
}
