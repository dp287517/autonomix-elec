// routes/atex.js — v5 (scopage strict par account_id)
const express = require('express');
const router = express.Router();
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

// ======= ATTACHMENTS (multi-docs/photos) =======
// Table: public.atex_attachments (see MIGRATION)
// GET list
router.get('/atex-attachments', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const equipmentId = Number(req.query.equipment_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipmentId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT id, name, mime, size, url,
              (CASE WHEN char_length(data_base64) > 0 THEN 'inline' ELSE null END) AS data_mode,
              created_at
       FROM public.atex_attachments
       WHERE account_id=$1 AND equipment_id=$2
       ORDER BY id DESC`,
      [accountId, equipmentId]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error('[GET /atex-attachments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST create (multipart)
router.post('/atex-attachments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const equipmentId = Number(req.query.equipment_id || req.body?.equipment_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipmentId) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const name = (req.body?.name || req.file.originalname || 'pièce');
    const mime = req.file.mimetype || 'application/octet-stream';
    const size = req.file.size || 0;

    // store inline base64 (mini evolution) — can be swapped with S3 later
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    const ins = await pool.query(
      `INSERT INTO public.atex_attachments (account_id, equipment_id, name, mime, size, url, data_base64)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [accountId, equipmentId, name, mime, size, null, dataUrl]
    );
    return res.status(201).json({ id: ins.rows[0].id });
  } catch (e) {
    console.error('[POST /atex-attachments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// DELETE one
router.delete('/atex-attachments/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });
    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const del = await pool.query(
      `DELETE FROM public.atex_attachments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'not_found' });
    return res.status(204).send();
  } catch (e) {
    console.error('[DELETE /atex-attachments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

