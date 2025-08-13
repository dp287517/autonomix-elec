// public/js/epd.js — IA propre + génération CDC + UI modales

const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',          // endpoint IA déjà présent dans ton app
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
  bindMeasuresAI();
  bindBuildExport();
  bindAttachments();
  bindIAChat();
  lockTabs(true);
  loadProjects();
  updateStepStatus();
});

/* -------------------- Utils -------------------- */
function qs(sel, root=document){ return root.querySelector(sel); }
function on(sel, evt, fn){ const el = qs(sel); if (el) el.addEventListener(evt, fn); }
function val(sel){ const el = qs(sel); return el ? el.value : ''; }
function qst(sel, text){ const el = qs(sel); if (el) el.textContent = text; }
function safe(x){ return (x==null? '' : String(x)).replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s])); }
function debounce(fn, ms){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function toast(message, variant='primary'){
  const id='t'+Date.now();
  const html = `
    <div id="${id}" class="toast text-bg-${variant} border-0 mb-2" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  const cont = document.getElementById('toasts') || (()=>{
    const d = document.createElement('div');
    d.className = 'toast-container position-fixed top-0 end-0 p-3';
    d.id = 'toasts';
    d.style.zIndex = '2000';
    document.body.appendChild(d);
    return d;
  })();
  cont.insertAdjacentHTML('beforeend', html);
  const t = new bootstrap.Toast(document.getElementById(id), {delay:2800}); t.show();
  setTimeout(()=> document.getElementById(id)?.remove(), 3200);
}

function lockTabs(lock){
  const tabs = document.getElementById('epdTabs');
  if (!tabs) return;
  tabs.classList.toggle('tab-disabled', !!lock);
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

/* -------------------- IA Offcanvas -------------------- */
function openIA(html, isMarkdown=false, showLoader=false){
  const panel = document.getElementById('iaPanel');
  const content = document.getElementById('iaDetails');
  const load = document.getElementById('iaLoading');
  if (showLoader){ content.style.display='none'; load.style.display='block'; }
  const oc = bootstrap.Offcanvas.getOrCreateInstance(panel);
  oc.show();
  setTimeout(() => {
    let out = html || '';
    if (isMarkdown) {
      try { out = marked.parse(out); } catch {}
    }
    content.innerHTML = out;
    load.style.display='none'; content.style.display='block';
  }, showLoader ? 200 : 0);
}

async function callAI(question){
  try{
    const r = await fetchAuth(API.chat, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question }) });
    const data = await r.json();
    return (data && (data.response || data.answer)) || '';
  }catch(e){ return 'IA indisponible.'; }
}

/* Sanitize any AI output (textarea + display) */
function aiToPlain(str){
  if (!str) return '';
  let s = String(str);
  // remove code fences
  s = s.replace(/```[\s\S]*?```/g, (m)=> m.replace(/```/g,''));
  // remove full document wrappers
  s = s.replace(/<!DOCTYPE[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
  // lists
  s = s.replace(/<\/?ul[^>]*>/gi, '');
  s = s.replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n');
  // paragraphs & line breaks
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<p[^>]*>/gi, '');
  // leftover tags
  s = s.replace(/<[^>]+>/g, '');
  // markdown bullets normalization
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
function aiToMarkdownForDisplay(str){
  const plain = aiToPlain(str);
  return plain;
}
function applyIA(markdown, selector){
  const el = qs(selector);
  const clean = aiToPlain(markdown);
  if (el){
    el.value = (el.value ? el.value + '\n' : '') + clean;
    if (selector === '#processDesc') state.context.processDesc = el.value;
  }
  openIA(aiToMarkdownForDisplay(markdown), true);
  markDirty();
}

/* -------------------- Projects -------------------- */
function bindProjects(){
  on('#btnProjReload','click', loadProjects);
  on('#projFilter','change', loadProjects);
  on('#projSearch','input', debounce(loadProjects, 350));
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
      loadProjects(); // apparition immédiate en liste
    }catch(e){ toast('Création projet impossible', 'danger'); }
  });

  // Status modal
  on('#statusSave','click', () => {
    const id = qs('#statusModal').dataset.projId;
    const status = val('input[name="projStatusRadio"]:checked');
    if (!id || !status) return;
    updateProjectStatus(id, status);
    bootstrap.Modal.getInstance(qs('#statusModal'))?.hide();
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
    let data; try { data = await r.json(); } catch { data = []; }
    renderProjects(Array.isArray(data)? data: []);
  }catch(e){
    console.error(e);
    toast('Chargement des projets impossible.', 'danger');
    renderProjects([]);
  }
}
function renderProjects(rows){
  const tbody = document.querySelector('#projTable tbody');
  tbody.innerHTML = (rows||[]).map(p => {
    const d = new Date(p.updated_at || p.created_at || Date.now());
    const dd = d.toLocaleString();
    return `<tr>
      <td>${p.id}</td>
      <td>${safe(p.title||'EPD')}</td>
      <td><span class="badge bg-${p.status==='Terminé'?'success':p.status==='En cours'?'warning text-dark':'secondary'}">${p.status}</span></td>
      <td>${dd}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" data-proj-open="${p.id}"><i data-lucide="folder-open"></i> Ouvrir</button>
          <button class="btn btn-outline-secondary" data-proj-clone="${p.id}"><i data-lucide="copy"></i> Cloner</button>
          <button class="btn btn-outline-danger" data-proj-del="${p.id}"><i data-lucide="trash-2"></i> Supprimer</button>
          <button class="btn btn-outline-dark" data-proj-status="${p.id}"><i data-lucide="check-circle-2"></i> Statut</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
  tbody.querySelectorAll('[data-proj-open]').forEach(b => b.addEventListener('click', ()=> openProject(b.dataset.projOpen)));
  tbody.querySelectorAll('[data-proj-clone]').forEach(b => b.addEventListener('click', ()=> cloneProject(b.dataset.projClone)));
  tbody.querySelectorAll('[data-proj-del]').forEach(b => b.addEventListener('click', ()=> showDeleteModal(b.dataset.projDel)));
  tbody.querySelectorAll('[data-proj-status]').forEach(b => b.addEventListener('click', ()=> showStatusModal(b.dataset.projStatus)));
}

function showDeleteModal(id){
  const modal = qs('#deleteModal');
  modal.dataset.projId = id;
  const m = new bootstrap.Modal(modal);
  m.show();
}
on('#deleteConfirm','click', async () => {
  const id = qs('#deleteModal').dataset.projId;
  await deleteProject(id);
  bootstrap.Modal.getInstance(qs('#deleteModal'))?.hide();
});

function showStatusModal(id){
  const modal = qs('#statusModal');
  modal.dataset.projId = id;
  modal.querySelectorAll('input[name="projStatusRadio"]').forEach(r => r.checked=false);
  const m = new bootstrap.Modal(modal);
  m.show();
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
    state.zoningSelections = Array.isArray(p.zoningSelections) ? p.zoningSelections : [];
    Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
    document.getElementById('modeProjet').checked = state.mode==='projet';
    document.getElementById('modeInspection').checked = state.mode==='inspection';
    document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
    renderAttachmentThumbs();
    renderZoningList();
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
  try{
    const r = await fetchAuth(`${API.epd}/${id}`, { method:'DELETE' });
    const data = await r.json();
    if (!data.ok && !data.success) throw new Error();
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

/* -------------------- Context -------------------- */
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
    openIA('Réflexion en cours…', false, true);
    const prompt = makePrompt('checklist');
    const reply = await callAI(prompt);
    applyIA(reply, '#processDesc');
  });
  on('#btnScopeHazid','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const prompt = makePrompt('pre_hazid');
    const reply = await callAI(prompt);
    openIA(aiToMarkdownForDisplay(reply), true);
  });
  on('#btnAICompleteContext','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const prompt = makePrompt('context_complete');
    const reply = await callAI(prompt);
    applyIA(reply, '#processDesc');
  });
}

/* -------------------- Attachments -------------------- */
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
      : `<div class="d-inline-block me-2 mb-2 text-center"><div class="thumb d-flex align-items-center justify-content-center bg-light">PJ</div><div class="small-muted"><a href="${a.url}" target="_blank">${a.name}</a></div></div>`;
    holder.insertAdjacentHTML('beforeend', html);
  });
}

/* -------------------- Zoning -------------------- */
function bindZoning(){
  document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value); markDirty(); });
  });

  on('#btnAIIntroZoning','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI('Explique brièvement les zones ATEX 0/1/2/20/21/22 et leurs critères, en 120 mots.');
    openIA(aiToMarkdownForDisplay(reply), true);
  });
  on('#btnAIProposeZoning','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const ctx = makeContextDigest();
    const prompt = `Tu es expert ATEX. ${ctx}\nPropose un zonage (zones, étendue, critères 60079-10-x) + hypothèses et limites. Indique clairement les zones 0/1/2/20/21/22 concernées.`;
    const reply = await callAI(prompt);
    const found = (reply.match(/Zone\s?(0|1|2|20|21|22)/gi) || []).map(x=>x.replace(/[^0-9]/g,''));
    if (found.length){
      document.querySelectorAll('#zoning input[type="checkbox"]').forEach(cb => {
        cb.checked = found.includes(cb.value);
        if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value);
      });
      markDirty();
    }
    openIA(aiToMarkdownForDisplay(reply), true);
  });

  on('#btnZoningAdd','click', () => {
    const bat = (qs('#zoneBat')?.value || '').trim();
    const loc = (qs('#zoneLocal')?.value || '').trim();
    const zones = [...document.querySelectorAll('#zoning input[type="checkbox"]:checked')].map(cb => cb.value);
    if (!bat && !loc) return toast('Renseigne au moins Bâtiment ou Local.', 'warning');
    if (!zones.length) return toast('Coche au moins une zone.', 'warning');

    const idx = state.zoningSelections.findIndex(z => (z.batiment||'').toLowerCase()===bat.toLowerCase() && (z.local||'').toLowerCase()===loc.toLowerCase());
    if (idx>=0){
      const s = new Set([ ...state.zoningSelections[idx].zones, ...zones ]);
      state.zoningSelections[idx].zones = [...s];
    } else {
      state.zoningSelections.push({ batiment: bat, local: loc, zones });
    }
    renderZoningList();
    markDirty();
  });

  renderZoningList();
}
function renderZoningList(){
  const host = qs('#zoningList'); if (!host) return;
  if (!state.zoningSelections.length){ host.innerHTML = '<div class="text-muted">Aucune sélection ajoutée.</div>'; return; }
  host.innerHTML = state.zoningSelections.map((z,i) => {
    const label = [z.batiment||'—', z.local||'—'].join(' / ');
    return `<div class="border rounded p-2 d-flex justify-content-between align-items-center mb-2">
      <div><strong>${safe(label)}</strong> — Zones: <span class="pill">${z.zones.join(', ')}</span></div>
      <button class="btn btn-sm btn-outline-danger" data-zdel="${i}"><i data-lucide="x"></i></button>
    </div>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
  host.querySelectorAll('[data-zdel]').forEach(btn => btn.addEventListener('click', ()=>{
    const i = Number(btn.dataset.zdel);
    state.zoningSelections.splice(i,1);
    renderZoningList();
    markDirty();
  }));
}

/* -------------------- Equipments -------------------- */
function bindEquipments(){
  on('#btnEquipNew','click', () => {
    const m = new bootstrap.Modal(document.getElementById('equipModal'));
    document.getElementById('equipForm').reset?.();
    m.show();
  });
  const equipForm = document.getElementById('equipForm');
  if (equipForm) equipForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body = {
      composant: val('#eqComposant'),
      secteur: val('#eqSecteur'),
      batiment: val('#eqBatiment'),
      local: val('#eqLocal'),
      marquage_atex: val('#eqMarquage'),
      conformite: val('#eqConformite'),
      risque: val('#eqRisque')
    };
    const z = String(val('#eqZone')||'').trim();
    if (['0','1','2'].includes(z)) body.zone_gaz = z; else if (['20','21','22'].includes(z)) body.zone_poussieres = Number(z);
    try{
      const r = await fetchAuth(API.equipments, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('post_failed');
      const created = await r.json();
      state.equipments.unshift(created);
      toast('Équipement créé (API).','success');
    }catch(_){
      const tmp = Object.assign({ id: Date.now(), _local: true, zone_type: z }, body);
      state.equipments.unshift(tmp);
      toast('Équipement ajouté (local).','warning');
    }
    renderEquip();
    bootstrap.Modal.getInstance(document.getElementById('equipModal'))?.hide();
  });

  on('#btnAIEq','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI(makePrompt('equip_analyse'));
    openIA(aiToMarkdownForDisplay(reply), true);
  });
  on('#btnAILocalQA','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI(makePrompt('local_qa'));
    openIA(aiToMarkdownForDisplay(reply), true);
  });

  on('#fSecteur','input', renderEquip);
  on('#fBat','input', renderEquip);
  on('#fConf','change', renderEquip);
  on('#fByZoning','change', renderEquip);
  on('#checkAll','change', (e) => {
    document.querySelectorAll('.row-check').forEach(ch => { ch.checked = e.target.checked; toggleSelect(ch); });
  });

  loadEquip();
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
  const useZ = qs('#fByZoning')?.checked;

  function zoneCode(z){ const m = String(z||'').match(/20|21|22|0|1|2/); return m ? m[0] : ''; }
  let rows = (state.equipments || []).filter(eq =>
    (!s || (eq.secteur||'').toLowerCase().includes(s)) &&
    (!b || (eq.batiment||'').toLowerCase().includes(b)) &&
    (!c || (eq.conformite||'') === c)
  );

  if (useZ && state.zoningSelections.length){
    rows = rows.filter(eq => {
      const zc = zoneCode(eq.zone_type || eq.exterieur || eq.interieur || eq.zone_gaz || eq.zone_poussieres);
      return state.zoningSelections.some(sel => {
        const mb = !sel.batiment || (eq.batiment||'').toLowerCase() === sel.batiment.toLowerCase();
        const ml = !sel.local || (eq.local||'').toLowerCase() === sel.local.toLowerCase();
        const mz = !sel.zones?.length || sel.zones.includes(zc);
        return mb && ml && mz;
      });
    });
  }

  tbody.innerHTML = rows.map(eq => {
    const zone = eq.zone_type || eq.exterieur || eq.interieur || eq.zone_gaz || eq.zone_poussieres || '';
    const catMin = minCategoryFromZone(zone);
    return `<tr>
      <td><input class="form-check-input row-check" type="checkbox" data-id="${eq.id}"></td>
      <td>${safe(eq.id ?? '')}</td>
      <td>${safe(eq.composant||'')}</td>
      <td>${safe(eq.secteur||'')}</td>
      <td>${safe(eq.batiment||'')}</td>
      <td>${safe(eq.local||'')}</td>
      <td><span class="pill">${safe(zone) || 'n/a'}</span></td>
      <td class="code">${safe(eq.marquage_atex||'')}</td>
      <td class="code">${safe(catMin)}</td>
      <td>${safe(eq.conformite||'')}</td>
      <td>${safe(eq.risque ?? '')}</td>
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
function minCategoryFromZone(zone){
  zone = String(zone || '').trim();
  if (zone === '0') return 'II 1G';
  if (zone === '1') return 'II 2G';
  if (zone === '2') return 'II 3G';
  if (zone === '20') return 'II 1D';
  if (zone === '21') return 'II 2D';
  if (zone === '22') return 'II 3D';
  return '';
}

/* -------------------- Mesures + IA -------------------- */
function bindMeasuresAI(){
  document.querySelectorAll('[data-ai]')?.forEach(btn => btn.addEventListener('click', async ()=>{
    const kind = btn.dataset.ai;
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI(makePrompt(kind));
    const map = { 'prev':'#measuresPrev','prev-check':'#measuresPrev','prot':'#measuresProt','prot-check':'#measuresProt' };
    const sel = map[kind];
    if (sel){
      const el = qs(sel);
      const plain = aiToPlain(reply);
      el.value = (el.value ? el.value + '\n' : '') + plain;
      markDirty();
    }
    openIA(aiToMarkdownForDisplay(reply), true);
  }));

  on('#measuresPrev', 'input', markDirty);
  on('#measuresProt', 'input', markDirty);

  on('#btnTrainingIA','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI(makePrompt('training'));
    const el = qs('#training');
    el.value = (el.value? el.value+'\n':'') + aiToPlain(reply);
    markDirty();
    openIA(aiToMarkdownForDisplay(reply), true);
  });
  on('#btnMaintenanceIA','click', async () => {
    openIA('Réflexion en cours…', false, true);
    const reply = await callAI(makePrompt('maintenance'));
    const el = qs('#maintenance');
    el.value = (el.value? el.value+'\n':'') + aiToPlain(reply);
    markDirty();
    openIA(aiToMarkdownForDisplay(reply), true);
  });
}

function makeContextDigest(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort().join(', ');
  const zsel = state.zoningSelections.map(z => `${z.batiment||'—'}/${z.local||'—'}→[${z.zones.join(',')}]`).join('; ');
  const equipments = [...state.selectedEquip.values()].slice(0, 25).map(e => `${e.composant||'?'} ${e.marquage_atex||''} ${e.conformite||''} (${e.batiment||'?'}/${e.local||'?'}, zone ${e.zone_type||e.zone_gaz||e.zone_poussieres||e.exterieur||e.interieur||'?'})`).join('; ');
  return `Contexte: entreprise="${ctx.org||''}", site="${ctx.site||''}", rédacteur="${ctx.author||''}". Procédé: ${ctx.processDesc||''}. Fluides: ${ctx.fluids||''}. Conditions: ${ctx.operating||''}. Zonage: [${zones}] | Sélections: ${zsel||'—'}. Équipements sélectionnés: ${equipments||'—'}.`;
}
function makePrompt(kind){
  const digest = makeContextDigest();
  const prev = (qs('#measuresPrev')?.value||'').trim();
  const prot = (qs('#measuresProt')?.value||'').trim();
  switch(kind){
    case 'checklist':
      return `${digest}\nTu es ingénieur process safety. Génère une CHECKLIST DE CADRAGE ATEX/EPD en 12 points, concise, en puces, sans balises HTML, en français.`;
    case 'pre_hazid':
      return `${digest}\nTu es HAZID leader. Produit une PRÉ-HAZID compacte : Sources ATEX, Scénarios, Barrières, Actions. Format Markdown propre (titres ##, puces -), pas de HTML.`;
    case 'context_complete':
      return `${digest}\nComplète/améliore la DESCRIPTION DU PROCÉDÉ et HYPOTHÈSES OPÉRATOIRES (120-150 mots), en texte brut (pas de HTML), phrases courtes.`;
    case 'equip_analyse':
      return `${digest}\nAnalyse les équipements sélectionnés: non-conformités (catégorie/zone/IP/Tmax), 5 corrections priorisées, liste d'actions par local. Format Markdown propre, sans HTML.`;
    case 'local_qa':
      return `${digest}\nGénère pour chaque local une check-list Q&R (6 questions) couvrant alimentation, IP, marquage ATEX, sécurité, terre, maintenance. Format Markdown propre.`;
    case 'prev':
      return `${digest}\nPropose 8 MESURES DE PRÉVENTION ATEX adaptées au contexte. Puces en texte brut, pas de HTML.`;
    case 'prev-check':
      return `${digest}\nAméliore/Vérifie les MESURES DE PRÉVENTION existantes:\n${prev}\nAjoute contrôles, critères d'acceptation et périodicités. Puces, pas de HTML.`;
    case 'prot':
      return `${digest}\nPropose 8 MESURES DE PROTECTION ATEX (effets: évents, découplage, confinement, SIS/ESD, inertage) adaptées. Puces, pas de HTML.`;
    case 'prot-check':
      return `${digest}\nAméliore/Vérifie les MESURES DE PROTECTION existantes:\n${prot}\nAjoute surveillances, critères d'acceptation et périodicités. Puces, pas de HTML.`;
    case 'training':
      return `${digest}\nPropose un PROGRAMME DE FORMATION ATEX/EPD (modules, objectifs, publics, durée, évaluations). Puces, pas de HTML.`;
    case 'maintenance':
      return `${digest}\nPropose un PLAN DE MAINTENANCE/CONTRÔLES pour équipements ATEX (catégories, périodicité, critères d'acceptation). Puces, pas de HTML.`;
    default:
      return digest;
  }
}

/* -------------------- Build / Export -------------------- */
function bindBuildExport(){
  on('#btnBuild','click', () => {
    const md = buildMarkdownCDC();
    qst('#mdPreview', md);
    qs('#htmlPreview').innerHTML = marked.parse(md);
  });
  on('#btnExportMD','click', () => {
    const md = getMdFromPreviewOrBuild();
    downloadFile('EPD-CDC.md', md, 'text/markdown;charset=utf-8');
  });
  on('#btnExportJSON','click', () => {
    const json = buildJsonPayload();
    downloadFile('EPD.json', JSON.stringify(json, null, 2), 'application/json');
  });
}

function buildMarkdownCDC(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort((a,b)=>Number(a)-Number(b)).join(', ');
  const equip = [...state.selectedEquip.values()];
  const rows = equip.map(e => `| ${e.id||''} | ${e.composant||''} | ${e.secteur||''} | ${e.batiment||''} | ${e.local||''} | ${e.zone_type||e.exterieur||e.interieur||e.zone_gaz||e.zone_poussieres||''} | ${e.marquage_atex||''} | ${e.conformite||''} | ${e.risque??''} |`).join('\n');
  const zoningExpl = state.zoningSelections.map(z => `- **${z.batiment||'—'} / ${z.local||'—'}** → zones: ${z.zones.join(', ')}`).join('\n');

  const prev = (qs('#measuresPrev')?.value||'').trim();
  const prot = (qs('#measuresProt')?.value||'').trim();
  const training = (qs('#training')?.value||'').trim();
  const maintenance = (qs('#maintenance')?.value||'').trim();

  return `# Cahier des Charges — Document Relatif à la Protection Contre les Explosions (EPD)

## 0. Synthèse exécutive
- **Entreprise**: ${ctx.org||'—'} | **Site**: ${ctx.site||'—'} | **Rédacteur**: ${ctx.author||'—'}
- **Portée**: ${ctx.processDesc?.slice(0,180)||'—'} …
- **Zonage présent**: ${zones||'—'}
- **Équipements sélectionnés**: ${equip.length}

## 1. Description du procédé et hypothèses
${ctx.processDesc||'—'}

**Fluides**: ${ctx.fluids||'—'}  
**Conditions opératoires**: ${ctx.operating||'—'}

## 2. Zonage ATEX
Zones présentes : ${zones||'—'}

Sélections Bâtiment/Local :
${zoningExpl || '—'}

Commentaires : ${ctx.zoningNotes||'—'}

## 3. Équipements concernés (sélection)
| ID | Composant | Secteur | Bâtiment | Local | Zone | Marquage ATEX | Conformité | Risque |
|---:|---|---|---|---|---|---|---|---|
${rows||''}

## 4. Évaluation des risques (cadre)
- Identification des sources ATEX (gaz et poussières) et des scénarios d’inflammation/explosion.
- Critères d’acceptation : conformité marquage ATEX, catégorie minimale requise par zone, IP, Tmax, raccordement à la terre, ventilation et détection.
- Méthode de hiérarchisation : gravité × probabilité × détectabilité (G×P×D).

> ⚙️ Renseigner ou compléter via l’onglet Mesures et l’IA pour détailler les barrières et actions par local.

## 5. Mesures de PRÉVENTION
${prev || '—'}

## 6. Mesures de PROTECTION
${prot || '—'}

## 7. Programme de FORMATION
${training || '—'}

## 8. Plan de MAINTENANCE / CONTRÔLES
${maintenance || '—'}

## 9. Pièces jointes
${(state.attachments||[]).map(a=>`- ${a.name} (${a.url})`).join('\n') || '—'}

---
*Document généré automatiquement — AutonomiX.*
`;
}

function getMdFromPreviewOrBuild(){
  const node = qs('#mdPreview');
  if (!node || !node.textContent) return buildMarkdownCDC();
  return node.textContent;
}

function buildJsonPayload(){
  return {
    mode: state.mode,
    context: state.context,
    zones: [...state.zones],
    attachments: state.attachments,
    equipmentsSelected: [...state.selectedEquip.values()],
    zoningSelections: state.zoningSelections
  };
}

/* -------------------- Save / Progress -------------------- */
function markDirty(){
  if (!state.currentProjectId) return;
  scheduleSave();
  updateStepStatus();
}
function scheduleSave(){
  const el = document.getElementById('saveHint');
  if (el) el.textContent = 'Enregistrement…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveServer, 600);
}
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
    loadProjects(); // refresh après changements
  }catch(e){
    const el = document.getElementById('saveHint');
    if (el) el.textContent = 'Erreur enregistrement';
  }
}

