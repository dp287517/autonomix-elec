// routes/atex.js — full endpoints (equipments, secteurs, help/chat, photo)
const express = require('express');
const router = express.Router();
console.log('[ATEX ROUTES] v7 loaded');
const multer = require('multer');
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

let ai = null;
try { ai = require('../config/openai'); } catch(_) { ai = null; }

async function roleOnAccount(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

// ===== LIST =====
router.get('/atex-equipments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT * FROM public.atex_equipments WHERE account_id = $1 ORDER BY id DESC`,
      [accountId]
    );
    res.json(q.rows || []);
  } catch (e) { console.error('[GET /atex-equipments] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== ONE =====
router.get('/atex-equipments/:id', requireAuth, async (req, res) => {
  try {
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
    res.json(q.rows[0]);
  } catch (e) { console.error('[GET /atex-equipments/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== CREATE =====
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
      'photo','conformite','comments','last_inspection_date','next_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const values = fields.map(k => b[k] ?? null);

    const q = await pool.query(
      `INSERT INTO public.atex_equipments (${fields.join(', ')}, account_id, created_by)
       VALUES (${fields.map((_,i)=>'$'+(i+1)).join(', ')}, $${fields.length+1}, $${fields.length+2})
       RETURNING id`,
      [...values, accountId, uid]
    );
    res.status(201).json({ id: q.rows[0].id });
  } catch (e) { console.error('[POST /atex-equipments] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== UPDATE =====
router.put('/atex-equipments/:id', requireAuth, async (req, res) => {
  try {
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
      'photo','conformite','comments','last_inspection_date','next_inspection_date',
      'risk_assessment','grade','frequence','zone_type','zone_gaz','zone_poussiere',
      'zone_poussieres','ia_history','attachments'
    ];
    const sets = fields.map((k,i)=> `${k}=$${i+1}`);
    const values = fields.map(k => b[k] ?? null);

    const q = await pool.query(
      `UPDATE public.atex_equipments SET ${sets.join(', ')}
       WHERE id=$${fields.length+1} AND account_id=$${fields.length+2}`,
      [...values, id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id });
  } catch (e) { console.error('[PUT /atex-equipments/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== DELETE =====
router.delete('/atex-equipments/:id', requireAuth, async (req, res) => {
  try {
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
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    res.status(204).send();
  } catch (e) { console.error('[DELETE /atex-equipments/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== SECTEURS =====
router.get('/atex-secteurs', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT DISTINCT secteur AS name
       FROM public.atex_equipments
       WHERE account_id = $1 AND secteur IS NOT NULL AND secteur <> ''
       ORDER BY name ASC`,
      [accountId]
    );
    res.json(q.rows || []);
  } catch (e) { console.error('[GET /atex-secteurs] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== PHOTO (multipart -> base64 en base) =====
router.post('/atex-photo/:id', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const mime = req.file.mimetype || 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    await pool.query(`UPDATE public.atex_equipments SET photo=$1 WHERE id=$2 AND account_id=$3`, [dataUrl, id, accountId]);

    res.json({ ok: true });
  } catch (e) { console.error('[POST /atex-photo/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== IA one-shot =====
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

    if (!ai || !ai.oneShot) return res.json({ response: `<h3>Analyse ATEX</h3><p>Service IA non configuré.</p>` });

    const text = await ai.oneShot(eq);
    res.json({ response: text });
  } catch (e) { console.error('[GET /atex-help/:id] error', e); res.status(500).json({ error: 'server_error' }); }
});

// ===== IA chat =====
router.post('/atex-chat', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const { question, equipment, history = [] } = req.body || {};
    if (!ai || !ai.chat) return res.json({ response: `<p>Service IA non configuré.</p>` });

    const answer = await ai.chat({ question: question || '', equipment: equipment || null, history });
    res.json({ response: answer });
  } catch (e) { console.error('[POST /atex-chat] error', e); res.status(500).json({ error: 'server_error' }); }
});

module.exports = router;
