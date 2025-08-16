// routes/atex.js — v6 (complete with item, delete, help, chat, inspect, photo)
// Strict account scoping preserved.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());
const multer = require('multer');
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const { callOpenAI } = require('../config/openai');

async function roleOnAccount(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

// ----- LIST -----
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

// ----- SECTEURS -----
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

// ----- CREATE -----
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

// ----- GET ONE -----
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
      `SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
              identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
              photo, conformite, comments, last_inspection_date, next_inspection_date,
              risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
              zone_poussieres, ia_history, attachments, account_id, created_by
       FROM public.atex_equipments
       WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    return res.json(q.rows[0]);
  } catch (e) {
    console.error('[GET /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----- DELETE ONE -----
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
    return res.status(204).send();
  } catch (e) {
    console.error('[DELETE /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----- INSPECT (set last_inspection_date and recompute next) -----
router.post('/atex-inspect', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    const { equipment_id, status, inspection_date } = req.body || {};
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !equipment_id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    // Update last inspection; next will be computed client-side too
    await pool.query(
      `UPDATE public.atex_equipments
       SET last_inspection_date=$1
       WHERE id=$2 AND account_id=$3`,
      [inspection_date || new Date().toISOString(), equipment_id, accountId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /atex-inspect] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----- PHOTO UPLOAD -----
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

    // Minimal: store as base64 data URL in 'photo' (alternatively, use object storage and store URL)
    const base64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${base64}`;
    await pool.query(
      `UPDATE public.atex_equipments SET photo=$1 WHERE id=$2 AND account_id=$3`,
      [dataUrl, id, accountId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /atex-photo/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----- HELP (single-shot) -----
router.get('/atex-help/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !id) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT id, composant, fournisseur, type, identifiant, marquage_atex,
              zone_gaz, zone_poussiere, zone_poussieres, conformite, comments,
              last_inspection_date, next_inspection_date, risque
       FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
      [id, accountId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    const eq = q.rows[0];

    const prompt = [
      `Contexte: Analyse ATEX d'un équipement.`,
      `Composant: ${eq.composant || '-'}`,
      `Fournisseur: ${eq.fournisseur || '-'}`,
      `Type: ${eq.type || '-'}`,
      `Identifiant: ${eq.identifiant || '-'}`,
      `Marquage ATEX: ${eq.marquage_atex || '-'}`,
      `Zone Gaz: ${eq.zone_gaz || '-'}, Zone Poussières: ${eq.zone_poussieres || eq.zone_poussiere || '-'}`,
      `Conformité: ${eq.conformite || '-'}, Risque: ${eq.risque ?? '-'}`,
      `Dernière inspection: ${eq.last_inspection_date || '-'}, Prochaine: ${eq.next_inspection_date || '-'}`,
      ``,
      `Rends une analyse claire en français. Utilise des titres en **gras** et des listes.`
    ].join('\n');

    const response = await callOpenAI(prompt);
    return res.json({ response });
  } catch (e) {
    console.error('[GET /atex-help/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----- CHAT (follow-up) -----
router.post('/atex-chat', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const { question, equipment, history } = req.body || {};

    let contextLines = [];
    if (equipment) {
      const q = await pool.query(
        `SELECT id, composant, fournisseur, type, identifiant, marquage_atex,
                zone_gaz, zone_poussiere, zone_poussieres, conformite, comments,
                last_inspection_date, next_inspection_date, risque
         FROM public.atex_equipments WHERE id=$1 AND account_id=$2`,
        [Number(equipment), accountId]
      );
      if (q.rowCount) {
        const eq = q.rows[0];
        contextLines = [
          `Composant: ${eq.composant || '-'}`,
          `Fournisseur: ${eq.fournisseur || '-'}`,
          `Type: ${eq.type || '-'}`,
          `Identifiant: ${eq.identifiant || '-'}`,
          `Marquage ATEX: ${eq.marquage_atex || '-'}`,
          `Zone Gaz: ${eq.zone_gaz || '-'}, Zone Poussières: ${eq.zone_poussieres || eq.zone_poussiere || '-'}`,
          `Conformité: ${eq.conformite || '-'}, Risque: ${eq.risque ?? '-'}`,
          `Dernière inspection: ${eq.last_inspection_date || '-'}, Prochaine: ${eq.next_inspection_date || '-'}`,
        ];
      }
    }

    const historyMsgs = Array.isArray(history) ? history.slice(-20).map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user'),
      content: String(m.content || '')
    })) : [];

    const msgs = [
      { role: 'system', content: 'Tu es un assistant ATEX. Réponds en français, avec titres en gras et listes lisibles.' }
    ];
    if (contextLines.length) {
      msgs.push({ role: 'system', content: 'Contexte équipement:\n' + contextLines.join('\n') });
    }
    msgs.push(...historyMsgs);
    msgs.push({ role: 'user', content: String(question || '') });

    const prompt = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const response = await callOpenAI(prompt);
    return res.json({ response });
  } catch (e) {
    console.error('[POST /atex-chat] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
