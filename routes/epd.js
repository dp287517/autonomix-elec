// EPD Builder — JavaScript (FRONT)
// Rangé dans main/routes/epd.js, mais servi EN STATIQUE via /js/epd.js depuis app.js
const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',
  epd: '/api/epd' // Option "boss"
};

const state = {
  context: {},
  zones: new Set(),
  equipments: [],
  selectedEquip: new Map(),
  measuresPrev: '',
  measuresProt: '',
  training: '',
  maintenance: ''
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  document.querySelectorAll('.step').forEach(step =>
    step.addEventListener('click', () => goToStep(step.dataset.step))
  );
  on('#btnAskAI','click', onAskAI);

  // Context
  ['org','site','address','author','processDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.context[id] = el.value; save(); });
  });

  // Zones
  document.querySelectorAll('[data-step="2"] input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value); save(); });
  });
  on('#btnAIIntroZoning','click', async () => {
    const reply = await callAI('Explique brièvement les zones ATEX 0/1/2/20/21/22 et leurs critères, en 120 mots.');
    setHtml('#aiReply', marked.parse(reply || ''));
  });

  // Équipements
  bindEquipments();
  // Mesures + IA
  bindMeasuresAI();

  on('#btnBuild','click', buildAndRender);
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

  restore();
  loadEquip();
  goToStep(1);
});

// Nav
function goToStep(n){
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('is-active', s.dataset.step === String(n)));
  document.querySelectorAll('.step-pane').forEach(p => p.classList.toggle('d-none', p.dataset.step !== String(n)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// IA
async function onAskAI(){
  const q = (val('#aiQuestion') || '').trim();
  if (!q) return;
  const reply = await callAI(q);
  setHtml('#aiReply', marked.parse(reply || ''));
}
async function callAI(question){
  try{
    const r = await fetch(API.chat, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question }) });
    const data = await r.json();
    return (data && (data.response || data.answer)) || '';
  }catch(e){ return '⚠️ IA indisponible.'; }
}

