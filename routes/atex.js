// routes/atex.js — routes ATEX complètes et robustes
// - Normalisation zones (G: 0/1/2, D: 20/21/22) + '' -> NULL
// - Historique IA (ia_history JSONB) : lecture / append
// - Pièces jointes multiples (attachments JSONB) : GET / POST / DELETE (data: URL)
// - Photo héritée (photo TEXT) : endpoint de compat
// - N'écrit JAMAIS dans zone_poussieres (SMALLINT); écrit dans zone_poussiere (TEXT)

const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const upload = multer();
const router = express.Router();

// Pool: on réutilise si fourni globalement via app.locals.pool, sinon on crée un pool local.
function getPool(req) {
  if (req.app && req.app.locals && req.app.locals.pool) return req.app.locals.pool;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
}

// -------- Helpers --------
const nullIfEmpty = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const normZoneG = (v) => {
  const s = nullIfEmpty(v);
  if (!s) return null;
  const m = String(s).match(/^(0|1|2)$/);
  return m ? m[1] : null;
};
const normZoneD = (v) => {
  const s = nullIfEmpty(v);
  if (!s) return null;
  const m = String(s).match(/^(20|21|22)$/);
  return m ? m[1] : null;
};

// ----------- Equipments -----------

// Liste simple (tu peux ajouter des filtres au besoin)
router.get('/atex-equipments', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(`
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
             identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
             photo, conformite, comments, last_inspection_date, next_inspection_date,
             risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
             zone_poussieres, ia_history, attachments
      FROM public.atex_equipments
      ORDER BY id DESC
    `);
    // Expose "zone_poussieres" aussi depuis zone_poussiere (compat lecture)
    rows.forEach(r => {
      if (r.zone_poussieres == null && r.zone_poussiere && /^\d+$/.test(r.zone_poussiere)) {
        r.zone_poussieres = parseInt(r.zone_poussiere, 10);
      }
    });
    res.json(rows);
  } catch (e) {
    console.error('GET /atex-equipments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Get by id
router.get('/atex-equipments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(`
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
             identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
             photo, conformite, comments, last_inspection_date, next_inspection_date,
             risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
             zone_poussieres, ia_history, attachments
      FROM public.atex_equipments WHERE id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const r = rows[0];
    if (r.zone_poussieres == null && r.zone_poussiere && /^\d+$/.test(r.zone_poussiere)) {
      r.zone_poussieres = parseInt(r.zone_poussiere, 10);
    }
    res.json(r);
  } catch (e) {
    console.error('GET /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create
router.post('/atex-equipments', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);
    const ident = nullIfEmpty(b.identifiant);
    const composant = nullIfEmpty(b.composant);
    const marquage = nullIfEmpty(b.marquage_atex);
    const secteur = nullIfEmpty(b.secteur);
    const batiment = nullIfEmpty(b.batiment);
    const local = nullIfEmpty(b.local);
    const fournisseur = nullIfEmpty(b.fournisseur);
    const type = nullIfEmpty(b.type);
    const categorie = nullIfEmpty(b.categorie_minimum);
    const conformite = nullIfEmpty(b.conformite);
    const comments = nullIfEmpty(b.comments);

    const { rows } = await pool.query(
      `INSERT INTO public.atex_equipments
       (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite,
        comments, last_inspection_date, next_inspection_date, risk_assessment, grade,
        frequence, zone_type, zone_gaz, zone_poussiere, ia_history, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NULL, NULL, $9, $10, NULL, $11, $12, NULL, NULL, NULL, 'V',
               COALESCE($13, 3), $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        nullIfEmpty(b.risque),
        secteur, batiment, local, composant, fournisseur, type, ident,
        categorie, marquage, conformite, comments,
        b.frequence ? parseInt(b.frequence, 10) : null,
        nullIfEmpty(b.zone_type), zg, zd,
        null, // ia_history
        null  // attachments
      ]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    console.error('POST /atex-equipments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Update
router.put('/atex-equipments/:id', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);

    const result = await pool.query(
      `UPDATE public.atex_equipments SET
        risque=$2, secteur=$3, batiment=$4, local=$5, composant=$6, fournisseur=$7, type=$8,
        identifiant=$9, categorie_minimum=$10, marquage_atex=$11, conformite=$12, comments=$13,
        grade=COALESCE($14,'V'), frequence=COALESCE($15,3), zone_type=$16, zone_gaz=$17, zone_poussiere=$18
       WHERE id = $1`,
      [
        req.params.id,
        nullIfEmpty(b.risque),
        nullIfEmpty(b.secteur),
        nullIfEmpty(b.batiment),
        nullIfEmpty(b.local),
        nullIfEmpty(b.composant),
        nullIfEmpty(b.fournisseur),
        nullIfEmpty(b.type),
        nullIfEmpty(b.identifiant),
        nullIfEmpty(b.categorie_minimum),
        nullIfEmpty(b.marquage_atex),
        nullIfEmpty(b.conformite),
        nullIfEmpty(b.comments),
        nullIfEmpty(b.grade),
        b.frequence ? parseInt(b.frequence, 10) : null,
        nullIfEmpty(b.zone_type),
        zg, zd
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// (Optionnel) Delete
router.delete('/atex-equipments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rowCount } = await pool.query('DELETE FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----------- Historique IA -----------

// GET: récupère le fil (table -> ia_history JSONB)
router.get('/atex-ia-history/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT ia_history FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(Array.isArray(rows[0].ia_history) ? rows[0].ia_history : []);
  } catch (e) {
    console.error('GET /atex-ia-history/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// PATCH: append un message au fil IA
router.patch('/atex-ia-history/:id', express.json(), async (req, res) => {
  const pool = getPool(req);
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'missing_message' });
    const item = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      ...message
    };
    await pool.query(
      `UPDATE public.atex_equipments
         SET ia_history = COALESCE(ia_history, '[]'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [req.params.id, JSON.stringify([item])]
    );
    res.json({ ok: true, appended: item });
  } catch (e) {
    console.error('PATCH /atex-ia-history/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----------- Pièces jointes (multi-fichiers) -----------

// Liste des PJ (ou photo héritée si pas de PJ)
router.get('/atex-attachments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(
      'SELECT attachments, photo FROM public.atex_equipments WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const att = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const legacy = rows[0].photo ? [{ id: 'legacy-photo', name: 'photo', mime: 'image/jpeg', url: rows[0].photo }] : [];
    res.json(att.length ? att : legacy);
  } catch (e) {
    console.error('GET /atex-attachments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Ajout multi-fichiers (champ "files")
router.post('/atex-attachments/:id', upload.any(), async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const files = Array.isArray(req.files) ? req.files : [];
    const toAdd = files.map(f => ({
      id: uuidv4(),
      name: f.originalname || 'fichier',
      mime: f.mimetype || 'application/octet-stream',
      url: `data:${f.mimetype||'application/octet-stream'};base64,${f.buffer.toString('base64')}`
    }));
    const final = current.concat(toAdd);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(final)]);
    res.json({ ok: true, added: toAdd.length });
  } catch (e) {
    console.error('POST /atex-attachments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Supprimer une PJ
router.delete('/atex-attachments/:id/:attId', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const next = current.filter(x => x && x.id !== req.params.attId);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(next)]);
    res.json({ ok: true, removed: current.length - next.length });
  } catch (e) {
    console.error('DELETE /atex-attachments/:id/:attId', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----------- Photo héritée (compat) -----------
router.post('/atex-photo/:id', upload.any(), async (req, res) => {
  const pool = getPool(req);
  try {
    let dataUrl = null;
    if (Array.isArray(req.files) && req.files.length) {
      // accepte 'file' ou 'photo'
      const f = req.files.find(f => f.fieldname === 'file' || f.fieldname === 'photo') || req.files[0];
      const mime = f.mimetype || 'image/jpeg';
      dataUrl = `data:${mime};base64,` + f.buffer.toString('base64');
    } else if (req.body && req.body.photo) {
      dataUrl = req.body.photo;
    }
    if (!dataUrl) return res.status(400).json({ error: 'missing_file' });
    await pool.query('UPDATE public.atex_equipments SET photo = $2 WHERE id = $1', [req.params.id, dataUrl]);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /atex-photo/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
