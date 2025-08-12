// epd.js — vAuth minimal: fetchAuth + redirection 401, reste inchangé
const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',
  epd: '/api/epd',
  epdStatus: (id)=> `/api/epd/${id}/status`,
  upload: '/api/upload'
};

function getToken(){ return localStorage.getItem('autonomix_token'); }
async function fetchAuth(url, opts={}){
  const token = getToken();
  const headers = Object.assign({}, opts.headers||{}, { Authorization: 'Bearer '+token });
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    localStorage.removeItem('autonomix_token');
    localStorage.removeItem('autonomix_user');
    window.location.href = 'login.html';
    throw new Error('401 Unauthorized');
  }
  return res;
}

const state = {
  mode: 'projet',
  context: {},
  zones: new Set(),
  equipments: [],
  selectedEquip: new Map(),
  attachments: [],
  currentProjectId: null
};

let saveTimer = null;

// Boot
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  bindProjects();
  bindContext();
  bindZoning();
  bindEquipments();
  bindMeasuresAI();
  bindBuildExport();
  bindAttachments();
  bindIAChat();
  lockTabs(true);
  loadProjects();
  updateStepStatus();
});

// ===== Tabs lock until a project is open
function lockTabs(lock){
  const tabs = document.getElementById('epdTabs');
  if (!tabs) return;
  if (lock) tabs.classList.add('tab-disabled'); else tabs.classList.remove('tab-disabled');
  tabs.querySelectorAll('button.nav-link').forEach(btn => {
    if (btn.id !== 'projects-tab'){
      btn.addEventListener('click', (e) => {
        if (!state.currentProjectId){
          e.preventDefault();
          toast('Ouvre ou crée un projet dans l’onglet Projets.', 'warning');
          document.querySelector('#projects-tab').click();
        }
      });
    }
  });
}

// ===== Guide next step button
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btnNextStep'){
    const order = ['projects','context','zoning','equip','measures','build'];
    for (const id of order){
      const st = document.getElementById('st-'+id);
      const done = st?.classList.contains('status-green');
      if (!done){
        document.querySelector(`#${id}-tab`)?.click();
        break;
      }
    }
  }
});

function markDirty(){
  if (!state.currentProjectId) return;
  scheduleSave();
  updateStepStatus();
}

function scheduleSave(){
  const el = document.getElementById('saveHint');
  if (el) el.textContent = 'Enregistrement…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveServer, 800);
}

// ===== Server autosave
async function saveServer(){
  if (!state.currentProjectId) return;
  try{
    const payload = buildJsonPayload();
    const title = state.context?.site || 'EPD';
    const body = { title, status: 'Brouillon', payload };
    const r = await fetchAuth(`${API.epd}/${state.currentProjectId}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    await r.json();
    const el = document.getElementById('saveHint');
    if (el) el.textContent = 'Enregistré';
  }catch(e){
    const el = document.getElementById('saveHint');
    if (el) el.textContent = 'Erreur enregistrement';
  }
}

// ===== Projects Tab
function bindProjects(){
  on('#btnProjReload','click', loadProjects);
  on('#projFilter','change', loadProjects);
  on('#projSearch','input', debounce(loadProjects, 400));
  on('#btnProjNew','click', async () => {
    try{
      const payload = buildJsonPayload();
      const title = state.context?.site || 'EPD';
      const r = await fetchAuth(API.epd, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, status:'Brouillon', payload }) });
      const data = await r.json();
      state.currentProjectId = data.id;
      lockTabs(false);
      toast(`Projet créé (#${data.id})`, 'success');
      document.querySelector('#context-tab').click();
      updateStepStatus();
    }catch(e){ toast('Création projet impossible', 'danger'); }
  });
}

