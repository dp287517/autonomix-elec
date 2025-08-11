// epd.js — Front-end EPD/DRPCE (design aligné avec atex-control)
const API = {
  equipments: '/api/atex-equipments',
  chat: '/api/atex-chat',
  epd: '/api/epd' // Option boss
};

const state = {
  context: {},
  zones: new Set(),
  equipments: [],
  selectedEquip: new Map()
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  // Bind context
  ['org','site','address','author','processDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.context[id] = el.value; save(); });
  });

  // Zones
  document.querySelectorAll('#zoning input[type=\"checkbox\"]').forEach(cb => {
    cb.addEventListener('change', () => { if (cb.checked) state.zones.add(cb.value); else state.zones.delete(cb.value); save(); });
  });
  on('#btnAIIntroZoning','click', async () => {
    const reply = await callAI('Explique brièvement les zones ATEX 0/1/2/20/21/22 et leurs critères, en 120 mots.');
    openIA(reply);
  });

  // Équipements
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
    const sample = selected.slice(0, 12).map(e => `${e.id} ${e.composant} [${e.zone_type||e.exterieur||e.interieur}] ${e.marquage_atex||''} ${e.conformite||''}`).join('\\n');
    const prompt = `Analyse les équipements ATEX sélectionnés, signale les non-conformités potentielles et propose 5 actions correctives priorisées:\\n${sample}`;
    openIA(await callAI(prompt));
  });

  // Mesures / Build / Export
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

  // Persistence + Data
  restore();
  loadEquip();
});

// ===== IA Helpers
async function callAI(question){
  try{
    const r = await fetch(API.chat, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ question })
    });
    const data = await r.json();
    return (data && (data.response || data.answer)) || '';
  }catch(e){ return '⚠️ IA indisponible.'; }
}

function openIA(html){
  const panel = document.getElementById('iaPanel');
  const content = document.getElementById('iaDetails');
  const load = document.getElementById('iaLoading');
  content.style.display = 'none'; load.style.display = 'block';
  const oc = bootstrap.Offcanvas.getOrCreateInstance(panel);
  oc.show();
  setTimeout(() => {
    load.style.display = 'none';
    content.style.display = 'block';
    content.innerHTML = html || '<p class=\"text-muted\">—</p>';
  }, 250);
}

// ===== Equip
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

// ===== Build
function buildAndRender(){
  const md = buildMarkdown();
  qst('#mdPreview', md);
  qs('#htmlPreview').innerHTML = marked.parse(md);
}
function buildMarkdown(){
  const ctx = state.context || {};
  const zones = [...state.zones].sort((a,b)=>Number(a)-Number(b)).join(', ');
  const equip = [...state.selectedEquip.values()];
  const rows = equip.map(e => `| ${e.id} | ${e.composant||''} | ${e.secteur||''} | ${e.batiment||''} | ${e.local||''} | ${e.zone_type||e.exterieur||e.interieur||''} | ${e.marquage_atex||''} | ${minCategoryFromZone(e.zone_type||e.exterieur||e.interieur)} | ${e.conformite||''} | ${e.risque??''} |`).join('\\n');
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
  const node = qs('#mdPreview');
  if (!node || !node.textContent) return buildMarkdown();
  return node.textContent;
}

// ===== Export / Save
function downloadFile(name, content, mime){
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function saveServer(){
  try{
    const payload = buildJsonPayload();
    const title = state.context?.site || 'EPD';
    const r = await fetch(API.epd, {
      method:'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title, payload })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    toast('EPD enregistré (id: ' + (data.id || '?') + ')', 'success');
  }catch(e){
    toast('Enregistrement serveur indisponible. Vérifie /api/epd', 'warning');
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

// ===== Persistence
const KEY='EPD_BUILDER';
function save(){
  const json = {
    context: state.context,
    zones: [...state.zones],
    selected: [...state.selectedEquip.keys()],
  };
  localStorage.setItem(KEY, JSON.stringify(json));
}
function restore(){
  try{
    const data = JSON.parse(localStorage.getItem(KEY)||'{}');
    state.context = data.context || {};
    state.zones = new Set(data.zones || []);
    Object.entries(state.context).forEach(([k,v])=>{ const el = document.getElementById(k); if(el) el.value = v; });
    document.querySelectorAll('#zoning input[type=\"checkbox\"]').forEach(cb => { cb.checked = state.zones.has(cb.value); });
  }catch{}
}

// ===== UI utils
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
