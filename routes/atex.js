// routes/atex.js — v7 (ATEX-Control stable: secteurs + attachments + inspect fix)
const express = require('express');
const router = express.Router();
console.log('[ATEX ROUTES] v7 loaded');
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

/** membership sur l’espace */
async function roleOnAccount(userId, accountId){
  const r = await pool.query(
    `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
    [userId, accountId]
  );
  return r.rowCount ? r.rows[0].role : null;
}

/* ======================= LISTE / SECTEURS ======================= */

// GET équipements filtrés par espace
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
       WHERE account_id = $1
       ORDER BY id DESC`,
      [accountId]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error('[GET /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET secteurs : union (table atex_secteurs) + distinct depuis équipements
router.get('/atex-secteurs', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT name FROM public.atex_secteurs WHERE account_id=$1
       UNION
       SELECT DISTINCT secteur AS name
         FROM public.atex_equipments
        WHERE account_id=$1 AND secteur IS NOT NULL AND secteur<>''
       ORDER BY name ASC`,
      [accountId]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error('[GET /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST secteur (fix 404)
router.post('/atex-secteurs', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const name = (req.body?.name || '').trim();
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !name) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    await pool.query(
      `INSERT INTO public.atex_secteurs(account_id, name, created_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (account_id, name) DO NOTHING`,
      [accountId, name, uid]
    );
    return res.json({ ok: true, name });
  }catch(e){
    console.error('[POST /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ======================= CRUD ÉQUIPEMENT ======================= */

router.post('/atex-equipments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const b = req.body || {};
    const fields = [
      'risque','secteur','batiment','local','composant','fournisseur','type',
      'identifiant','interieur','exterieur','categorie_minimum','marquage_atex',
      'photo','conformite','comments','last_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const values = fields.map(k => b[k] ?? null);

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
    const fields = [
      'risque','secteur','batiment','local','composant','fournisseur','type',
      'identifiant','interieur','exterieur','categorie_minimum','marquage_atex',
      'photo','conformite','comments','last_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const sets = fields.map((k,i)=> `${k}=$${i+1}`);
    const vals = fields.map(k => b[k] ?? null);

    const q = await pool.query(
      `UPDATE public.atex_equipments
         SET ${sets.join(', ')}
       WHERE id=$${fields.length+1} AND account_id=$${fields.length+2}
       RETURNING id`,
      [...vals, id, accountId]
    );
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

/* ======================= INSPECTION ======================= */

router.post('/atex-inspect', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const { equipment_id, inspection_date } = req.body || {};
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipment_id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const cur = await pool.query(
      `SELECT frequence FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [equipment_id, accountId]
    );
    if (!cur.rowCount) return res.status(404).json({ error: 'not_found' });

    const nowISO = inspection_date || new Date().toISOString();
    await pool.query(
      `UPDATE public.atex_equipments
         SET last_inspection_date=$1
       WHERE id=$2 AND account_id=$3`,
      [nowISO, equipment_id, accountId]
    );
    res.json({ ok: true, last_inspection_date: nowISO }); // next_* = trigger DB
  } catch (e) {
    console.error('[POST /atex-inspect] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ======================= IA (help + chat) ======================= */
// (laisse tel quel; on branchera openai.js après validation UI)
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

    let html = '<h3>Analyse ATEX</h3><p>Service IA non configuré.</p>';
    try {
      const { oneShot } = require('../config/openai');
      if (typeof oneShot === 'function') html = await oneShot(q.rows[0]);
    } catch {}
    res.json({ response: html });
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

/* ======================= PHOTO & FICHIERS (attachments) ======================= */

let multer;
try { multer = require('multer'); } catch { /* optional */ }
const upload = multer ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }) : null;

// Photo (multipart) -> dataURL dans `photo`
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

// Upload de pièces jointes (plusieurs fichiers) -> stockés dans `attachments` (JSON)
router.post('/atex-attachments/:id', requireAuth, upload ? upload.array('files', 8) : (_req,_res,next)=>next(), async (req, res) => {
  try{
    if (!upload) return res.status(501).json({ error: 'multer_unavailable' });
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'no_files' });

    const cur = await pool.query(
      `SELECT attachments FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!cur.rowCount) return res.status(404).json({ error: 'not_found' });
    const list = Array.isArray(cur.rows[0].attachments) ? cur.rows[0].attachments : [];

    for (const f of files){
      const mime = f.mimetype || 'application/octet-stream';
      const base64 = f.buffer.toString('base64');
      const dataURL = `data:${mime};base64,${base64}`;
      list.push({
        filename: f.originalname,
        mime,
        size: f.size,
        dataURL,
        uploaded_at: new Date().toISOString()
      });
    }

    await pool.query(
      `UPDATE public.atex_equipments SET attachments=$1 WHERE id=$2 AND account_id=$3`,
      [JSON.stringify(list), id, accountId]
    );

    res.json({ ok: true, count: list.length });
  }catch(e){
    console.error('[POST /atex-attachments/:id] error', e);
    if (String(e.message||'').match(/File too large/i)) return res.status(413).json({ error: 'file_too_large' });
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-attachments/:id', requireAuth, async (req, res) => {
  try{
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT attachments FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ attachments: Array.isArray(q.rows[0].attachments) ? q.rows[0].attachments : [] });
  }catch(e){
    console.error('[GET /atex-attachments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