async function loadProjects(){
  try{
    const status = val('#projFilter') || '';
    const q = val('#projSearch') || '';
    const url = new URL(API.epd, location.origin);
    if (status) url.searchParams.set('status', status);
    if (q) url.searchParams.set('q', q);
    const r = await fetchAuth(url.toString());
    const rows = await r.json();
    renderProjects(rows);
  }catch(e){ console.error(e); }
}
function renderProjects(rows){
  const tbody = document.querySelector('#projTable tbody');
  tbody.innerHTML = (rows||[]).map(p => {
    const d = new Date(p.updated_at || p.created_at || Date.now());
    const dd = d.toLocaleString();
    return `<tr>
      <td>${p.id}</td>
      <td>${safe(p.title||'EPD')}</td>
      <td>
        <span class="badge bg-${p.status==='Terminé'?'success':p.status==='En cours'?'warning text-dark':'secondary'}">${p.status}</span>
      </td>
      <td>${dd}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" data-proj-open="${p.id}"><i data-lucide="folder-open"></i> Ouvrir</button>
          <button class="btn btn-outline-secondary" data-proj-clone="${p.id}"><i data-lucide="copy"></i> Cloner</button>
          <button class="btn btn-outline-danger" data-proj-del="${p.id}"><i data-lucide="trash-2"></i></button>
          <div class="btn-group">
            <button class="btn btn-outline-dark dropdown-toggle" data-bs-toggle="dropdown"><i data-lucide="check-circle-2"></i> Statut</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" data-proj-status="${p.id}|Brouillon">Brouillon</a></li>
              <li><a class="dropdown-item" data-proj-status="${p.id}|En cours">En cours</a></li>
              <li><a class="dropdown-item" data-proj-status="${p.id}|Terminé">Terminé</a></li>
            </ul>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
  tbody.querySelectorAll('[data-proj-open]').forEach(b => b.addEventListener('click', ()=> openProject(b.dataset.projOpen)));
  tbody.querySelectorAll('[data-proj-clone]').forEach(b => b.addEventListener('click', ()=> cloneProject(b.dataset.projClone)));
  tbody.querySelectorAll('[data-proj-del]').forEach(b => b.addEventListener('click', ()=> deleteProject(b.dataset.projDel)));
  tbody.querySelectorAll('[data-proj-status]').forEach(a => a.addEventListener('click', ()=> {
    const [id, status] = a.dataset.projStatus.split('|');
    updateProjectStatus(id, status);
  }));
}
async function openProject(id){
  try{
    const r = await fetchAuth(`${API.epd}/${id}`);
    const data = await r.json();
    state.currentProjectId = data.id;
    const p = data.payload || {};
    state.mode = p.mode || 'projet';
    state.context = p.context || {};
    state.zones = new Set(p.zones || []);
    state.attachments = p.attachments || [];
    Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
    document.getElementById('modeProjet').checked = state.mode==='projet';
    document.getElementById('modeInspection').checked = state.mode==='inspection';
    document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
    renderAttachmentThumbs();
    lockTabs(false);
    toast(`Projet #${id} ouvert`, 'primary');
    document.querySelector('#context-tab').click();
    updateStepStatus();
  }catch(e){ toast('Ouverture projet impossible', 'danger'); }
}
async function cloneProject(id){
  try{
    const r = await fetchAuth(`${API.epd}/${id}`);
    const data = await r.json();
    const body = { title: (data.title||'EPD') + ' (copie)', status: 'Brouillon', payload: data.payload };
    const r2 = await fetchAuth(API.epd, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const created = await r2.json();
    toast(`Projet cloné (#${created.id})`, 'success');
    loadProjects();
  }catch(e){ toast('Clonage impossible', 'danger'); }
}
async function deleteProject(id){
  if (!confirm('Supprimer ce projet ?')) return;
  try{
    const r = await fetchAuth(`${API.epd}/${id}`, { method:'DELETE' });
    const data = await r.json();
    if (!data.ok) throw new Error();
    toast('Projet supprimé', 'warning');
    if (String(state.currentProjectId)===String(id)) { state.currentProjectId=null; lockTabs(true); }
    loadProjects();
    updateStepStatus();
  }catch(e){ toast('Suppression impossible', 'danger'); }
}
async function updateProjectStatus(id, status){
  try{
    const r = await fetchAuth(API.epdStatus(id), { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    await r.json();
    toast(`Statut mis à jour`, 'info');
    loadProjects();
  }catch(e){ toast('Maj statut impossible', 'danger'); }
}

// ===== Context + Attachments + Mode
function bindContext(){
  ['org','site','address','author','processDesc','fluids','operating','zoningNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.context[id] = el.value; markDirty(); });
  });
  document.getElementsByName('modeEPD').forEach(r => r.addEventListener('change', () => {
    state.mode = document.getElementById('modeProjet').checked ? 'projet' : 'inspection';
    markDirty();
  }));
  on('#btnScopeChecklist','click', async () => {
    const prompt = `Agis en ingénieur process safety. À partir de ces infos (fluids: ${state.context.fluids||'-'}, operating: ${state.context.operating||'-'}), rédige une checklist de cadrage projet ATEX/EPD (données à collecter, normes, interfaces HSE, essais requis) en 12 points.`;
    applyIA(await callAI(prompt), '#processDesc');
  });
  on('#btnScopeHazid','click', async () => {
    const prompt = `Agis en HAZID leader. Procédé: ${state.context.processDesc||'-'}, produits: ${state.context.fluids||'-'}, conditions: ${state.context.operating||'-'}. Propose une pré-HAZID (sources ATEX, scénarios, barrières, actions) en Markdown.`;
    openIA(await callAI(prompt), true);
  });
  on('#btnAICompleteContext','click', async () => {
    const prompt = `Complète et améliore la description du procédé et les hypothèses opératoires pour un EPD. Procédé: ${state.context.processDesc||'-'}. Fluides: ${state.context.fluids||'-'}. Conditions: ${state.context.operating||'-'}. 120-150 mots.`;
    applyIA(await callAI(prompt), '#processDesc');
  });
}

function bindAttachments(){
  const input = document.getElementById('attachments');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    if (!state.currentProjectId){ toast('Crée ou ouvre un projet d’abord.', 'warning'); input.value=''; return; }
    const files = Array.from(e.target.files||[]);
    if (!files.length) return;
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    try{
      const r = await fetchAuth(API.upload, { method:'POST', body: form });
      const uploaded = await r.json();
      state.attachments.push(...uploaded);
      renderAttachmentThumbs();
      markDirty();
      toast(`${uploaded.length} fichier(s) téléversé(s)`, 'info');
    }catch(err){
      toast('Upload impossible', 'danger');
    }finally{
      input.value = '';
    }
  });
}
function renderAttachmentThumbs(){
  const holder = document.getElementById('attachmentPreview');
  if (!holder) return;
  holder.innerHTML = '';
  state.attachments.forEach(a=>{
    const isImg = (a.type||'').startsWith('image/');
    const html = isImg
      ? `<div class="d-inline-block me-2 mb-2 text-center"><img class="thumb" src="${a.url}" alt="${a.name}"><div class="small-muted">${a.name}</div></div>`
      : `<div class="d-inline-block me-2 mb-2 text-center"><div class="thumb d-flex align-items-center justify-content-center bg-light">PDF</div><div class="small-muted"><a href="${a.url}" target="_blank">${a.name}</a></div></div>`;
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
    const prompt = `Tu es expert ATEX. Produits=${state.context.fluids||'-'}, procédé=${state.context.processDesc||'-'}, conditions=${state.context.operating||'-'}. Propose un zonage (zones, étendue, critères 60079-10-x) + hypothèses et limites. Indique clairement les zones 0/1/2/20/21/22 concernées.`;
    const reply = await callAI(prompt);
    const found = (reply.match(/Zone\\s?(0|1|2|20|21|22)/gi) || []).map(x=>x.replace(/[^0-9]/g,''));
    if (found.length){
      document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => {
        cb.checked = found.includes(cb.value);
        if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value);
      });
      markDirty();
    }
    openIA(reply, true);
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
    const prompt = `Analyse la sélection, signale les non-conformités (catégorie/zone/IP/Tmax), propose 5 corrections priorisées:\n${sample}`;
    openIA(await callAI(prompt), true);
  });
  on('#btnAIProposeEquip','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const prompt = `Mode=${state.mode}. Propose des équipements ATEX types (moteurs, capteurs, coffrets, éclairage...) pour zones [${[...state.zones].join(',')||'n/a'}], produits=${state.context.fluids||'-'}, procédé=${state.context.processDesc||'-'}. Inclure marquage et catégorie min.`;
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
    const prompt = `Pour chaque local listé, génère un Q&R d'inspection (alimentation, IP, marquage, équipements de sécurité, mise à la terre, maintenance) en 6 questions:\n${sample}`;
    openIA(await callAI(prompt), true);
  });
}
async function loadEquip(){
  try{
    const r = await fetchAuth(API.equipments);
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
  (arr||[]).forEach(e=>{ const key = e.local || 'n/a'; (m[key] ||= []).push(e); });
  return m;
}
function minCategoryFromZone(zone){
  zone = String(zone || '');
  if (zone === '0' || zone.startsWith('0')) return 'II 1G T135°C';
  if (zone === '1' || zone.startsWith('1')) return 'II 2G T135°C';
  if (zone === '2' || zone.startsWith('2')) return 'II 3G T135°C';
  if (zone === '20') return 'II 1D T135°C';
  if (zone === '21') return 'II 2D T135°C';
  return 'II 3D T135°C';
}

// ===== Mesures (IA)
function bindMeasuresAI(){
  document.querySelectorAll('[data-ai]')?.forEach(btn => btn.addEventListener('click', async ()=>{
    const kind = btn.dataset.ai;
    openIA('Réflexion en cours…', false, true);
    const ctx = `mode=${state.mode}, zones=[${[...state.zones].join(',')}], produits=${state.context.fluids||'-'}, procédé=${state.context.processDesc||'-'}`;
    const prompts = {
      'prev': `À partir de ${ctx}, propose 8 mesures de PREVENTION ATEX (éviter l'atmosphère explosive et les sources d'inflammation). Format puces.`,
      'prev-check': `Vérifie ces mesures de PREVENTION ATEX, ajoute contrôles/essais et références: \n${val('#measuresPrev')||'-'}`,
      'prot': `À partir de ${ctx}, propose 8 mesures de PROTECTION ATEX (limiter les effets: évents, découplage, confinement, SIS/ESD, zones inertes). Format puces.`,
      'prot-check': `Vérifie ces mesures de PROTECTION ATEX, ajoute surveillances, critères d'acceptation et périodicités: \n${val('#measuresProt')||'-'}`,
      'training': `Conçois un programme de FORMATION ATEX pour ${ctx} (public, objectifs, contenus, périodicité, traçabilité). 150 mots.`,
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
}

function buildMarkdown(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort((a,b)=>Number(a)-Number(b)).join(', ');
  const equip = [...state.selectedEquip.values()];
  const rows = equip.map(e => `| ${e.id} | ${e.composant||''} | ${e.secteur||''} | ${e.batiment||''} | ${e.local||''} | ${e.zone_type||e.exterieur||e.interieur||''} | ${e.marquage_atex||''} | ${minCategoryFromZone(e.zone_type||e.exterieur||e.interieur)} | ${e.conformite||''} | ${e.risque??''} |`).join('\n');
  return `# Document Relatif à la Protection Contre les Explosions (EPD)

## 1. Informations générales
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

## 5. Équipements (sélection)
| ID | Composant | Secteur | Bâtiment | Local | Zone | Marquage ATEX | Catégorie minimale | Conformité | Risque |
|---:|---|---|---|---|---|---|---|---|---:|
${rows||''}

## 6. Pièces jointes
${(state.attachments||[]).map(a=>`- [${a.name}](${a.url})`).join('\n')}
`;
}

function getMdFromPreviewOrBuild(){
  const node = qs('#mdPreview');
  if (!node || !node.textContent) return buildMarkdown();
  return node.textContent;
}

function buildJsonPayload(){
  return {
    mode: state.mode,
    context: state.context,
    zones: [...state.zones],
    attachments: state.attachments,
    equipmentsSelected: [...state.selectedEquip.values()]
  };
}

// ===== IA chat
function bindIAChat(){
  on('#iaSend','click', sendChat);
  const input = document.getElementById('iaInput');
  if (input) input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') sendChat(); });
}
async function sendChat(){
  const input = document.getElementById('iaInput');
  const msg = (input?.value||'').trim();
  if (!msg) return;
  const ctx = `Mode=${state.mode}; Produits=${state.context.fluids||'-'}; Procédé=${state.context.processDesc||'-'}; Conditions=${state.context.operating||'-'}`;
  openIA('Réflexion en cours…', false, true);
  const reply = await callAI(ctx + '\nQuestion: ' + msg);
  openIA(reply, true);
  input.value='';
}

// ===== Step completion logic
function updateStepStatus(){
  setDot('projects', !!state.currentProjectId);
  setDot('context', Boolean(state.context.org && state.context.site && state.context.author && state.context.processDesc));
  setDot('zoning', state.zones.size>0);
  setDot('equip', state.selectedEquip.size>0);
  const measuresDone = Boolean((val('#measuresPrev')||'').trim() || (val('#measuresProt')||'').trim());
  setDot('measures', measuresDone);
  const allDone = ['projects','context','zoning','equip','measures'].every(id => isGreen(id));
  setDot('build', allDone);
}
function isGreen(id){ return document.getElementById('st-'+id)?.classList.contains('status-green'); }
function setDot(id, done){
  const el = document.getElementById('st-'+id);
  if (!el) return;
  el.classList.toggle('status-green', !!done);
  el.classList.toggle('status-orange', !done);
}

// ===== IA helpers + UI
async function callAI(question){
  try{
    const r = await fetchAuth(API.chat, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question }) });
    const data = await r.json();
    return (data && (data.response || data.answer)) || '';
  }catch(e){ return 'IA indisponible.'; }
}
function applyIA(markdown, selector){
  const el = qs(selector);
  if (!el) return openIA(markdown, true);
  el.value = (el.value ? el.value + '\n' : '') + markdown;
  markDirty();
  openIA(markdown, true);
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
  const t = new bootstrap.Toast(document.getElementById(id), {delay:2800}); t.show();
  setTimeout(()=> document.getElementById(id)?.remove(), 3200);
}
function debounce(fn, ms){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
