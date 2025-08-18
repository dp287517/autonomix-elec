// routes/atex.js — v5 (scopage strict par account_id)
const express = require('express');
const router = express.Router();
console.log('[ATEX ROUTES] v6 loaded');
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

async function roleOnAccount(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

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

// GET secteurs distincts filtrés par espace
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
    return res.json(q.rows || []);
  } catch (e) {
    console.error('[GET /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST création équipement (force le scope et l'auteur)
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

module.exports = router;


// ----- INSPECT (pose la dernière inspection et calcule la prochaine) -----
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
    const freq = Number(cur.rows[0].frequence || 36);
    const next = new Date(nowISO);
    next.setMonth(next.getMonth() + (isNaN(freq) ? 36 : freq));
    const nextISO = next.toISOString();

    await pool.query(
      `UPDATE public.atex_equipments
         SET last_inspection_date=$1, next_inspection_date=$2
       WHERE id=$3 AND account_id=$4`,
      [nowISO, nextISO, equipment_id, accountId]
    );
    res.json({ ok: true, last_inspection_date: nowISO, next_inspection_date: nextISO });
  } catch (e) {
    console.error('[POST /atex-inspect] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});
// Minimal IA one-shot (returns HTML or fallback)
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
