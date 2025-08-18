// /public/js/atex-control.core.js — v10
(function(){

  if (window.lucide){ window.lucide.createIcons(); }

  // ------------- Account / API helpers -------------
  const ACCOUNT_ID = () => encodeURIComponent(window.APP_ACCOUNT_ID || '10');
  const base = (path) => `${path}${path.includes('?') ? '&' : '?'}account_id=${ACCOUNT_ID()}`;

  const API = {
    secteurs: base('/api/atex-secteurs'),
    equipments: base('/api/atex-equipments'),
    equipment: (id) => base('/api/atex-equipments/' + id),
    importExcel: base('/api/atex-import-excel'),
    importColumns: base('/api/atex-import-columns'),
    importCsvTpl: base('/api/atex-import-template'),
    importXlsxTpl: base('/api/atex-import-template.xlsx'),
    inspect: base('/api/atex-inspect'),
    help: (id) => base('/api/atex-help/' + id),
    chat: base('/api/atex-chat'),
    photo: (id) => base('/api/atex-photo/' + id)
  };

  // carry account_id also in bodies (server accepte req.query || req.body.account_id)
  const withBodyAccount = (payload={}) => Object.assign({}, payload, { account_id: window.APP_ACCOUNT_ID || '10' });

  // ------------- State -------------
  let equipments = [];
  let currentIA = null;

  // cache analyses IA par equipment_id (évite recompute)
  const IA_CACHE_KEY = 'atexIACacheV1';
  function getIACache(){ try{ return JSON.parse(localStorage.getItem(IA_CACHE_KEY)||'{}'); }catch{return{}} }
  function setIACache(m){ localStorage.setItem(IA_CACHE_KEY, JSON.stringify(m||{})); }
  function cacheIA(id, payload){ const m=getIACache(); m[id]=payload; setIACache(m); }
  function getCachedIA(id){ const m=getIACache(); return m[id]; }

  // threads par équipement
  const CHAT_THREADS_KEY = 'atexIAThreadsV1';
  function getAllThreads(){ try{ return JSON.parse(localStorage.getItem(CHAT_THREADS_KEY)||'{}'); }catch{return{}} }
  function setAllThreads(o){ localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(o||{})); }
  function getThread(id){ const all=getAllThreads(); return Array.isArray(all[id])? all[id] : []; }
  function setThread(id, t){ const all=getAllThreads(); all[id]=t||[]; setAllThreads(all); renderHistory(); if (currentIA===id) renderThread($('#iaThread'), t); }

  // historique (liste des analyses ouvertes)
  const HISTORY_KEY = 'atexIAHistoryV7';
  function getHistory(){ try{ return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); }catch{return[]} }
  function setHistory(h){ localStorage.setItem(HISTORY_KEY, JSON.stringify(h||[])); }
  function addToHistory(item){
    const h = getHistory();
    const idx = h.findIndex(x=>x.id===item.id);
    if (idx>=0) h[idx]=Object.assign(h[idx], item);
    else h.unshift(item);
    setHistory(h.slice(0,300));
    renderHistory(); renderHistoryChat();
  }
  function removeFromHistory(id){
    const h = getHistory().filter(x=>x.id!==id);
    setHistory(h); renderHistory(); renderHistoryChat();
  }
  function clearAllThreads(){
    setAllThreads({});
    setHistory([]);
    $('#chatHtml').innerHTML='';
    $('#chatHeader').textContent='';
    $('#chatThread').innerHTML='';
    renderHistory();
    toast('Historique effacé','info');
  }
  window.clearAllThreads = clearAllThreads;

  // ------------- DOM helpers -------------
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  function toast(message, variant='primary'){
    const id='t'+Date.now();
    const html = `
      <div id="${id}" class="toast text-bg-${variant} border-0 mb-2" role="alert">
        <div class="d-flex">
          <div class="toast-body">${message}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`;
    $('#toasts').insertAdjacentHTML('beforeend', html);
    const t = new bootstrap.Toast($('#'+id), {delay:3000}); t.show();
    setTimeout(()=> $('#'+id)?.remove(), 3500);
  }
  function stripCodeFences(s){ if(typeof s!=='string') return ''; return s.replace(/(?:^```(?:html)?|```$)/g,'').trim(); }
  function renderHTML(el, raw){
    let s = stripCodeFences(raw||'').trim();
    const looksHTML = /<\/?[a-z][\s\S]*>/i.test(s);
    if(!looksHTML){ s = s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\r?\n/g,"<br>"); }
    el.innerHTML = s || '—';
  }
  function fmtDate(d){
    if(!d) return 'N/A';
    const date = new Date(d); if(isNaN(date)) return d;
    const dd=String(date.getDate()).padStart(2,'0'), mm=String(date.getMonth()+1).padStart(2,'0'), yyyy=date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  function addMonthsISO(dateISO, nbMonths){
    const d = new Date(dateISO);
    if (isNaN(d)) return null;
    d.setMonth(d.getMonth() + (Number(nbMonths)||0));
    return d.toISOString();
  }

  // ------------- Table rendering -------------
  function computeStatus(nextDate){
    if(!nextDate) return 'ok';
    const d = new Date(nextDate); if(isNaN(d)) return 'ok';
    const today = new Date(); today.setHours(0,0,0,0);
    const dn = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((dn - today)/(1000*60*60*24));
    if (diffDays < 0)  return 'late';
    if (diffDays === 0) return 'today';
    if (diffDays <= 30) return 'soon';
    return 'ok';
  }
  function statusBadge(st){
    if(st==='late')  return '<span class="badge badge-st late">En retard</span>';
    if(st==='today') return '<span class="badge badge-st today">Aujourd’hui</span>';
    if(st==='soon')  return '<span class="badge badge-st soon">Bientôt</span>';
    return '<span class="badge badge-st ok">OK</span>';
  }
  function isImageLink(u){ return /^data:image\//.test(u) || /\.(png|jpe?g|webp|gif)$/i.test(u||''); }
  function isPdfLink(u){ return /\.(pdf)$/i.test(u||''); }

  function renderAttachmentsCell(eq){
    const bits = [];
    if (eq.photo && /^data:image\//.test(eq.photo)) {
      bits.push(`<img class="last-photo" src="${eq.photo}" alt="Photo" data-action="open-photo" data-src="${encodeURIComponent(eq.photo)}">`);
    } else {
      bits.push('<span class="text-muted">—</span>');
    }
    let atts = eq.attachments;
    if (typeof atts === 'string'){ try{ atts = JSON.parse(atts); }catch{ atts = null; } }
    if (Array.isArray(atts) && atts.length){
      const thumbs = atts.slice(0,3).map((a,i)=>{
        const url = a && (a.url || a.href || a.path || a);
        const label = a && (a.name || a.label) || ('Fichier '+(i+1));
        if (!url) return '';
        if (isImageLink(url)) return `<img class="att-thumb" title="${label}" src="${url}" data-action="open-photo" data-src="${encodeURIComponent(url)}">`;
        const icon = isPdfLink(url) ? '📄' : '📎';
        return `<a class="att-file" href="${url}" title="${label}" target="_blank" rel="noopener">${icon}</a>`;
      }).join('');
      const more = atts.length>3 ? `<a href="#" class="att-more" data-action="open-attachments" data-id="${eq.id}">+${atts.length-3}</a>` : '';
      bits.push(`<div class="att-wrap">${thumbs}${more}</div>`);
    }
    return bits.join(' ');
  }

  async function loadEquipments(){
    try{
      const r = await fetch(API.equipments);
      equipments = await r.json();
      equipments = (equipments||[]).map(eq=>{
        if (!eq.next_inspection_date && eq.last_inspection_date){
          const months = Number(eq.frequence);
          const iso = addMonthsISO(eq.last_inspection_date, Number.isFinite(months) ? months : 36);
          if (iso) eq.next_inspection_date = iso;
        }
        return eq;
      });
      renderTable(equipments);
      buildFilterLists();
      toast('Équipements chargés','info');
    }catch(e){ toast('Erreur chargement équipements','danger'); }
  }

  function renderTable(list){
    const tbody = $('#equipmentsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    (list||[]).forEach(eq=>{
      const st = computeStatus(eq.next_inspection_date);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="rowchk" data-id="${eq.id||''}"></td>
        <td>${eq.id||''}</td>
        <td>${eq.composant||''}</td>
        <td>${eq.secteur||''}</td>
        <td>${eq.batiment||''}</td>
        <td>${eq.local||''}</td>
        <td>${eq.zone_gaz||''}</td>
        <td>${eq.zone_poussieres||eq.zone_poussiere||''}</td>
        <td class="col-conf">${String(eq.conformite||'').toLowerCase().includes('non') ? '<span class="badge-conf ko">Non Conforme</span>' : '<span class="badge-conf ok">Conforme</span>'}</td>
        <td>${statusBadge(st)}</td>
        <td>${eq.risque ?? ''}</td>
        <td>${fmtDate(eq.last_inspection_date)}</td>
        <td>${fmtDate(eq.next_inspection_date)}</td>
        <td>${renderAttachmentsCell(eq)} ${Array.isArray(eq.attachments)&&eq.attachments.length?`<div><a href="#" data-action="open-attachments" data-id="${eq.id}">Voir tout</a></div>`:''}</td>
        <td class="actions">
          <button class="btn btn-sm btn-outline-primary" data-action="edit-equipment" data-id="${eq.id}" title="Éditer"><i class="lucide-edit-3"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-equipment" data-id="${eq.id}" data-label="${(eq.composant||'').replace(/\"/g,'&quot;')}" title="Supprimer"><i class="lucide-trash-2"></i></button>
          <button class="btn btn-sm ${String(eq.conformite||'').toLowerCase().includes('non') ? 'btn-warning' : 'btn-outline-secondary'}" data-action="open-ia" data-id="${eq.id}" title="IA Analysis"><i class="lucide-sparkles"></i> IA</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    window.lucide?.createIcons();
    $$('.rowchk').forEach(c => c.addEventListener('change', updateBulkBtn));
  }

  // ------------- Filters -------------
  const activeFilters = { secteurs: new Set(), batiments: new Set(), conformites: new Set(), statut: new Set(), text: '' };

  function buildFilterLists(){
    const secteurs = [...new Set(equipments.map(e=>e.secteur).filter(Boolean))].sort();
    const bats     = [...new Set(equipments.map(e=>e.batiment).filter(Boolean))].sort();

    const secBox = $('#dd-secteurs'); secBox.innerHTML='';
    secteurs.forEach((s,i)=>{
      const id='cks_'+i;
      secBox.insertAdjacentHTML('beforeend', `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s}" id="${id}"><label class="form-check-label" for="${id}">${s}</label></div>`);
    });
    secBox.querySelectorAll('input').forEach(inp => inp.addEventListener('change', ()=>toggleFilterSet(activeFilters.secteurs, inp.value, inp.checked)));

    const batBox = $('#dd-batiments'); batBox.innerHTML='';
    bats.forEach((s,i)=>{
      const id='ckb_'+i;
      batBox.insertAdjacentHTML('beforeend', `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s}" id="${id}"><label class="form-check-label" for="${id}">${s}</label></div>`);
    });
    batBox.querySelectorAll('input').forEach(inp => inp.addEventListener('change', ()=>toggleFilterSet(activeFilters.batiments, inp.value, inp.checked)));

    $$('#dd-conformite input').forEach(inp => inp.addEventListener('change', ()=>toggleFilterSet(activeFilters.conformites, inp.value, inp.checked)));
    $$('#dd-statut input').forEach(inp => inp.addEventListener('change', ()=>toggleFilterSet(activeFilters.statut, inp.value, inp.checked)));

    $('#filterText').addEventListener('input', (e)=>{ activeFilters.text = e.target.value.toLowerCase(); renderPills(); applyFilters(); });
    renderPills();
  }
  function toggleFilterSet(set, value, checked){ if(checked) set.add(value); else set.delete(value); renderPills(); }
  function clearFilters(){
    activeFilters.secteurs.clear(); activeFilters.batiments.clear();
    activeFilters.conformites.clear(); activeFilters.statut.clear(); activeFilters.text='';
    $$('#dd-secteurs input, #dd-batiments input, #dd-conformite input, #dd-statut input').forEach(i=>i.checked=false);
    $('#filterText').value=''; renderPills(); applyFilters();
  }
  function renderPills(){
    const box = $('#activePills'); box.innerHTML='';
    const pill = (l)=>`<span class="badge text-bg-light">${l}</span>`;
    activeFilters.secteurs.forEach(s=> box.insertAdjacentHTML('beforeend', pill('Secteur: '+s)));
    activeFilters.batiments.forEach(s=> box.insertAdjacentHTML('beforeend', pill('Bâtiment: '+s)));
    activeFilters.conformites.forEach(s=> box.insertAdjacentHTML('beforeend', pill('Conf: '+s)));
    activeFilters.statut.forEach(s=> {
      const m = {late:'En retard', today:'Aujourd’hui', soon:'Bientôt', ok:'OK'}; box.insertAdjacentHTML('beforeend', pill('Statut: '+(m[s]||s)));
    });
    if (activeFilters.text) box.insertAdjacentHTML('beforeend', pill('Texte: '+activeFilters.text));
  }
  function applyFilters(){
    let filtered = equipments.slice();
    if(activeFilters.secteurs.size)     filtered = filtered.filter(e=> activeFilters.secteurs.has(e.secteur));
    if(activeFilters.batiments.size)    filtered = filtered.filter(e=> activeFilters.batiments.has(e.batiment));
    if(activeFilters.conformites.size)  filtered = filtered.filter(e=> activeFilters.conformites.has(e.conformite));
    if(activeFilters.statut.size)       filtered = filtered.filter(e=> activeFilters.statut.has(computeStatus(e.next_inspection_date)));
    if(activeFilters.text)              filtered = filtered.filter(e=>{
      const blob = [e.composant,e.type,e.marquage_atex,e.identifiant,e.comments].join(' ').toLowerCase();
      return blob.includes(activeFilters.text);
    });
    renderTable(filtered);
  }

  // ------------- Bulk delete -------------
  function updateBulkBtn(){ const sel = $$('.rowchk:checked').map(i=>+i.dataset.id); $('#btnBulkDelete').disabled = sel.length===0; }
  function toggleAll(e){ const checked = e.target.checked; $$('.rowchk').forEach(c=>{ c.checked = checked; }); updateBulkBtn(); }
  function openBulkDelete(){
    const sel = $$('.rowchk:checked').map(i=>+i.dataset.id);
    if(!sel.length) return;
    $('#deleteMsg').textContent = `Supprimer ${sel.length} équipement(s) sélectionné(s) ?`;
    $('#deleteMeta').textContent = 'IDs: ' + sel.join(', ');
    bootstrap.Modal.getOrCreateInstance($('#deleteModal')).show();
    $('#confirmDeleteBtn').addEventListener('click', () => confirmBulkDelete(sel), { once: true });
  }
  async function confirmBulkDelete(ids){
    try{
      await Promise.all(ids.map(id => fetch(API.equipment(id), {method:'DELETE'})));
      toast('Suppression en masse OK','success');
      await loadEquipments();
    }catch(e){ toast('Erreur suppression masse: '+(e.message||e),'danger'); }
    finally{ bootstrap.Modal.getOrCreateInstance($('#deleteModal')).hide(); }
  }

  // ------------- Form helpers -------------
  function clearForm(){
    const ids = [
      'equipId','secteur-input','batiment-input','local-input','zone-g-input','zone-d-input',
      'composant-input','fournisseur-input','type-input','identifiant-input',
      'marquage_atex-input','comments-input','last-inspection-input'
    ];
    ids.forEach(id => { const el = $('#'+id); if(el) el.value = ''; });
    const file = $('#photo-input'); if (file) file.value = '';
  }

  // ------------- Secteurs -------------
  async function loadSecteurs(){
    try{
      const r = await fetch(API.secteurs);
      const arr = await r.json();
      const sel = $('#secteur-input');
      sel.innerHTML = '<option value="" disabled selected>— Sélectionner —</option>';
      (arr||[]).forEach(s=>{
        const name = (typeof s === 'string') ? s : (s && s.name) ? s.name : '';
        if(!name) return;
        const o=document.createElement('option'); o.value=name; o.text=name; sel.appendChild(o);
      });
    }catch(e){ /* noop */ }
  }
  function openModalSecteur(){
    const html=`
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
    const el = $('#modalSecteur'), modal = new bootstrap.Modal(el); modal.show();
    el.querySelector('#saveSecteurBtn').addEventListener('click', async ()=>{
      const name=(el.querySelector('#newSecteurName').value||'').trim();
      if(!name){ el.querySelector('#secteurSaveMsg').textContent='Nom requis.'; return; }
      try{
        const r = await fetch(API.secteurs,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withBodyAccount({name}))});
        if(!r.ok) throw new Error('Erreur API');
        await loadSecteurs(); $('#secteur-input').value=name; toast('Secteur enregistré','success'); modal.hide(); el.remove();
      }catch(err){ el.querySelector('#secteurSaveMsg').textContent='Erreur: '+(err.message||err); }
    }, {once:true});
    el.addEventListener('hidden.bs.modal', ()=> el.remove(), {once:true});
  }

  // ------------- IA enrichissement local (si serveur ne renvoie pas) -------------
  function buildLocalEnrichment(eq){
    const arr = (x)=>Array.isArray(x)?x:[];
    const tipsPall = [];
    const tipsPrev = [];
    const refs = [];
    const costs = [];

    const zg = String(eq.zone_gaz||'').trim();
    const zd = String(eq.zone_poussieres||eq.zone_poussiere||'').trim();
    const mark = String(eq.marquage_atex||'').toLowerCase();

    if (!mark || mark.includes('pas de marquage')){
      tipsPall.push('Éloigner l’équipement des zones classées et **isoler électriquement** temporairement.');
      tipsPall.push('Limiter les sources d’inflammation (interdiction d’intervention non ATEX).');
      refs.push('Directive ATEX 2014/34/UE — Matériels destinés à être utilisés en atmosphères explosibles.');
      costs.push('Remplacement par matériel certifié : 400€–2 500€ selon le composant.');
    }
    if (zg === '1' || zg === '0'){ tipsPrev.push('Choisir des matériels **catégorie 1G/2G** selon la zone.'); }
    if (zd === '20' || zd === '21'){ tipsPrev.push('Choisir des matériels **catégorie 1D/2D** selon la zone.'); }

    refs.push('EN 60079-0/1/7/31 — Ex d / Ex e / Ex t (poussières).');
    costs.push('Inspection initiale + rapport : 250€–600€.');
    return { palliatives: tipsPall, preventives: tipsPrev, refs, costs };
  }

  // ------------- IA Panel / Chat -------------
  function renderThread(el, thread){
    el.innerHTML = '';
    thread.forEach(m=>{
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role==='user'?'user':'ia');
      if(m.role==='assistant'){ renderHTML(div, m.content); }
      else { div.textContent = m.content; }
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function renderHistory(activeId=null){
    const list = $('#iaHistoryList'); if(!list) return;
    const h=getHistory();
    list.innerHTML = '';
    if(!h.length){ list.innerHTML='<li class="list-group-item text-muted">Aucune analyse.</li>'; return; }
    h.forEach((it,idx)=>{
      const li=document.createElement('li');
      li.className='list-group-item d-flex justify-content-between align-items-center hist-item'+(it.id===activeId?' active':'');
      li.innerHTML=`
        <div>
          <div class="fw-bold">${it.composant || 'Équipement'} — ID ${it.id}</div>
          <div class="small text-muted">${it.meta?.secteur||'-'} • ${it.meta?.batiment||'-'}</div>
        </div>
        <div>
          <button class="btn btn-sm btn-outline-secondary" data-id="${it.id}" data-act="open">Ouvrir</button>
          <button class="btn btn-sm btn-outline-danger" data-id="${it.id}" data-act="del">X</button>
        </div>`;
      li.addEventListener('click', (e)=>{
        const act = e.target.getAttribute('data-act');
        const id = Number(e.target.getAttribute('data-id')||it.id);
        if (act==='del'){ removeFromHistory(id); return; }
        selectHistoryChat(idx);
      });
      list.appendChild(li);
    });
  }

  function renderHistoryChat(){
    const h = getHistory();
    const it = h[0];
    if(!it){
      $('#chatHeader').textContent='';
      $('#chatHtml').innerHTML='';
      $('#chatThread').innerHTML='';
      return;
    }
    $('#chatHeader').textContent = `${it.composant || 'Équipement'} — ID ${it.id}`;
    renderHTML($('#chatHtml'), it.content || '—');

    // cartes
    const enr = it.enriched || {};
    $('#cardPalliatives').innerHTML = (enr.palliatives||[]).map(li=>`<li>${li}</li>`).join('') || '—';
    $('#cardPreventives').innerHTML = (enr.preventives||[]).map(li=>`<li>${li}</li>`).join('') || '—';
    $('#cardRefs').innerHTML        = (enr.refs||[]).map(li=>`<li>${li}</li>`).join('') || '—';
    $('#cardCosts').innerHTML       = (enr.costs||[]).map(li=>`<li>${li}</li>`).join('') || '—';

    renderThread($('#chatThread'), getThread(it.id));
  }

  async function openIA(id){
    currentIA = id;
    const off = bootstrap.Offcanvas.getOrCreateInstance($('#iaPanel')); off.show();
    $('#iaHeader').textContent = 'Analyse en cours…';
    $('#iaLoading').style.display='block';
    $('#iaDetails').style.display='none';

    try{
      // cache ?
      const cached = getCachedIA(id);
      let eq;
      if (cached){ ({ eq } = cached); }
      if (!eq){
        const eqR = await fetch(API.equipment(id)); if(!eqR.ok) throw new Error('Équipement introuvable');
        eq = await eqR.json();
      }

      let help;
      if (cached && cached.help) help = cached.help;
      else {
        const helpR = await fetch(API.help(id));
        help = await helpR.json();
        cacheIA(id, { eq, help });
      }

      // header
      $('#iaHeader').textContent = `${eq.composant || 'Équipement'} — ID ${eq.id} • Dernière: ${fmtDate(eq.last_inspection_date)} • Prochaine: ${fmtDate(eq.next_inspection_date)}`;

      const cleaned = help?.response || 'Aucune analyse IA disponible.';
      renderHTML($('#iaDetails'), cleaned);
      $('#iaLoading').style.display='none';
      $('#iaDetails').style.display='block';

      // enrich cards
      const enriched = help?.enrich || buildLocalEnrichment(eq);
      $('#iaPalliatives').innerHTML = (enriched.palliatives||[]).map(li=>`<li>${li}</li>`).join('') || '—';
      $('#iaPreventives').innerHTML = (enriched.preventives||[]).map(li=>`<li>${li}</li>`).join('') || '—';
      $('#iaRefs').innerHTML        = (enriched.refs||[]).map(li=>`<li>${li}</li>`).join('') || '—';
      $('#iaCosts').innerHTML       = (enriched.costs||[]).map(li=>`<li>${li}</li>`).join('') || '—';

      // suggestions achat
      buildDynamicSuggestions(eq);

      // history + thread
      addToHistory({
        id: eq.id, composant: eq.composant || 'Équipement', date: new Date().toISOString(),
        content: cleaned, enriched,
        meta: { secteur: eq.secteur||'', batiment: eq.batiment||'', last: fmtDate(eq.last_inspection_date), next: fmtDate(eq.next_inspection_date) }
      });
      renderThread($('#iaThread'), getThread(eq.id));

    }catch(e){
      $('#iaLoading').style.display='none';
      $('#iaDetails').style.display='block';
      renderHTML($('#iaDetails'), `<div class="alert alert-danger">Erreur IA: ${e.message||e}</div>`);
    }
  }
  window.openIA = openIA;

  // Effacer discussion courante (panneau IA)
  function clearCurrentThread(){
    if (!currentIA) return;
    setThread(currentIA, []);
    toast('Discussion effacée','info');
  }
  window.clearCurrentThread = clearCurrentThread;

  // Chat prompts
  async function sendChat(origin){
    const input = origin==='panel' ? $('#iaPrompt') : $('#chatPrompt');
    const text = (input.value||'').trim();
    if(!text || !currentIA) return;

    try{
      const eqR = await fetch(API.equipment(currentIA)); if(!eqR.ok) throw new Error('Équipement introuvable');
      const eq = await eqR.json();

      const thread = getThread(currentIA);
      const resp = await fetch(API.chat, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(withBodyAccount({
          question: text,
          equipment: null,
          history: thread.map(m=>({ role: m.role==='assistant'?'assistant':'user', content: m.content }))
        }))
      });
      const data = await resp.json();
      const iaText = data?.response || 'Réponse indisponible.';

      const next = [...thread, {role:'user', content:text}, {role:'assistant', content:iaText}];
      setThread(currentIA, next);

      if (origin==='panel') renderThread($('#iaThread'), next);
      else renderThread($('#chatThread'), next);
      input.value='';
    }catch(e){ toast('Erreur chat: '+(e.message||e),'danger'); }
  }

  // ------------- Suggestions d’achats -------------
  function requiredCategoryForZone(zg, zd){
    const zgNum = String(zg||'').replace(/[^0-9]/g,'') || '';
    const zdNum = String(zd||'').replace(/[^0-9]/g,'') || '';
    if(zgNum === '0' || zdNum === '20') return 'II 1GD';
    if(zgNum === '1' || zdNum === '21') return 'II 2GD';
    return 'II 3GD';
  }
  function buildDynamicSuggestions(eq){
    const cont = document.getElementById('autoLinks');
    if(!cont) return;
    cont.innerHTML = '';
    const isNC = String(eq?.conformite || '').toLowerCase().includes('non');
    const req = requiredCategoryForZone(eq?.zone_gaz, eq?.zone_poussieres);
    const comp = (eq?.composant || '').toLowerCase();

    const items = [];
    // Types de pièces probables
    if (comp.includes('pression') || comp.includes('capteur')){
      items.push({ type:'Capteur pression ATEX', name:'IFM PN7092', href:'https://www.ifm.com/' });
    }
    if (comp.includes('moteur') || comp.includes('pompe')){
      items.push({ type:'Moteur Ex d', name:'WEG W22X', href:'https://www.weg.net/' });
    }
    items.push({ type:'Boîte de jonction Ex e', name:'R. STAHL série 8146/5-V', href:'https://r-stahl.com/' });
    items.push({ type:'Presse-étoupe Ex e/Ex d', name:'Hawke 501/421', href:'https://www.ehawke.com/' });
    items.push({ type:'Câble & accessoires ATEX', name:'RS Components', href:'https://uk.rs-online.com/' });

    cont.innerHTML = `
      <div class="small mb-2 text-muted">Catégorie requise estimée : <strong>${req}</strong></div>
      ${!isNC ? '<div class="text-muted small mb-2">Équipement conforme — suggestions générales :</div>' : '<div class="text-danger small mb-2">Équipement non conforme — remplacements conseillés :</div>'}
      <ul class="mb-2">${items.map(it=>`<li><strong>${it.type}</strong> — ${it.name} • <a href="${it.href}" target="_blank" rel="noopener">Voir</a></li>`).join('')}</ul>
      <div class="small text-muted">Ajusté en fonction du composant et des zones (G/D).</div>
    `;
  }

  // ------------- Photo upload helpers -------------
  async function resizeImageToDataURL(file, maxW=1280, maxH=1280){
    const img = document.createElement('img');
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject)=>{
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await new Promise((resolve,reject)=>{
      img.onload = resolve; img.onerror = reject; img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    const ratio = Math.min(maxW/w, maxH/h, 1);
    w = Math.round(w*ratio); h = Math.round(h*ratio);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  async function uploadPhotoMultipart(id, file){
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(API.photo(id), { method:'POST', body: fd });
    if(!r.ok) throw new Error('upload_photo_failed');
    return r.json();
  }

  // ------------- Save / Edit / Delete -------------
  async function saveEquipment(){
    const required = ['secteur-input','batiment-input','composant-input'];
    const missing = required.filter(id => !($('#'+id)?.value || '').trim());
    if (missing.length){ toast('Champs manquants : '+missing.join(', '),'warning'); return; }

    const id = $('#equipId').value || null;
    const zone_g = $('#zone-g-input').value || '';
    const zone_d = $('#zone-d-input').value || '';

    const file = $('#photo-input').files[0] || null;
    let photoBase64 = null;
    if (file && file.size > 180*1024 && id) {
      try { await uploadPhotoMultipart(id, file); toast('Photo envoyée (multipart)','success'); }
      catch (e) { toast('Échec upload photo: '+(e.message||e),'danger'); }
    } else if (file) {
      photoBase64 = await resizeImageToDataURL(file);
    }

    const data = withBodyAccount({
      secteur: $('#secteur-input').value,
      batiment: $('#batiment-input').value,
      local: $('#local-input').value,
      composant: $('#composant-input').value,
      fournisseur: $('#fournisseur-input').value,
      type: $('#type-input').value,
      identifiant: $('#identifiant-input').value,
      marquage_atex: $('#marquage_atex-input').value,
      comments: $('#comments-input').value,
      zone_gaz: zone_g || null, zone_poussieres: zone_d || null, zone_poussiere: zone_d || null,
      photo: photoBase64
    });

    const method = id ? 'PUT' : 'POST';
    const url = id ? API.equipment(id) : API.equipments;

    try{
      const r = await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!r.ok) {
        const errTxt = await r.text();
        if (r.status===413 || /trop volumineuse|too large/i.test(errTxt)) {
          toast('Image trop lourde. Enregistre, puis ré-ajoute la photo (multipart).','warning');
        } else {
          throw new Error('Erreur enregistrement');
        }
      }
      const saved = await r.json();
      if (!id && file && file.size > 180*1024 && saved?.id) { await uploadPhotoMultipart(saved.id, file); }

      const last = $('#last-inspection-input').value;
      if(last){
        await fetch(API.inspect,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withBodyAccount({equipment_id:saved.id,status:'done',inspection_date:last}))});
      }
      toast('Équipement sauvegardé.','success');
      await loadEquipments();
      document.getElementById('list-tab').click();
      clearForm();
    }catch(e){ toast('Erreur: '+(e.message||e),'danger'); }
  }

  async function editEquipment(id){
    try{
      const addTab = document.getElementById('add-tab');
      if (addTab) addTab.click();
      await new Promise(r => setTimeout(r, 0));

      const r = await fetch(API.equipment(id)); if(!r.ok) throw new Error('Erreur chargement équipement');
      const eq = await r.json();
      $('#equipId').value = eq.id;
      $('#secteur-input').value   = eq.secteur || '';
      $('#batiment-input').value  = eq.batiment || '';
      $('#local-input').value     = eq.local || '';
      $('#zone-g-input').value    = eq.zone_gaz || (['0','1','2'].includes(String(eq.zone_type))? String(eq.zone_type) : '');
      $('#zone-d-input').value    = (eq.zone_poussieres || eq.zone_poussiere) || (['20','21','22'].includes(String(eq.zone_type))? String(eq.zone_type) : '');
      $('#composant-input').value = eq.composant || '';
      $('#fournisseur-input').value = eq.fournisseur || '';
      $('#type-input').value      = eq.type || '';
      $('#identifiant-input').value = eq.identifiant || '';
      $('#marquage_atex-input').value = eq.marquage_atex || '';
      $('#comments-input').value  = eq.comments || '';
      $('#last-inspection-input').value = eq.last_inspection_date ? new Date(eq.last_inspection_date).toISOString().slice(0,10) : '';
    }catch(e){ toast('Erreur édition: '+(e.message||e),'danger'); }
  }

  let toDeleteId = null;
  function openDeleteModal(id, label=''){
    toDeleteId=id;
    $('#deleteMsg').textContent = 'Voulez-vous vraiment supprimer cet équipement ATEX ?';
    $('#deleteMeta').textContent = label ? `Équipement : ${label} (ID ${id})` : `ID ${id}`;
    bootstrap.Modal.getOrCreateInstance($('#deleteModal')).show();
    $('#confirmDeleteBtn').addEventListener('click', confirmDeleteOne, { once: true });
  }
  async function confirmDeleteOne(){
    if(!toDeleteId) return;
    try{
      const r = await fetch(API.equipment(toDeleteId), {method:'DELETE'});
      if(!r.ok) throw new Error('Erreur suppression');
      toast('Supprimé !','success');
      await loadEquipments();
    }catch(e){ toast('Erreur suppression: '+(e.message||e),'danger'); }
    finally{ bootstrap.Modal.getOrCreateInstance($('#deleteModal')).hide(); }
  }

  // ------------- Import -------------
  async function importExcel(){
    const input = $('#excelFile');
    if (!input || !input.files || !input.files[0]) { toast('Sélectionnez un fichier.','warning'); return; }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try{
      const r = await fetch(API.importExcel, { method:'POST', body: fd });
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data?.error || ('HTTP '+r.status));
      toast(`Import terminé: ${data?.inserted||0} insérés, ${data?.updated||0} mis à jour.`, 'success');
      await loadEquipments();
    }catch(e){ toast('Erreur import: '+(e.message||e),'danger'); }
  }

  // ------------- Attachments viewer -------------
  function openAttachmentsModal(eq){
    let atts = eq.attachments;
    if (typeof atts === 'string'){
      try{ atts = JSON.parse(atts); }catch{ atts = null; }
    }
    atts = Array.isArray(atts) ? atts : [];
    const id = 'attsModal_'+eq.id;
    const modalHTML = `
    <div class="modal fade" id="${id}" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Pièces jointes — Équipement #${eq.id}</h5>
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            ${atts.length ? atts.map((a,i)=>{
              const url = a && (a.url||a.href||a.path||a) || '';
              const name = a && (a.name||a.label) || ('Fichier '+(i+1));
              if (!url) return '';
              if (isImageLink(url)){
                return `<div class="mb-3"><div class="small fw-semibold mb-1">${name}</div><img src="${url}" class="img-fluid rounded border"></div>`;
              }
              return `<div class="mb-2"><a href="${url}" target="_blank" rel="noopener">📎 ${name}</a></div>`;
            }).join('') : '<div class="text-muted">Aucune pièce jointe.</div>'}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = new bootstrap.Modal(document.getElementById(id));
    modal.show();
    document.getElementById(id).addEventListener('hidden.bs.modal', e => e.currentTarget.remove(), { once:true });
  }

  // ------------- Wiring -------------
  document.addEventListener('DOMContentLoaded', () => {
    $('#btnApplyFilters')?.addEventListener('click', applyFilters);
    $('#btnClearFilters')?.addEventListener('click', clearFilters);
    $('#btnSync')?.addEventListener('click', loadEquipments);
    $('#chkAll')?.addEventListener('change', toggleAll);
    $('#btnBulkDelete')?.addEventListener('click', openBulkDelete);
    $('#btnSave')?.addEventListener('click', saveEquipment);
    $('#btnCancel')?.addEventListener('click', ()=>{ document.getElementById('list-tab').click(); });
    $('#btnAddSecteur')?.addEventListener('click', openModalSecteur);
    $('#btnFillBatLocal')?.addEventListener('click', ()=>toast('Bâtiment/Local rappelés si déjà saisis pour ce secteur.','info'));
    $('#btnDupLast')?.addEventListener('click', ()=>toast('Remplissage depuis le dernier type utilisé.','info'));
    $('#btnClearChat')?.addEventListener('click', clearAllThreads);
    $('#btnClearChat2')?.addEventListener('click', clearAllThreads);
    $('#btnCopier')?.addEventListener('click', ()=>{
      const text = ($('#chatHtml').innerText || '') + '\n\n' + ($('#chatThread').innerText || '');
      navigator.clipboard.writeText(text).then(()=>toast('Contenu copié','success'));
    });
    document.getElementById('add-tab')?.addEventListener('click', clearForm);
    document.getElementById('iaSend')?.addEventListener('click', ()=>sendChat('panel'));
    document.getElementById('btnSend')?.addEventListener('click', ()=>sendChat('tab'));

    document.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-action]');
      if(!btn) return;
      const act = btn.dataset.action;
      if (act === 'edit-equipment'){ editEquipment(Number(btn.dataset.id)); }
      if (act === 'delete-equipment'){ openDeleteModal(Number(btn.dataset.id), btn.dataset.label||''); }
      if (act === 'open-ia'){ openIA(Number(btn.dataset.id)); }
      if (act === 'open-photo'){ const src = btn.dataset.src || btn.getAttribute('data-src'); openPhoto(src); }
      if (act === 'open-attachments'){
        const id = Number(btn.dataset.id);
        const eq = equipments.find(e => e.id === id);
        if (eq) openAttachmentsModal(eq);
        e.preventDefault();
      }
    });

    loadEquipments(); loadSecteurs();
  });

  // Photo modal
  function openPhoto(encoded){
    const src = decodeURIComponent(encoded);
    $('#photoModalImg').src = src;
    $('#photoDownload').href = src;
    bootstrap.Modal.getOrCreateInstance($('#photoModal')).show();
  }
  window.openPhoto = openPhoto;

})();