function updateStepStatus(){
  function setDot(id, ok){
    const el = document.getElementById('st-'+id);
    if (!el) return;
    el.classList.toggle('status-green', !!ok);
    el.classList.toggle('status-orange', !ok);
  }
  setDot('projects', !!state.currentProjectId);
  const ctx = state.context || {};
  const ctxOk = !!(ctx.org || ctx.site) && !!(ctx.processDesc && String(ctx.processDesc).trim().length >= 30);
  setDot('context', ctxOk);
  const zOk = (state.zones && state.zones.size>0) || (state.zoningSelections && state.zoningSelections.length>0);
  setDot('zoning', zOk);
  setDot('equip', state.selectedEquip && state.selectedEquip.size>0);
  const mPrev = qs('#measuresPrev')?.value?.trim().length || 0;
  const mProt = qs('#measuresProt')?.value?.trim().length || 0;
  const tr = qs('#training')?.value?.trim().length || 0;
  const mt = qs('#maintenance')?.value?.trim().length || 0;
  setDot('measures', (mPrev+mProt+tr+mt) > 20);
  const allOk = !!state.currentProjectId && ctxOk && zOk && (state.selectedEquip?.size>0) && ((mPrev+mProt+tr+mt)>20);
  setDot('build', allOk);
}

/* -------------------- Misc -------------------- */
function bindIAChat(){ /* optionnel */ }
function downloadFile(filename, content, mime='text/plain'){
  const blob = new Blob([content], {type:mime});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

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