// Équipements
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
    if (!selected.length) { setHtml('#aiReply', 'Sélectionne au moins un équipement.'); return; }
    const sample = selected.slice(0, 10).map(e => `${e.id} ${e.composant} [${e.zone_type||e.exterieur||e.interieur}] ${e.marquage_atex||''} ${e.conformite||''}`).join('\n');
    const prompt = `Analyse les équipements ATEX sélectionnés, signale les non-conformités potentielles par rapport au zonage et au marquage, puis propose 5 actions correctives priorisées:\n${sample}`;
    const reply = await callAI(prompt);
    setHtml('#aiReply', marked.parse(reply || ''));
  });
}
async function loadEquip(){
  try{
    const r = await fetch(API.equipments);
    state.equipments = await r.json();
    renderEquip();
  }catch(e){ console.error('loadEquip', e); }
}
function renderEquip(){
  const tbody = get('#equipTable tbody');
  if (!tbody) return;
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
  document.querySelectorAll('.row-check').forEach(ch => ch.addEventListener('change', () => toggleSelect(ch)));
}
function toggleSelect(ch){
  const id = Number(ch.dataset.id);
  const item = state.equipments.find(e => e.id === id);
  if (!item) return;
  if (ch.checked) state.selectedEquip.set(id, item); else state.selectedEquip.delete(id);
  save();
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

// Mesures + IA
function bindMeasuresAI(){
  const measuresPrev = get('#measuresPrev');
  const measuresProt = get('#measuresProt');
  const training = get('#training');
  const maintenance = get('#maintenance');

  document.querySelectorAll('[data-ai]')?.forEach(btn => btn.addEventListener('click', async ()=>{
    const kind = btn.dataset.ai;
    const promptMap = {
      'prev': 'Propose 6 mesures de prévention adaptées à des zones ATEX sélectionnées, en listes à puces concises.',
      'prev-check': 'Analyse ces mesures de prévention ATEX et signale les lacunes :\n' + (measuresPrev?.value || ''),
      'prot': 'Propose 6 mesures de protection (limitation des effets) adaptées au zonage ATEX, en listes à puces concises.',
      'prot-check': 'Vérifie ces mesures de protection ATEX et ajoute des contrôles/verifications :\n' + (measuresProt?.value || ''),
      'training': 'Élabore un mini-programme de formation ATEX (public, objectifs, périodicité, traçabilité) en 120 mots.',
      'maintenance': 'Suggère un plan de maintenance et d\'inspection pour équipements ATEX (périodicité, essais, critères) en 120 mots.'
    };
    const reply = await callAI(promptMap[kind]);
    const target = { 'prev': measuresPrev, 'prev-check': measuresPrev, 'prot': measuresProt, 'prot-check': measuresProt, 'training': training, 'maintenance': maintenance }[kind];
    if (target) target.value = (target.value ? target.value + '\n' : '') + reply;
    save();
  }));
}

// Build
function buildAndRender(){
  const md = buildMarkdown();
  setText('#mdPreview', md);
  setHtml('#htmlPreview', marked.parse(md));
}
function buildMarkdown(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort((a,b)=>Number(a)-Number(b)).join(', ');
  const equip = [...state.selectedEquip.values()];
  const rows = equip.map(e => `| ${e.id} | ${e.composant||''} | ${e.secteur||''} | ${e.batiment||''} | ${e.local||''} | ${e.zone_type||e.exterieur||e.interieur||''} | ${e.marquage_atex||''} | ${minCategoryFromZone(e.zone_type||e.exterieur||e.interieur)} | ${e.conformite||''} | ${e.risque??''} |`).join('\n');
  const measuresPrev = val('#measuresPrev') || '';
  const measuresProt = val('#measuresProt') || '';
  const training = val('#training') || '';
  const maintenance = val('#maintenance') || '';

  return `# Document Relatif à la Protection Contre les Explosions (EPD)

## 1. Informations générales
- **Entreprise** : ${ctx.org||''}
- **Site / Installation** : ${ctx.site||''}
- **Adresse** : ${ctx.address||''}
- **Rédacteur** : ${ctx.author||''}

## 2. Description du procédé
${ctx.processDesc||''}

## 3. Zonage ATEX
Zones présentes : ${zones||'—'}

## 4. Équipements inclus dans le périmètre
| ID | Composant | Secteur | Bâtiment | Local | Zone | Marquage ATEX | Catégorie minimale | Conformité | Risque |
|---:|---|---|---|---|---|---|---|---|---:|
${rows||''}

## 5. Mesures de prévention
${measuresPrev}

## 6. Mesures de protection
${measuresProt}

## 7. Formation
${training}

## 8. Maintenance et contrôles
${maintenance}

## 9. Annexes
- Plans de zonage
- Certificats ATEX
- FDS / SDS
`;
}
function getMdFromPreviewOrBuild(){
  const node = get('#mdPreview');
  if (!node || !node.textContent) return buildMarkdown();
  return node.textContent;
}

// Export / Download
function downloadFile(name, content, mime){
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// Persistence
const KEY='EPD_BUILDER';
function save(){
  const json = {
    context: state.context,
    zones: [...state.zones],
    selected: [...state.selectedEquip.keys()],
    measuresPrev: val('#measuresPrev') || '',
    measuresProt: val('#measuresProt') || '',
    training: val('#training') || '',
    maintenance: val('#maintenance') || ''
  };
  localStorage.setItem(KEY, JSON.stringify(json));
}
function restore(){
  try{
    const data = JSON.parse(localStorage.getItem(KEY)||'{}');
    state.context = data.context || {};
    state.zones = new Set(data.zones || []);
    setVal('#measuresPrev', data.measuresPrev || '');
    setVal('#measuresProt', data.measuresProt || '');
    setVal('#training', data.training || '');
    setVal('#maintenance', data.maintenance || '');
    Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
    document.querySelectorAll('[data-step="2"] input[type="checkbox"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
  }catch{}
}

// Save to server (Option boss)
async function saveServer(){
  try{
    const payload = buildJsonPayload();
    const title = state.context?.site || 'EPD';
    const r = await fetch(API.epd, { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, payload }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    alert('EPD enregistré (id: ' + (data.id || '?') + ')');
  }catch(e){
    alert('Impossible d\'enregistrer côté serveur. Vérifie que /api/epd est monté.\n' + e.message);
  }
}
function buildJsonPayload(){
  return {
    context: state.context,
    zones: [...state.zones],
    equipments: [...state.selectedEquip.values()],
    measuresPrev: val('#measuresPrev') || '',
    measuresProt: val('#measuresProt') || '',
    training: val('#training') || '',
    maintenance: val('#maintenance') || ''
  };
}

// Utils
function get(sel, root=document){ return root.querySelector(sel); }
function on(sel, evt, fn){ const el = get(sel); if (el) el.addEventListener(evt, fn); }
function val(sel){ const el = get(sel); return el ? el.value : ''; }
function setVal(sel, v){ const el = get(sel); if (el) el.value = v; }
function setHtml(sel, html){ const el = get(sel); if (el) el.innerHTML = html; }
function setText(sel, text){ const el = get(sel); if (el) el.textContent = text; }
function safe(x){ return (x==null? '' : String(x)).replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s])); }
