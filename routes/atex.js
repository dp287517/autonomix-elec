// routes/atex.js — v15 (attachments harden ++, ::jsonb, COALESCE on PUT, full feature set)
const express = require('express');
const router = express.Router();
console.log('[ATEX ROUTES] v15 loaded');

const { pool } = require('../config/db');

// Auth soft fallback
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

// -------------------- Helpers --------------------
async function roleOnAccount(userId, accountId){
  const r = await pool.query(
    `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
    [userId, accountId]
  );
  return r.rowCount ? r.rows[0].role : null;
}

function safeParseJSON(v, fallback=null){
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  if (typeof v === 'string'){
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return fallback;
}

function sanitizeScalarString(s){
  if (s == null) return null;
  s = String(s).replace(/\r?\n/g, '').trim();
  // retire guillemets englobants éventuels
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // nettoie quelques parasites de fin courants
  s = s.replace(/[\s"'}]+$/g, '').trim();
  return s;
}

// Accepte : null | string | array | array de strings (JSON double encodé géré)
function normalizeAttachments(raw){
  if (raw == null) return null;

  // 1) si string => essaie de "dé-doubler" le JSON jusqu'à 2 fois
  let val = raw;
  if (typeof val === 'string'){
    let s = val.trim();
    // cas: un JSON ré-encodé dans une string (avec quotes échappées)
    for (let i=0; i<2; i++){
      try {
        const tmp = JSON.parse(s);
        if (typeof tmp === 'string') { s = tmp; continue; }
        val = tmp; break;
      } catch {
        // tentative de "déquotage" simple si la string débute/termine par des quotes
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
          s = s.slice(1, -1);
          s = s.replace(/\\"/g, '"'); // unescape rudimentaire
          continue;
        }
        // dernière chance : si ça ressemble à un tableau encapsulé
        if (s.startsWith('[') && s.endsWith(']')) {
          try { val = JSON.parse(s); } catch { /* ignore */ }
        }
        break;
      }
    }
  }

  // 2) si à ce stade ce n'est pas un array -> cas simples
  if (!Array.isArray(val)){
    // une URL/data seule
    if (typeof val === 'string' && /^(data:|https?:)/i.test(val)) {
      const sv = sanitizeScalarString(val);
      return sv ? [{ name: 'piece_1', mime: '', ...(sv.startsWith('data:')?{data:sv}:{url:sv}) }] : null;
    }
    // objet unique
    if (val && typeof val === 'object') {
      const one = normalizeAttachments([val]);
      return one && one.length ? one : null;
    }
    return null;
  }

  // 3) array -> normalisation élément par élément
  const out = [];
  for (let i=0;i<val.length;i++){
    let it = val[i];

    // élément string ?
    if (typeof it === 'string'){
      const t = it.trim();
      if (/^\{/.test(t)){
        try { it = JSON.parse(t); } catch { it = null; }
      } else if (/^(data:|https?:)/i.test(t)) {
        const sv = sanitizeScalarString(t);
        it = sv ? { name: `piece_${i+1}`, mime: '', ...(sv.startsWith('data:')?{data:sv}:{url:sv}) } : null;
      } else {
        it = null;
      }
    }

    if (!it || typeof it !== 'object') continue;

    // extraction safe
    let name = it.name != null ? String(it.name) : `piece_${i+1}`;
    let mime = it.mime != null ? String(it.mime) : '';
    let url  = it.url  != null ? String(it.url)  : null;
    let data = it.data != null ? String(it.data) : null;

    name = name.trim();
    mime = mime.trim();
    url  = sanitizeScalarString(url);
    data = sanitizeScalarString(data);

    // seulement si au moins URL http(s) ou data: valide
    if (url && !/^https?:\/\//i.test(url) && !/^data:/i.test(url)) url = null;
    if (data && !/^data:/i.test(data)) data = null;
    if (!url && !data) continue;

    const clean = { name, mime };
    if (url)  clean.url  = url;
    if (data) clean.data = data;
    out.push(clean);
  }
  return out.length ? out : null;
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
function coerceSmallintOrNull(v){
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// -------------------- SECTEURS --------------------
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

    await pool.query(
      `INSERT INTO public.atex_secteurs (account_id, name)
       VALUES ($1,$2)
       ON CONFLICT (account_id, name) DO NOTHING`,
      [accountId, name]
    );
    console.log('[POST /atex-secteurs] inserted', { accountId, name });
    return res.status(201).json({ ok:true, name });
  }catch(e){
    console.error('[POST /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- LISTE --------------------
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

// -------------------- CRUD --------------------
router.post('/atex-equipments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const b = req.body || {};

    // coercitions
    b.zone_poussieres = coerceSmallintOrNull(b.zone_poussieres);
    const iaObj = safeParseJSON(b.ia_history, null);
    const attArr = normalizeAttachments(b.attachments);

    const derived = deriveConfAndRisk(b);
    if (b.risque == null) b.risque = derived.risque;
    if (!b.conformite) b.conformite = derived.conformite;

    // champs "simples" (hors JSONB)
    const simple = {
      risque: b.risque ?? null,
      secteur: b.secteur ?? null,
      batiment: b.batiment ?? null,
      local: b.local ?? null,
      composant: b.composant ?? null,
      fournisseur: b.fournisseur ?? null,
      type: b.type ?? null,
      identifiant: b.identifiant ?? null,
      interieur: b.interieur ?? null,
      exterieur: b.exterieur ?? null,
      categorie_minimum: b.categorie_minimum ?? null,
      marquage_atex: b.marquage_atex ?? null,
      photo: b.photo ?? null,
      conformite: b.conformite ?? null,
      comments: b.comments ?? null,
      last_inspection_date: b.last_inspection_date ?? null,
      risk_assessment: b.risk_assessment ?? null,
      grade: b.grade ?? 'V',
      frequence: b.frequence ?? 3,
      zone_type: b.zone_type ?? null,
      zone_gaz: b.zone_gaz ?? null,
      zone_poussiere: b.zone_poussiere ?? null,
      zone_poussieres: b.zone_poussieres ?? null
    };

    const simpleKeys = Object.keys(simple);
    const simpleVals = simpleKeys.map(k => simple[k]);

    const iaJSON  = iaObj  ? JSON.stringify(iaObj)  : null;
    const attJSON = attArr ? JSON.stringify(attArr) : null;

    console.log('[POST /atex-equipments] inserting', {
      accountId, by: uid, has_att: attArr ? attArr.length : 0
    });

    const sql = `
      INSERT INTO public.atex_equipments (
        ${simpleKeys.join(', ')},
        ia_history, attachments, account_id, created_by
      ) VALUES (
        ${simpleKeys.map((_,i)=>'$'+(i+1)).join(', ')},
        $${simpleKeys.length+1}::jsonb,
        $${simpleKeys.length+2}::jsonb,
        $${simpleKeys.length+3},
        $${simpleKeys.length+4}
      ) RETURNING id
    `;

    const params = [
      ...simpleVals,
      iaJSON,
      attJSON,
      accountId,
      uid
    ];

    const q = await pool.query(sql, params);
    return res.status(201).json({ id: q.rows[0].id });
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
    console.log('[GET /equip/:id] ok', { id, accountId });
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

    // coercitions
    b.zone_poussieres = coerceSmallintOrNull(b.zone_poussieres);
    const iaObj = safeParseJSON(b.ia_history, null);
    const attArr = normalizeAttachments(b.attachments);

    const derived = deriveConfAndRisk(b);
    if (b.risque == null) b.risque = derived.risque;
    if (!b.conformite) b.conformite = derived.conformite;

    // "simples" (hors JSONB)
    const simple = {
      risque: b.risque ?? null,
      secteur: b.secteur ?? null,
      batiment: b.batiment ?? null,
      local: b.local ?? null,
      composant: b.composant ?? null,
      fournisseur: b.fournisseur ?? null,
      type: b.type ?? null,
      identifiant: b.identifiant ?? null,
      interieur: b.interieur ?? null,
      exterieur: b.exterieur ?? null,
      categorie_minimum: b.categorie_minimum ?? null,
      marquage_atex: b.marquage_atex ?? null,
      photo: b.photo ?? null,
      conformite: b.conformite ?? null,
      comments: b.comments ?? null,
      last_inspection_date: b.last_inspection_date ?? null,
      risk_assessment: b.risk_assessment ?? null,
      grade: b.grade ?? 'V',
      frequence: b.frequence ?? 3,
      zone_type: b.zone_type ?? null,
      zone_gaz: b.zone_gaz ?? null,
      zone_poussiere: b.zone_poussiere ?? null,
      zone_poussieres: b.zone_poussieres ?? null
    };
    const simpleKeys = Object.keys(simple);
    const simpleVals = simpleKeys.map(k => simple[k]);

    const iaJSON  = iaObj  ? JSON.stringify(iaObj)  : null;
    const attJSON = attArr ? JSON.stringify(attArr) : null;

    console.log('[PUT /atex-equipments/:id] updating', {
      id, accountId, has_att: attArr ? attArr.length : (Array.isArray(b.attachments)? b.attachments.length : 0)
    });

    // SET pour les champs simples
    const setSimple = simpleKeys.map((k,i)=> `${k}=$${i+1}`);

    // JSONB upsert safe (si null => on garde la valeur existante)
    const idxIa  = simpleKeys.length + 1;
    const idxAtt = simpleKeys.length + 2;
    const idxId  = simpleKeys.length + 3;
    const idxAcc = simpleKeys.length + 4;

    const sql = `
      UPDATE public.atex_equipments
         SET ${setSimple.join(', ')},
             ia_history = COALESCE($${idxIa}::jsonb, ia_history),
             attachments = COALESCE($${idxAtt}::jsonb, attachments)
       WHERE id=$${idxId} AND account_id=$${idxAcc}
       RETURNING id
    `;

    const params = [
      ...simpleVals,
      iaJSON,
      attJSON,
      id,
      accountId
    ];

    const q = await pool.query(sql, params);
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    return res.json({ id: q.rows[0].id, ok: true });
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

// -------------------- INSPECTION --------------------
router.post('/atex-inspect', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const { equipment_id, inspection_date } = req.body || {};
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipment_id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const nowISO = inspection_date || new Date().toISOString();
    await pool.query(
      `UPDATE public.atex_equipments
          SET last_inspection_date=$1
        WHERE id=$2 AND account_id=$3`,
      [nowISO, equipment_id, accountId]
    );
    res.json({ ok: true, last_inspection_date: nowISO });
  } catch (e) {
    console.error('[POST /atex-inspect] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- IA --------------------
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

    return res.json({ response: html, enrich: { why: derived.conformite, palliatives:[], preventives:[], refs:[], costs:[] } });
  } catch (e) { console.error('[GET /atex-help/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

router.post('/atex-chat', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });
    const { question = '', equipment = null, history = [] } = req.body || {};
    let html = '<p>Service IA non configuré.</p>';
    try {
      const { chat } = require('../config/openai');
      if (typeof chat === 'function') html = await chat({ question, equipment, history });
    } catch {}
    res.json({ response: html });
  } catch (e) { console.error('[POST /atex-chat] error', e); res.status(500).json({ error: 'server_error' }); }
});

// -------------------- PHOTO multipart --------------------
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

// -------------------- IMPORT (CSV/XLSX) --------------------
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

    const wanted = new Set([
      'secteur','batiment','local','composant','fournisseur','type','identifiant',
      'marquage_atex','conformite','comments','zone_gaz','zone_poussieres','frequence','last_inspection_date'
    ]);

    let inserted=0, updated=0;
    for (const r of rows){
      const payload = {
        secteur: r.secteur ?? r.Secteur ?? null,
        batiment: r.batiment ?? r['Bâtiment'] ?? r.bat ?? null,
        local: r.local ?? null,
        composant: r.composant ?? r.Composant ?? null,
        fournisseur: r.fournisseur ?? null,
        type: r.type ?? null,
        identifiant: r.identifiant ?? r.ID ?? null,
        marquage_atex: r.marquage_atex ?? r.Marquage ?? null,
        conformite: r.conformite ?? r.Conformite ?? r['Conformité'] ?? null,
        comments: r.comments ?? r.Commentaires ?? null,
        zone_gaz: r.zone_gaz ?? null,
        zone_poussieres: r.zone_poussieres ?? r.zone_poussiere ?? null,
        frequence: r.frequence ? Number(r.frequence) : null,
        last_inspection_date: r.last_inspection_date || null
      };

      const derived = deriveConfAndRisk(payload);
      if (payload.risque == null) payload.risque = derived.risque;
      if (!payload.conformite) payload.conformite = derived.conformite;

      let existing = null;
      if (payload.identifiant){
        const ex = await pool.query(
          `SELECT id FROM public.atex_equipments WHERE account_id=$1 AND identifiant=$2 LIMIT 1`,
          [accountId, String(payload.identifiant)]
        );
        existing = ex.rowCount ? ex.rows[0].id : null;
      }

      if (existing){
        const keys = Object.keys(payload).filter(k => wanted.has(k));
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

module.exports = router;
