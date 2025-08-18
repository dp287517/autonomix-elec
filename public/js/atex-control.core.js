// /public/js/atex-control.core.js — v8 (fix Edit -> form rempli, viewer pièces jointes + clearForm)
(function(){

  if (window.lucide){ window.lucide.createIcons(); }

  const API = {
    secteurs: '/api/atex-secteurs',
    equipments: '/api/atex-equipments',
    equipment: (id) => '/api/atex-equipments/' + id,
    importExcel: '/api/atex-import-excel',
    importColumns: '/api/atex-import-columns',
    importCsvTpl: '/api/atex-import-template',
    importXlsxTpl: '/api/atex-import-template.xlsx',
    inspect: '/api/atex-inspect',
    help: (id) => '/api/atex-help/' + id,
    chat: '/api/atex-chat',
    photo: (id) => '/api/atex-photo/' + id
  };

  let equipments = [];
  let currentIA = null;
  const CHAT_KEY = 'atexIAHistoryV6';
  const AUTO_CONTEXT_KEY = 'atexAutoContext';
  const LAST_TYPE_KEY = 'atexLastType';

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function showToast(message, variant='primary'){
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

  // ---- Utils / rendu
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
  function stripCodeFences(s){
    if(typeof s!=='string') return '';
    return s.replace(/(?:^```(?:html)?|```$)/g,'').trim();
  }
  function renderIAContent(el, raw){
    let s = stripCodeFences(raw || '').trim();
    const looksHTML = /<\/?[a-z][\s\S]*>/i.test(s);
    if(!looksHTML){
      s = s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\r?\n/g,"<br>");
    }
    el.innerHTML = s;
  }

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

  // ---- Persistance (local)
  function getChatHistory(){ try{ return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); }catch{return []} }
  function setChatHistory(h){ localStorage.setItem(CHAT_KEY, JSON.stringify(h)); }
  function addToHistory(item){
    const h=getChatHistory();
    const idx = h.findIndex(x=>x.id===item.id);
    if (idx>=0) h[idx]=item; else h.unshift(item);
    setChatHistory(h.slice(0,300));
    renderHistory(); renderHistoryChat();
  }
  function getAutoContext(){ try{ return JSON.parse(localStorage.getItem(AUTO_CONTEXT_KEY) || '{}'); }catch{return {}} }
  function setAutoContext(obj){ localStorage.setItem(AUTO_CONTEXT_KEY, JSON.stringify(obj||{})); }
  function getLastType(){ try{ return JSON.parse(localStorage.getItem(LAST_TYPE_KEY) || '{}'); }catch{return {}} }
  function setLastType(obj){ localStorage.setItem(LAST_TYPE_KEY, JSON.stringify(obj||{})); }

  // ---- Chargement & rendu liste
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
      showToast('Équipements chargés','info');
    }catch(e){ showToast('Erreur chargement équipements','danger'); }
  }

  function isImageLink(u){ return /^data:image\//.test(u) || /\.(png|jpe?g|webp|gif)$/i.test(u||''); }
  function isPdfLink(u){ return /\.(pdf)$/i.test(u||''); }

  function renderAttachmentsCell(eq){
    const bits = [];
    // photo principale
    if (eq.photo && /^data:image\//.test(eq.photo)) {
      bits.push(`<img class="last-photo" src="${eq.photo}" alt="Photo" data-action="open-photo" data-src="${encodeURIComponent(eq.photo)}">`);
    } else {
      bits.push('<span class="text-muted">—</span>');
    }
    // attachments (array json ou texte ; on normalise)
    let atts = eq.attachments;
    if (typeof atts === 'string'){
      try{ atts = JSON.parse(atts); }catch{ atts = null; }
    }
    if (Array.isArray(atts) && atts.length){
      const thumbs = atts.slice(0,3).map((a,i)=>{
        const url = a && (a.url || a.href || a.path || a); // tolérant
        const label = a && (a.name || a.label) || ('Fichier '+(i+1));
        if (!url) return '';
        if (isImageLink(url)) {
          return `<img class="att-thumb" title="${label}" src="${url}" data-action="open-photo" data-src="${encodeURIComponent(url)}">`;
        }
        const icon = isPdfLink(url) ? '📄' : '📎';
        return `<a class="att-file" href="${url}" title="${label}" target="_blank" rel="noopener">${icon}</a>`;
      }).join('');
      const more = atts.length>3 ? `<a href="#" class="att-more" data-action="open-attachments" data-id="${eq.id}">+${atts.length-3}</a>` : '';
      bits.push(`<div class="att-wrap">${thumbs}${more}</div>`);
    }
    return bits.join(' ');
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
          <button class="btn btn-sm btn-outline-primary" data-action="edit-equipment" data-id="${eq.id}" title="Éditer"><i data-lucide="edit-3"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-equipment" data-id="${eq.id}" data-label="${(eq.composant||'').replace(/\"/g,'&quot;')}" title="Supprimer"><i data-lucide="trash-2"></i></button>
          <button class="btn btn-sm ${eq.has_ia_history ? 'btn-success' : (String(eq.conformite||'').toLowerCase().includes('non') ? 'btn-warning' : 'btn-outline-secondary')}" data-action="open-ia" data-id="${eq.id}" title="IA Analysis"><i data-lucide="sparkles"></i> IA</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    window.lucide?.createIcons();
    $$('.rowchk').forEach(c => c.addEventListener('change', updateBulkBtn));
  }

  // ---- Filtres
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

  // ---- Bulk delete
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
      showToast('Suppression en masse OK','success');
      await loadEquipments();
    }catch(e){ showToast('Erreur suppression masse: '+(e.message||e),'danger'); }
    finally{ bootstrap.Modal.getOrCreateInstance($('#deleteModal')).hide(); }
  }

  // ---- Form helpers
  function clearForm(){
    const ids = [
      'equipId','secteur-input','batiment-input','local-input','zone-g-input','zone-d-input',
      'composant-input','fournisseur-input','type-input','identifiant-input',
      'marquage_atex-input','comments-input','last-inspection-input'
    ];
    ids.forEach(id => { const el = $('#'+id); if(el) el.value = ''; });
    const file = $('#photo-input'); if (file) file.value = '';
  }

  // ---- Secteurs / prefills
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
    }catch{}
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
        const r = await fetch(API.secteurs,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
        if(!r.ok) throw new Error('Erreur API');
        await loadSecteurs(); $('#secteur-input').value=name; showToast('Secteur enregistré','success'); modal.hide(); el.remove();
      }catch(err){ el.querySelector('#secteurSaveMsg').textContent='Erreur: '+(err.message||err); }
    }, {once:true});
    el.addEventListener('hidden.bs.modal', ()=> el.remove(), {once:true});
  }
  function prefillBatLocal(){
    const ctx = getAutoContext();
    const secteur = $('#secteur-input').value || '';
    const last = ctx[secteur] || {};
    if(last.batiment) $('#batiment-input').value = last.batiment;
    if(last.local)    $('#local-input').value = last.local;
  }
  function fillFromLastType(){
    const last = getLastType();
    if(last.composant)   $('#composant-input').value = last.composant;
    if(last.fournisseur) $('#fournisseur-input').value = last.fournisseur;
    if(last.type)        $('#type-input').value = last.type;
    showToast('Champs remplis depuis le dernier type enregistré.','info');
  }

  // ---- IA & Chat
  function getThread(id){ const h=getChatHistory(); const it=h.find(x=>x.id===id); return (it&&it.thread)||[]; }
  function setThread(id, t){
    const h=getChatHistory();
    let it=h.find(x=>x.id===id);
    if(!it){ it={ id, content:'', meta:{}, thread:[], enriched:null, composant:'Équipement', date:new Date().toISOString()}; h.unshift(it); }
    it.thread = t; setChatHistory(h);
  }
  function renderThread(el, thread){
    el.innerHTML = '';
    thread.forEach(m=>{
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role==='user'?'user':'ia');
      if(m.role==='assistant'){
        const holder = document.createElement('div');
        renderIAContent(holder, m.content);
        div.innerHTML = holder.innerHTML;
      }else{
        div.textContent = m.content;
      }
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function buildLocalEnrichmentChat(_eq){
    return { reasons:[], palliatives:[], preventives:[], refs:[], costs:[] };
  }

  async function openIA(id, opts={}){
    currentIA = id;
    const off = bootstrap.Offcanvas.getOrCreateInstance($('#iaPanel')); off.show();
    $('#iaHeader').textContent = ''; $('#iaDetails').style.display='none'; $('#iaLoading').style.display='block';

    try{
      const [eqR, helpR] = await Promise.all([ fetch(API.equipment(id)), fetch(API.help(id)) ]);
      if(!eqR.ok) throw new Error('Équipement introuvable');
      const eq = await eqR.json();
      const help = await helpR.json();

      $('#iaHeader').textContent = `${eq.composant || 'Équipement'} — ID ${eq.id} • Dernière: ${fmtDate(eq.last_inspection_date)} • Prochaine: ${fmtDate(eq.next_inspection_date)}`;
      renderBadges(eq);

      const cleaned = stripCodeFences(help?.response || 'Aucune analyse IA disponible.');
      renderIAContent(document.getElementById('iaDetails'), cleaned);

      try{ document.getElementById('chatEnriched').style.display='none'; }catch(_){}

      addToHistory({
        id: eq.id, composant: eq.composant || 'Équipement', date: new Date().toISOString(),
        content: cleaned, enriched: null,
        meta: { conformite: eq.conformite || 'N/A', risque: eq.risque ?? '-', zone_g: eq.zone_gaz||'-', zone_d: eq.zone_poussieres||'-', last: fmtDate(eq.last_inspection_date), next: fmtDate(eq.next_inspection_date) },
        thread: getThread(eq.id)
      });

      $('#iaLoading').style.display='none'; $('#iaDetails').style.display='block';
      renderThread(document.getElementById('iaThread'), getThread(eq.id));

      if(opts.openChat){ const __ct=document.getElementById('chat-tab'); if(__ct) __ct.click(); setTimeout(()=>selectHistoryChat(0),60); }
    }catch(e){
      $('#iaLoading').style.display='none';
      $('#iaDetails').style.display='block';
      renderIAContent(document.getElementById('iaDetails'), `<div class="alert alert-danger">Erreur IA: ${e.message||e}</div>`);
    }
  }
  window.openIA = openIA;

  function renderBadges(eq){
    try{
      const cont = document.getElementById('autoLinks');
      if (!cont) return;
      buildDynamicSuggestions(eq);
    }catch(_){}
  }
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
    if(!isNC){ cont.innerHTML = '<div class="text-muted small">Aucune suggestion (équipement conforme).</div>'; return; }

    const req = requiredCategoryForZone(eq?.zone_gaz, eq?.zone_poussieres);
    const items = [];
    const comp = (eq?.composant || '').toLowerCase();

    if(comp.includes('pression') || comp.includes('capteur')){
      items.push({ label: 'Capteur de pression ATEX — IFM PN7092 (réf.)', href: 'https://www.ifm.com/' });
    }
    items.push({ label: 'Boîte de jonction Ex e — R. STAHL', href: 'https://r-stahl.com/' });
    items.push({ label: 'Boîte de jonction Ex d — R. STAHL', href: 'https://r-stahl.com/' });
    items.push({ label: 'Distributeur — RS UK (recherche par référence)', href: 'https://uk.rs-online.com/' });

    cont.innerHTML = `
      <div class="small mb-2 text-muted">Catégorie requise estimée : ${req}</div>
      ${items.map(it => `<a class="d-block" href="${it.href}" target="_blank" rel="noopener">${it.label}</a>`).join('')}
    `;
  }

  function renderHistory(activeId=null){
    const list = $('#iaHistoryList'); list.innerHTML='';
    const h=getChatHistory(); if(!h.length){ list.innerHTML='<li class="list-group-item text-muted">Aucun historique.</li>'; return; }
    h.forEach((it,idx)=>{
      const li=document.createElement('li');
      li.className='list-group-item ia-item'+(it.id===activeId?' active':'');
      li.innerHTML=`
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-bold">${it.composant || 'Équipement'} — ID ${it.id}</div>
            <div class="small text-muted">${fmtDate(it.date)} • Dernière: ${it.meta?.last||'-'} • Prochaine: ${it.meta?.next||'-'}</div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" data-action="open-ia" data-id="${it.id}">Ouvrir</button>
          </div>
        </div>`;
      li.addEventListener('click', ()=>selectHistoryChat(idx));
      list.appendChild(li);
    });
  }
  function renderHistoryChat(){
    const h = getChatHistory();
    const it = h[0]; // dernier
    if(!it){ document.getElementById('chatHeader').textContent=''; document.getElementById('chatHtml').innerHTML=''; document.getElementById('chatThread').innerHTML=''; return; }
    document.getElementById('chatHeader').textContent = `${it.composant || 'Équipement'} — ID ${it.id} • Dernière: ${it.meta?.last||'-'} • Prochaine: ${it.meta?.next||'-'}`;
    renderIAContent(document.getElementById('chatHtml'), it.content || '—');
    try{ document.getElementById('chatEnriched').style.display='block'; buildLocalEnrichmentChat({ conformite: it.meta?.conformite, zone_gaz: it.meta?.zone_g, zone_poussieres: it.meta?.zone_d, marquage_atex: '' }); }catch(_){}
    renderThread(document.getElementById('chatThread'), it.thread||[]);
  }
  function selectHistoryChat(idx){
    const h = getChatHistory();
    const it = h[idx]; if(!it) return;
    currentIA = it.id;
    document.getElementById('chatHeader').textContent = `${it.composant || 'Équipement'} — ID ${it.id} • Dernière: ${it.meta?.last||'-'} • Prochaine: ${it.meta?.next||'-'}`;
    renderIAContent(document.getElementById('chatHtml'), it.content || '—'); document.getElementById('chatEnriched').style.display='block'; try{ buildLocalEnrichmentChat({ conformite: it.meta?.conformite, zone_gaz: it.meta?.zone_g, zone_poussieres: it.meta?.zone_d, marquage_atex: '' }); }catch(_){}
    renderThread(document.getElementById('chatThread'), it.thread||[]);
  }
  function clearChatHistory(){
    setChatHistory([]); document.getElementById('iaDetails').innerHTML=''; document.getElementById('chatHtml').innerHTML='';
    document.getElementById('chatHeader').textContent=''; document.getElementById('chatThread').innerHTML='';
    renderHistory(); renderHistoryChat(); showToast('Historique effacé','info');
  }
  function copyChat(){
    const text = (document.getElementById('chatHtml').innerText || '') + '\n\n' + (document.getElementById('chatThread').innerText || '');
    navigator.clipboard.writeText(text).then(()=>showToast('Contenu copié','success'));
  }
  async function sendChatFromTab(){ const text = ($('#chatPrompt').value || '').trim(); if(!text || !currentIA) return; await sendChat(text, 'tab'); $('#chatPrompt').value=''; }
  async function sendChatFromPanel(){ const text = ($('#iaPrompt').value || '').trim(); if(!text || !currentIA) return; await sendChat(text, 'panel'); $('#iaPrompt').value=''; }
  async function sendChat(text, origin){
    try{
      const eqR = await fetch(API.equipment(currentIA)); if(!eqR.ok) throw new Error('Équipement introuvable');
      const eq = await eqR.json();
      const h = getChatHistory(); const item = h.find(x=>x.id===currentIA);
      const historyForApi = (item?.thread || []).map(m=>({ role: m.role==='assistant'?'assistant':'user', content: m.content }));
      const resp = await fetch(API.chat, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question: text, equipment: null, history: historyForApi }) });
      const data = await resp.json(); const iaText = data?.response || 'Réponse indisponible.';
      const thread = getThread(currentIA); thread.push({role:'user', content:text}); thread.push({role:'assistant', content:iaText}); setThread(currentIA, thread);
      renderThread(origin==='panel' ? document.getElementById('iaThread') : document.getElementById('chatThread'), thread);
    }catch(e){ showToast('Erreur chat: '+(e.message||e),'danger'); }
  }

  // ---- Photo
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

  // ---- Save / Edit / Delete
  async function saveEquipment(){
    const required = ['secteur-input','batiment-input','composant-input'];
    const missing = required.filter(id => !($('#'+id)?.value || '').trim());
    if (missing.length){ showToast('Champs manquants : '+missing.join(', '),'warning'); return; }

    const id = $('#equipId').value || null;
    const zone_g = $('#zone-g-input').value || '';
    const zone_d = $('#zone-d-input').value || '';

    // mémos
    const secteur = $('#secteur-input').value;
    const ctx = getAutoContext(); ctx[secteur] = { batiment: $('#batiment-input').value, local: $('#local-input').value }; setAutoContext(ctx);
    setLastType({ composant: $('#composant-input').value, fournisseur: $('#fournisseur-input').value, type: $('#type-input').value });

    const file = $('#photo-input').files[0] || null;
    let photoBase64 = null;
    if (file && file.size > 180*1024 && id) {
      try { await uploadPhotoMultipart(id, file); showToast('Photo envoyée (multipart)','success'); }
      catch (e) { showToast('Échec upload photo: '+(e.message||e),'danger'); }
    } else if (file) {
      photoBase64 = await resizeImageToDataURL(file);
    }

    const data = {
      secteur, batiment: $('#batiment-input').value, local: $('#local-input').value,
      composant: $('#composant-input').value, fournisseur: $('#fournisseur-input').value,
      type: $('#type-input').value, identifiant: $('#identifiant-input').value,
      marquage_atex: $('#marquage_atex-input').value, comments: $('#comments-input').value,
      zone_gaz: zone_g || null, zone_poussieres: zone_d || null, zone_poussiere: zone_d || null,
      photo: photoBase64
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? API.equipment(id) : API.equipments;

    try{
      const r = await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!r.ok) {
        const errTxt = await r.text();
        if (r.status===413 || /trop volumineuse|too large/i.test(errTxt)) {
          showToast('Image trop lourde. Enregistre, puis ré-ajoute la photo (multipart).','warning');
        } else {
          throw new Error('Erreur enregistrement');
        }
      }
      const saved = await r.json();
      if (!id && file && file.size > 180*1024 && saved?.id) { await uploadPhotoMultipart(saved.id, file); }

      const last = $('#last-inspection-input').value;
      if(last){
        await fetch(API.inspect,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment_id:saved.id,status:'done',inspection_date:last})});
      }
      showToast('Équipement sauvegardé.','success');
      await loadEquipments();
      document.getElementById('list-tab').click();
      clearForm();
    }catch(e){ showToast('Erreur: '+(e.message||e),'danger'); }
  }

  async function editEquipment(id){
    try{
      // 1) Ouvre l’onglet "Ajouter" (le clearForm sera fait là)
      const addTab = document.getElementById('add-tab');
      if (addTab) addTab.click();
      // 2) Attends un tour d’event loop pour laisser l’UI se poser
      await new Promise(r => setTimeout(r, 0));

      // 3) Charge et remplit
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
    }catch(e){ showToast('Erreur édition: '+(e.message||e),'danger'); }
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
      showToast('Supprimé !','success');
      await loadEquipments();
    }catch(e){ showToast('Erreur suppression: '+(e.message||e),'danger'); }
    finally{ bootstrap.Modal.getOrCreateInstance($('#deleteModal')).hide(); }
  }

  // ---- Import
  async function importExcel(){
    const input = $('#excelFile');
    if (!input || !input.files || !input.files[0]) { showToast('Sélectionnez un fichier.','warning'); return; }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try{
      const r = await fetch(API.importExcel, { method:'POST', body: fd });
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data?.error || ('HTTP '+r.status));
      showToast(`Import terminé: ${data?.inserted||0} insérés, ${data?.updated||0} mis à jour.`, 'success');
      await loadEquipments();
    }catch(e){ showToast('Erreur import: '+(e.message||e),'danger'); }
  }

  // ---- Attachments viewer (modal injecté)
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

  // ---- Wiring global
  document.addEventListener('DOMContentLoaded', () => {
    $('#btnApplyFilters')?.addEventListener('click', applyFilters);
    $('#btnClearFilters')?.addEventListener('click', clearFilters);
    $('#btnSync')?.addEventListener('click', loadEquipments);
    $('#chkAll')?.addEventListener('change', toggleAll);
    $('#btnBulkDelete')?.addEventListener('click', openBulkDelete);
    $('#btnSave')?.addEventListener('click', saveEquipment);
    $('#btnCancel')?.addEventListener('click', ()=>{ document.getElementById('list-tab').click(); });
    $('#btnAddSecteur')?.addEventListener('click', openModalSecteur);
    $('#btnFillBatLocal')?.addEventListener('click', prefillBatLocal);
    $('#btnDupLast')?.addEventListener('click', fillFromLastType);
    $('#btnImport')?.addEventListener('click', importExcel);
    $('#btnClearChat')?.addEventListener('click', clearChatHistory);
    $('#btnReanalyse')?.addEventListener('click', () => currentIA && openIA(currentIA, {forceReload:true, openChat:true}));
    $('#btnCopier')?.addEventListener('click', copyChat);
    $('#btnSend')?.addEventListener('click', sendChatFromTab);

    // “Ajouter” cliqué directement par l’utilisateur = vraie création => on nettoie
    document.getElementById('add-tab')?.addEventListener('click', clearForm);

    $('#btnOpenInChat')?.addEventListener('click', () => {
      const off = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('iaPanel'));
      off.hide();
      const h = getChatHistory();
      let idx = h.findIndex(x => x.id === currentIA);
      if (idx < 0) idx = 0;
      const __ct=document.getElementById('chat-tab'); if(__ct) __ct.click();
      setTimeout(() => { if (h.length) selectHistoryChat(idx); }, 50);
    });
    document.querySelector('#btnClearChat2')?.addEventListener('click', clearChatHistory);
    document.querySelector('#iaSend')?.addEventListener('click', sendChatFromPanel);

    // Délégations
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

  // Photo modal (ouverture)
  function openPhoto(encoded){
    const src = decodeURIComponent(encoded);
    $('#photoModalImg').src = src;
    $('#photoDownload').href = src;
    bootstrap.Modal.getOrCreateInstance($('#photoModal')).show();
  }
  window.openPhoto = openPhoto;

})();
