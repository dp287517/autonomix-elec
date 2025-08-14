// /public/js/atex-control.js
(() => {
  const API = (window.API_BASE_URL || '') + '/api';

  // ---------- State ----------
  let currentUser = null;
  let currentSelection = null;
  let fullTree = [];  // zones + équipements

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  function el(tag, attrs={}, children=[]) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  function fmtDate(s){ if(!s) return '—'; try{ return new Date(s).toLocaleDateString(); }catch{ return s; } }

  // ---------- Guard (auth) ----------
  async function guard(){
    const token = localStorage.getItem('autonomix_token') || '';
    if(!token){ location.href = 'login.html'; return; }
    const r = await fetch(`${API}/me`, { headers:{ Authorization:`Bearer ${token}` } });
    if(!r.ok){ localStorage.removeItem('autonomix_token'); location.href='login.html'; return; }
    const me = await r.json();
    currentUser = me;
    const userBadge = $('#userBadge');
    if (userBadge) userBadge.textContent = `${me.email} • compte #${me.account_id ?? '—'} • ${me.role || ''}`;
  }

  // ---------- Dummy data (replace with API calls when ready) ----------
  function buildDummyTree(){
    // Exemples de zones et équipements ; côté API, tu pourras renvoyer la même structure
    // [{ id, type:'zone'|'equip', name, code?, zone, lastInsp?, status? , children:[...] }]
    return [
      { id:'Z1', type:'zone', name:'Atelier Emballage', children:[
        { id:'E1', type:'equip', name:'Moteur convoyeur', code:'EX-MOT-001', zone:'Z1', lastInsp:'2025-07-01', status:'OK' },
        { id:'E2', type:'equip', name:'Ventilateur', code:'EX-VEN-014', zone:'Z1', lastInsp:'2025-06-15', status:'À vérifier' },
      ]},
      { id:'Z2', type:'zone', name:'Local Solvant', children:[
        { id:'E3', type:'equip', name:'Pompe doseuse', code:'EX-PMP-022', zone:'Z2', lastInsp:'2025-08-10', status:'OK' },
      ]},
    ];
  }

  // ---------- Rendering ----------
  function renderTree(data){
    const host = $('#tree'); if(!host) return;
    host.innerHTML='';
    const root = el('ul');

    const rec = (node) => {
      const li = el('li');
      const line = el('div', { class:'node' }, [
        el('span', { class:'badge' }, [ node.type === 'zone' ? 'Zone' : 'Équip.' ]),
        el('span', {}, [ node.name ]),
      ]);
      line.addEventListener('click', () => {
        currentSelection = node;
        renderDetails(node);
      });
      li.appendChild(line);
      if (node.children && node.children.length){
        const ul = el('ul');
        node.children.forEach(ch => ul.appendChild(rec(ch)));
        li.appendChild(ul);
      }
      return li;
    };

    data.forEach(n => root.appendChild(rec(n)));
    host.appendChild(root);
  }

  function renderDetails(node){
    const empty = $('#emptyState');
    const det = $('#detail');
    const t = $('#detailTitle');
    const typ = $('#detailType');
    const code = $('#detailCode');
    const zone = $('#detailZone');
    const last = $('#detailLastInsp');
    const st = $('#detailStatus');
    const selInfo = $('#selInfo');

    if (empty) empty.classList.add('d-none');
    if (det) det.classList.remove('d-none');

    if (selInfo) selInfo.textContent = `${node.type === 'zone' ? 'Zone' : 'Équipement'} sélectionné : ${node.name}`;

    if (t) t.textContent = node.name;
    if (typ) typ.textContent = node.type === 'zone' ? 'Zone ATEX' : 'Équipement ATEX';
    if (code) code.textContent = node.code || '—';
    if (zone) zone.textContent = node.zone || (node.type === 'zone' ? node.name : '—');
    if (last) last.textContent = fmtDate(node.lastInsp);
    if (st) st.textContent = node.status || (node.type === 'zone' ? '—' : 'Inconnu');
  }

  // ---------- Filters / Search ----------
  function applySearch(q){
    const normalized = (q||'').toLowerCase();
    if(!normalized){
      renderTree(fullTree);
      return;
    }
    // Filtrage simple: on conserve les zones qui contiennent un enfant matché
    const filtered = fullTree.map(z => {
      if (z.type !== 'zone') return z;
      const kids = (z.children||[]).filter(e =>
        (e.name||'').toLowerCase().includes(normalized) ||
        (e.code||'').toLowerCase().includes(normalized) ||
        (e.zone||'').toLowerCase().includes(normalized)
      );
      if ((z.name||'').toLowerCase().includes(normalized) || kids.length){
        return { ...z, children:kids };
      }
      return null;
    }).filter(Boolean);
    renderTree(filtered);
  }

  // ---------- Wire (safe with null-checks) ----------
  function wireEvents(){
    const btnBack = $('#btnBackDash');
    if (btnBack) btnBack.addEventListener('click', () => { location.href = 'dashboard.html'; });

    const search = $('#searchInput');
    if (search) search.addEventListener('input', (e) => applySearch(e.target.value));

    const btnClear = $('#btnClear');
    if (btnClear) btnClear.addEventListener('click', () => {
      if (search) search.value = '';
      applySearch('');
    });

    const btnAddEquip = $('#btnAddEquip');
    if (btnAddEquip) btnAddEquip.addEventListener('click', () => {
      alert('Création d’équipement à venir (backend).');
    });

    const btnAddZone = $('#btnAddZone');
    if (btnAddZone) btnAddZone.addEventListener('click', () => {
      alert('Création de zone à venir (backend).');
    });

    const btnExport = $('#btnExport');
    if (btnExport) btnExport.addEventListener('click', () => {
      exportCsv();
    });
  }

  function exportCsv(){
    // Exporte les équipements visibles dans l’arborescence filtrée
    // (simple: on aplatit toutes les zones affichées)
    const list = [];
    const walk = (nodes) => nodes.forEach(n => {
      if (n.type === 'equip') list.append?.(n);
      if (n.children) walk(n.children);
    });

    // Récupérer depuis le DOM actuel
    // Ici on re-parcourt fullTree filtré via la recherche courante (plus simple: on réapplique la recherche actuelle)
    // Pour rester simple, on exporte tout fullTree (à adapter si besoin d’export filtré)
    const rows = [['type','name','code','zone','last_inspection','status']];
    const flatten = (nodes, parentZone=null) => nodes.forEach(n => {
      if (n.type === 'equip'){
        rows.push(['equip', n.name || '', n.code || '', n.zone || parentZone || '', n.lastInsp || '', n.status || '']);
      }
      if (n.children) flatten(n.children, n.name);
    });
    flatten(fullTree);

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'atex-equipements.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await guard();
      wireEvents();
      fullTree = buildDummyTree(); // TODO: remplace par une requête API quand dispo
      renderTree(fullTree);
    } catch (e) {
      console.error('[ATEX] init failed', e);
    }
  });
})();
