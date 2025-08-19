// routes/atex.js — v12 (full)
// - Secteurs GET/POST (sans created_by)
// - Équipements CRUD (normalisation date/json, gestion conflits identifiant)
// - Photo upload (dataURL)
// - Import CSV/XLSX
// - IA: aide + chat avec persistance ia_history
// - Viewer: /equip/:id (photo + attachments normalisés)
// - Logs explicites pour debug

const express = require('express');
const router = express.Router();
console.log('[ATEX ROUTES] v12 loaded');

const { pool } = require('../config/db');

// Auth middleware (fallback no-op si absent)
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

// ---------- Helpers DB & Normalisation ----------
async function roleOnAccount(userId, accountId){
  const r = await pool.query(
    `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
    [userId, accountId]
  );
  return r.rowCount ? r.rows[0].role : null;
}

function normStr(v){ return (v==null || v===undefined) ? null : String(v); }

function parseMaybeJSON(value){
  if (value == null) return null;
  if (Array.isArray(value) || typeof value === 'object') return value;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value === 'string'){
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
function ensureArray(x){
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  const parsed = parseMaybeJSON(x);
  return Array.isArray(parsed) ? parsed : [];
}
function sanitizeAttachmentItem(item){
  // Accepte soit string (url/data), soit objet {url|data, name?, mime?}
  if (!item) return null;
  if (typeof item === 'string'){
    const src = item.trim();
    if (!src) return null;
    return { url: src, name: 'Pièce', mime: guessMime(src) };
  }
  if (typeof item === 'object'){
    const src = item.url || item.href || item.path || item.data || '';
    const name = item.name || item.label || 'Pièce';
    const mime = item.mime || guessMime(src) || '';
    if (!src) return null;
    // data:... => on force 'data' pour éviter CSP des iframes externes
    if (String(src).startsWith('data:')){
      return { data: src, name, mime };
    }
    return { url: src, name, mime };
  }
  return null;
}
function guessMime(u){
  const s = String(u||'').toLowerCase();
  if (s.startsWith('data:')){
    const m = s.slice(5).split(';')[0];
    return m || '';
  }
  if (s.endsWith('.pdf')) return 'application/pdf';
  if (s.match(/\.(png|jpg|jpeg|gif|webp)$/)) return 'image/*';
  return '';
}
function normDateISOtoSQL(d){
  // Accepte 'YYYY-MM-DD' ou ISO => retourne 'YYYY-MM-DD' ou null
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  const iso = new Date(s);
  if (isNaN(iso)) {
    // si déjà au bon format date SQL on laisse passer
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
  }
  const y = iso.getFullYear(), m = String(iso.getMonth()+1).padStart(2,'0'), dd = String(iso.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function deriveConfAndRisk(payload = {}) {
  const norm = (s)=> String(s||'').trim().toLowerCase();
  const gz = norm(payload.zone_gaz);
  const dz = norm(payload.zone_poussieres || payload.zone_poussiere);
  const markRaw = String(payload.marquage_atex || '');
  const mark = norm(markRaw);

  let risk = 1;
  if (['0','20'].includes(gz) || ['0','20'].includes(dz)) risk = 5;
  else if (['1','21'].includes(gz) || ['1','21'].includes(dz)) risk = 4;
  else if (['2','22'].includes(gz) || ['2','22'].includes(dz)) risk = 3;

  const reqCatG = gz === '0' ? 1 : gz === '1' ? 2 : gz === '2' ? 3 : null;
  const reqCatD = dz === '20' ? 1 : dz === '21' ? 2 : dz === '22' ? 3 : null;

  const matchNG = markRaw.match(/(?:\b|[^A-Za-z0-9])(1|2|3)\s*[Gg](?:\b|[^A-Za-z])/);
  const matchND = markRaw.match(/(?:\b|[^A-Za-z0-9])(1|2|3)\s*[Dd](?:\b|[^A-Za-z])/);
  const hasGasLetter = /(^|[^a-z])g([^a-z]|$)/i.test(markRaw) || /ex[^a-z0-9]*[ig]/i.test(markRaw);
  const hasDustLetter = /(^|[^a-z])d([^a-z]|$)/i.test(markRaw) || /\bex\s*t[bdc]/i.test(markRaw) || /\biiic\b/i.test(markRaw);

  let confReason = null;

  if (!mark || mark.includes('pas de marquage')) {
    confReason = 'Non conforme – marquage manquant';
  } else {
    if (reqCatG) {
      if (!hasGasLetter) confReason = 'Non conforme – marquage gaz (G) absent';
      const catG = matchNG ? Number(matchNG[1]) : null;
      if (!confReason && catG && catG <= 3) {
        if (catG < reqCatG) confReason = `Non conforme – catégorie G insuffisante (requis ≥ ${reqCatG}G)`;
      } else if (!confReason && catG == null) {
        confReason = `Non conforme – catégorie G absente (requis ≥ ${reqCatG}G)`;
      }
    }
    if (!confReason && reqCatD) {
      if (!hasDustLetter) confReason = 'Non conforme – marquage poussières (D) absent';
      const catD = matchND ? Number(matchND[1]) : null;
      if (!confReason && catD && catD <= 3) {
        if (catD < reqCatD) confReason = `Non conforme – catégorie D insuffisante (requis ≥ ${reqCatD}D)`;
      } else if (!confReason && catD == null) {
        confReason = `Non conforme – catégorie D absente (requis ≥ ${reqCatD}D)`;
      }
    }
  }

  let conformite = payload.conformite;
  if (!conformite || !norm(conformite)) {
    conformite = confReason ? confReason : 'Conforme';
  }
  if (norm(conformite).includes('non')) risk = Math.min(5, risk + 1);

  return { risque: risk, conformite };
}
function requiredCategoryForZone(zg, zd){
  const zgNum = String(zg||'').replace(/[^0-9]/g,'') || '';
  const zdNum = String(zd||'').replace(/[^0-9]/g,'') || '';
  if(zgNum === '0' || zdNum === '20') return 'II 1GD';
  if(zgNum === '1' || zdNum === '21') return 'II 2GD';
  return 'II 3GD';
}
function fmtDate(d){
  if(!d) return 'N/A';
  const date = new Date(d); if(isNaN(date)) return d;
  const dd=String(date.getDate()).padStart(2,'0'), mm=String(date.getMonth()+1).padStart(2,'0'), yyyy=date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
function buildEnrich(eq, conf){
  const enriched = { palliatives:[], preventives:[], refs:[], costs:[], why:'' };
  const zg = String(eq.zone_gaz||'').trim();
  const zd = String(eq.zone_poussieres||eq.zone_poussiere||'').trim();
  const req = requiredCategoryForZone(zg, zd);
  const mark = String(eq.marquage_atex||'').toLowerCase();

  if (String(conf.conformite).toLowerCase().includes('non')){
    enriched.why = conf.conformite;
    if (!mark || mark.includes('pas de marquage')){
      enriched.palliatives.push('Mettre hors tension et éloigner de la zone classée si possible.');
      enriched.preventives.push('Remplacer par un matériel **certifié ATEX** correspondant aux zones.');
      enriched.refs.push('Directive 2014/34/UE – Matériels ATEX.');
      enriched.costs.push('Remplacement matériel certifié : 400€–2 500€ selon le composant.');
    }
  } else {
    enriched.why = 'Conforme aux exigences déclarées.';
  }
  if (zg === '0' || zd === '20') enriched.refs.push('Exigence de catégorie 1G/1D pour zone 0/20.');
  if (zg === '1' || zd === '21') enriched.refs.push('Exigence de catégorie 2G/2D pour zone 1/21.');
  if (zg === '2' || zd === '22') enriched.refs.push('Exigence de catégorie 3G/3D pour zone 2/22.');
  enriched.refs.push('EN 60079 (série) — Ex d / Ex e / Ex t.');
  enriched.costs.push('Inspection initiale + rapport : 250€–600€.');
  return enriched;
}

// ---------- SECTEURS ----------
router.get('/atex-secteurs', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q1 = await pool.query(
      `SELECT DISTINCT name FROM public.atex_secteurs WHERE account_id=$1 ORDER BY name ASC`,
      [accountId]
    ).catch(()=>({ rows:[] }));
    const q2 = await pool.query(
      `SELECT DISTINCT secteur AS name
         FROM public.atex_equipments
        WHERE account_id=$1 AND secteur IS NOT NULL AND secteur <> ''
        ORDER BY name ASC`,
      [accountId]
    );
    const set = new Set();
    (q1.rows||[]).forEach(r=> r.name && set.add(r.name));
    (q2.rows||[]).forEach(r=> r.name && set.add(r.name));
    return res.json(Array.from(set).sort().map(name=>({name})));
  } catch (e) {
    console.error('[GET /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});
router.post('/atex-secteurs', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const name = (req.body && req.body.name || '').trim();
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !name) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    // IMPORTANT: pas de created_by (la colonne n'existe pas sur certains schémas)
    await pool.query(
      `INSERT INTO public.atex_secteurs (account_id, name)
       VALUES ($1,$2)
       ON CONFLICT (account_id, name) DO NOTHING`,
      [accountId, name]
    );
    console.log('[POST /atex-secteurs] ok', { accountId, name });
    return res.status(201).json({ ok:true, name });
  }catch(e){
    console.error('[POST /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- LISTE ----------
router.get('/atex-equipments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
              identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
              photo, conformite, comments, last_inspection_date, next_inspection_date,
              risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
              zone_poussieres, ia_history, attachments, account_id, created_by
         FROM public.atex_equipments
        WHERE account_id=$1
        ORDER BY id DESC`,
      [accountId]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error('[GET /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- CRUD ----------
router.post('/atex-equipments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const b = req.body || {};
    // Normalisations
    b.last_inspection_date = normDateISOtoSQL(b.last_inspection_date);
    b.next_inspection_date = normDateISOtoSQL(b.next_inspection_date);
    b.zone_gaz = (b.zone_gaz===''?null:b.zone_gaz);
    b.zone_poussiere = (b.zone_poussiere===''?null:b.zone_poussiere);
    b.zone_poussieres = (b.zone_poussieres===''?null:b.zone_poussieres);

    const derived = deriveConfAndRisk(b);
    if (b.risque == null) b.risque = derived.risque;
    if (!b.conformite) b.conformite = derived.conformite;

    // attachments (jsonb)
    let attachments = ensureArray(b.attachments).map(sanitizeAttachmentItem).filter(Boolean);
    // ia_history (jsonb)
    let ia_history = ensureArray(b.ia_history).map(m => ({ role: (m.role==='assistant'?'assistant':'user'), content: String(m.content||'') }));

    const fields = [
      'risque','secteur','batiment','local','composant','fournisseur','type',
      'identifiant','interieur','exterieur','categorie_minimum','marquage_atex',
      'photo','conformite','comments','last_inspection_date', 'next_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const values = fields.map(k => {
      if (k==='attachments') return (attachments.length ? JSON.stringify(attachments) : null);
      if (k==='ia_history')  return (ia_history.length ? JSON.stringify(ia_history) : null);
      return b[k] ?? null;
    });

    try{
      const q = await pool.query(
        `INSERT INTO public.atex_equipments (
           ${fields.join(', ')}, account_id, created_by
         ) VALUES (
           ${fields.map((_,i)=>'$'+(i+1)).join(', ')}, $${fields.length+1}, $${fields.length+2}
         )
         RETURNING id`,
        [...values, accountId, uid]
      );
      return res.status(201).json({ id: q.rows[0].id });
    }catch (err){
      // gestion conflit identifiant unique (y compris index normalisé)
      if (String(err.code)==='23505'){
        return res.status(409).json({ error: 'conflict', message: 'Identifiant déjà utilisé' });
      }
      throw err;
    }
  } catch (e) {
    console.error('[POST /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-equipments/:id', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT * FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    return res.json(q.rows[0]);
  }catch(e){
    console.error('[GET /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/atex-equipments/:id', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const b = req.body || {};
    // Normalisations
    b.last_inspection_date = normDateISOtoSQL(b.last_inspection_date);
    b.next_inspection_date = normDateISOtoSQL(b.next_inspection_date);
    b.zone_gaz = (b.zone_gaz===''?null:b.zone_gaz);
    b.zone_poussiere = (b.zone_poussiere===''?null:b.zone_poussiere);
    b.zone_poussieres = (b.zone_poussieres===''?null:b.zone_poussieres);

    const derived = deriveConfAndRisk(b);
    if (b.risque == null) b.risque = derived.risque;
    if (!b.conformite) b.conformite = derived.conformite;

    // attachments
    let attachments = ensureArray(b.attachments).map(sanitizeAttachmentItem).filter(Boolean);
    // ia_history
    let ia_history = ensureArray(b.ia_history).map(m => ({ role: (m.role==='assistant'?'assistant':'user'), content: String(m.content||'') }));

    const fields = [
      'risque','secteur','batiment','local','composant','fournisseur','type',
      'identifiant','interieur','exterieur','categorie_minimum','marquage_atex',
      'photo','conformite','comments','last_inspection_date', 'next_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const sets = fields.map((k,i)=> `${k}=$${i+1}`);
    const vals = fields.map(k => {
      if (k==='attachments') return (attachments.length ? JSON.stringify(attachments) : null);
      if (k==='ia_history')  return (ia_history.length ? JSON.stringify(ia_history) : null);
      return b[k] ?? null;
    });

    try{
      const q = await pool.query(
        `UPDATE public.atex_equipments
            SET ${sets.join(', ')}
          WHERE id=$${fields.length+1} AND account_id=$${fields.length+2}
          RETURNING id`,
        [...vals, id, accountId]
      );
      if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
      console.log('[PUT /atex-equipments/:id] updating', { id, accountId, has_att: attachments.length });
      return res.json({ id: q.rows[0].id, ok: true });
    }catch (err){
      if (String(err.code)==='23505'){
        return res.status(409).json({ error: 'conflict', message: 'Identifiant déjà utilisé' });
      }
      console.error('[PUT /atex-equipments/:id] error', err);
      throw err;
    }
  }catch(e){
    console.error('[PUT /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/atex-equipments/:id', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `DELETE FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    return res.json({ ok: true, deleted: q.rowCount });
  }catch(e){
    console.error('[DELETE /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- INSPECTION ----------
router.post('/atex-inspect', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const { equipment_id, inspection_date } = req.body || {};
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipment_id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const nowSQL = normDateISOtoSQL(inspection_date || new Date().toISOString());
    await pool.query(
      `UPDATE public.atex_equipments
          SET last_inspection_date=$1
        WHERE id=$2 AND account_id=$3`,
      [nowSQL, equipment_id, accountId]
    );
    res.json({ ok: true, last_inspection_date: nowSQL });
  } catch (e) {
    console.error('[POST /atex-inspect] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- IA (HELP) ----------
router.get('/atex-help/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(`SELECT * FROM public.atex_equipments WHERE id=$1 AND account_id=$2`, [id, accountId]);
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    const eq = q.rows[0];

    const derived = deriveConfAndRisk(eq);
    const reqCat = requiredCategoryForZone(eq.zone_gaz, eq.zone_poussieres);
    const tips = [];
    if (String(derived.conformite).toLowerCase().includes('non')){
      if ((eq.marquage_atex||'').toLowerCase().includes('pas de marquage') || !eq.marquage_atex){
        tips.push('Installer un équipement <strong>certifié ATEX</strong> avec marquage conforme.');
      }
      tips.push(`Sélectionner du matériel <strong>catégorie ${reqCat}</strong> (zones GAZ/DUST indiquées).`);
      tips.push('Vérifier le raccordement, les presse-étoupes et la continuité équipotentielle.');
    } else {
      tips.push('Maintenir la conformité : inspections périodiques, vérification des joints et presse-étoupes.');
    }
    const next = eq.next_inspection_date ? fmtDate(eq.next_inspection_date) : 'à planifier';

    const html = `
      <h5>Analyse ATEX</h5>
      <ul>
        <li><strong>Conformité</strong> : ${derived.conformite}</li>
        <li><strong>Risque</strong> : ${derived.risque}/5</li>
        <li><strong>Zones</strong> : Gaz ${eq.zone_gaz || '—'} / Poussières ${eq.zone_poussieres || eq.zone_poussiere || '—'}</li>
        <li><strong>Marquage indiqué</strong> : ${eq.marquage_atex || '—'}</li>
        <li><strong>Catégorie requise estimée</strong> : ${reqCat}</li>
        <li><strong>Prochaine inspection</strong> : ${next}</li>
      </ul>
      <h6>Recommandations</h6>
      <ul>${tips.map(t=>`<li>${t}</li>`).join('')}</ul>
    `;

    const enrich = buildEnrich(eq, derived);
    return res.json({ response: html, enrich });
  } catch (e) { console.error('[GET /atex-help/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ---------- IA CHAT (PERSISTANT) ----------
router.post('/atex-chat', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const {
      question = '',
      equipment_id = null,
      history = []
    } = req.body || {};

    let eq = null;
    if (equipment_id) {
      const role = await roleOnAccount(uid, accountId);
      if (!role) return res.status(403).json({ error: 'forbidden_account' });

      const q = await pool.query(
        `SELECT id, ia_history
           FROM public.atex_equipments
          WHERE id=$1 AND account_id=$2`,
        [Number(equipment_id), accountId]
      );
      if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
      eq = q.rows[0];
    }

    // Appel IA si configuré
    let html = '<p>Service IA non configuré.</p>';
    try {
      const { chat } = require('../config/openai');
      if (typeof chat === 'function') {
        html = await chat({
          question,
          equipment: eq,              // peut être null
          history: Array.isArray(history) ? history : []
        });
      }
    } catch {}

    if (eq) {
      let existing = [];
      if (Array.isArray(eq.ia_history)) existing = eq.ia_history;
      else if (typeof eq.ia_history === 'string') { try { existing = JSON.parse(eq.ia_history) || []; } catch { existing = []; } }

      const safeHist = Array.isArray(history)
        ? history.map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user'), content: String(m.content || '') }))
        : [];
      const newThread = [
        ...existing,
        ...safeHist,
        { role: 'user', content: String(question || '') },
        { role: 'assistant', content: String(html || '') }
      ];

      await pool.query(
        `UPDATE public.atex_equipments
            SET ia_history = $1
          WHERE id = $2 AND account_id = $3`,
        [JSON.stringify(newThread), Number(equipment_id), accountId]
      );

      return res.json({ response: html, persisted: true, equipment_id, length: newThread.length });
    }

    return res.json({ response: html, persisted: false });
  } catch (e) {
    console.error('[POST /atex-chat] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- PHOTO (multipart) ----------
let multer;
try { multer = require('multer'); } catch {}
const upload = multer ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }) : null;

router.post('/atex-photo/:id', requireAuth, upload ? upload.single('file') : (_req,_res,next)=>next(), async (req, res) => {
  try{
    if (!upload) return res.status(501).json({ error: 'multer_unavailable' });
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });
    const mime = file.mimetype || 'image/jpeg';
    const base64 = file.buffer.toString('base64');
    const dataURL = `data:${mime};base64,${base64}`;

    const q = await pool.query(
      `UPDATE public.atex_equipments
          SET photo=$1
        WHERE id=$2 AND account_id=$3
        RETURNING id`,
      [dataURL, id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id });
  }catch(e){
    console.error('[POST /atex-photo/:id] error', e);
    if (String(e.message||'').match(/File too large/i)) return res.status(413).json({ error: 'file_too_large' });
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- IMPORT ----------
let xlsx;
try { xlsx = require('xlsx'); } catch { }

router.post('/atex-import-excel', requireAuth, upload ? upload.single('file') : (_req,_res,next)=>next(), async (req, res) => {
  try{
    if (!upload) return res.status(501).json({ error: 'multer_unavailable' });

    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });

    let rows = [];
    const mime = (file.mimetype || '').toLowerCase();
    const isCSV  = /csv|text\/plain/.test(mime) || /\.csv$/i.test(file.originalname||'');
    const isXLSX = /excel|spreadsheetml/.test(mime) || /\.xlsx$/i.test(file.originalname||'');
    if (isXLSX && xlsx){
      const wb = xlsx.read(file.buffer, { type:'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(ws, { defval: null });
    } else {
      const raw = file.buffer.toString('utf8');
      const lines = raw.split(/\r?\n/).filter(l=>l.trim().length);
      if (!lines.length) return res.json({ inserted:0, updated:0 });
      const sep = (raw.indexOf(';')>-1 && raw.indexOf(',')===-1) ? ';' : ',';
      const head = lines[0].split(sep).map(s=>s.trim());
      for (let i=1;i<lines.length;i++){
        const parts = lines[i].split(sep);
        const obj = {};
        head.forEach((h,idx)=> obj[h] = (parts[idx] ?? '').trim());
        rows.push(obj);
      }
    }

    let inserted=0, updated=0;
    for (const r of rows){
      const payload = {
        secteur: r.secteur ?? r.Secteur ?? null,
        batiment: r.batiment ?? r.Bâtiment ?? r.bat ?? null,
        local: r.local ?? null,
        composant: r.composant ?? r.Composant ?? null,
        fournisseur: r.fournisseur ?? r.fabricant ?? null,
        type: r.type ?? null,
        identifiant: r.identifiant ?? r.ID ?? null,
        marquage_atex: r.marquage_atex ?? r.Marquage ?? null,
        conformite: r.conformite ?? r.Conformite ?? r.Conformité ?? null,
        comments: r.comments ?? r.Commentaires ?? null,
        zone_gaz: r.zone_gaz ?? null,
        zone_poussieres: r.zone_poussieres ?? r.zone_poussiere ?? null,
        frequence: r.frequence ? Number(r.frequence) : null,
        last_inspection_date: normDateISOtoSQL(r.last_inspection_date || null)
      };

      const derived = deriveConfAndRisk(payload);
      if (payload.risque == null) payload.risque = derived.risque;
      if (!payload.conformite) payload.conformite = derived.conformite;

      // Existe déjà ?
      let existing = null;
      if (payload.identifiant){
        const ex = await pool.query(
          `SELECT id FROM public.atex_equipments WHERE account_id=$1 AND lower(TRIM(BOTH FROM identifiant))=lower(TRIM(BOTH FROM $2)) LIMIT 1`,
          [accountId, String(payload.identifiant)]
        );
        existing = ex.rowCount ? ex.rows[0].id : null;
      }

      if (existing){
        const keys = Object.keys(payload).filter(k => payload[k] !== undefined);
        if (keys.length){
          const sets = keys.map((k,i)=> `${k}=$${i+1}`);
          const vals = keys.map(k => payload[k]);
          await pool.query(
            `UPDATE public.atex_equipments SET ${sets.join(', ')}
             WHERE id=$${keys.length+1} AND account_id=$${keys.length+2}`,
            [...vals, existing, accountId]
          );
          updated++;
        }
      } else {
        const keys = Object.keys(payload).filter(k => payload[k] !== undefined);
        const vals = keys.map(k => payload[k] ?? null);
        await pool.query(
          `INSERT INTO public.atex_equipments (${keys.join(', ')}, account_id, created_by)
           VALUES (${keys.map((_,i)=>'$'+(i+1)).join(', ')}, $${keys.length+1}, $${keys.length+2})`,
          [...vals, accountId, req.user.uid]
        );
        inserted++;
      }
    }

    return res.json({ inserted, updated });
  }catch(e){
    console.error('[POST /atex-import-excel] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-import-columns', requireAuth, async (_req, res) => {
  return res.json({
    columns: [
      'secteur','batiment','local','composant','fournisseur','type','identifiant',
      'marquage_atex','conformite','comments','zone_gaz','zone_poussieres','frequence','last_inspection_date'
    ]
  });
});

router.get('/atex-import-template', requireAuth, async (_req, res) => {
  const headers = [
    'secteur','batiment','local','composant','fournisseur','type','identifiant',
    'marquage_atex','conformite','comments','zone_gaz','zone_poussieres','frequence','last_inspection_date'
  ];
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="atex_import_template.csv"');
  res.send(headers.join(',') + '\n');
});
router.get('/atex-import-template.xlsx', requireAuth, async (_req, res) => {
  try{
    const xlsx = require('xlsx');
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([[
      'secteur','batiment','local','composant','fournisseur','type','identifiant',
      'marquage_atex','conformite','comments','zone_gaz','zone_poussieres','frequence','last_inspection_date'
    ]]);
    xlsx.utils.book_append_sheet(wb, ws, 'ATEX');
    const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="atex_import_template.xlsx"');
    res.send(buf);
  }catch{
    const csv = 'secteur,batiment,local,composant,fournisseur,type,identifiant,marquage_atex,conformite,comments,zone_gaz,zone_poussieres,frequence,last_inspection_date\n';
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="atex_import_template.csv"');
    res.send(csv);
  }
});

// ---------- VIEWER (photo + attachments normalisés) ----------
router.get('/equip/:id', requireAuth, async (req,res)=>{
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT id, photo, attachments FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });

    const row = q.rows[0];
    console.log('[GET /equip/:id] ok', { id, accountId });

    let atts = ensureArray(row.attachments).map(sanitizeAttachmentItem).filter(Boolean);
    // Remonte la photo (si présente) comme première pièce image
    const items = [];
    if (row.photo && String(row.photo).startsWith('data:')){
      items.push({ data: row.photo, name: 'Photo', mime: guessMime(row.photo) || 'image/*' });
    }
    items.push(...atts);

    return res.json({ id: row.id, attachments: items });
  }catch(e){
    console.error('[GET /equip/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
