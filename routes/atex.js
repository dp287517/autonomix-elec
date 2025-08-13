// routes/atex.js — ATEX API (incl. /atex-secteurs)
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const upload = multer();
const router = express.Router();

function getPool(req) {
  if (req.app && req.app.locals && req.app.locals.pool) return req.app.locals.pool;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
}

// ----------------- FILTER SOURCES (distincts) -----------------
router.get('/atex-secteurs', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT secteur
         FROM public.atex_equipments
        WHERE secteur IS NOT NULL AND trim(secteur) <> ''
        ORDER BY 1`
    );
    res.json(rows.map(r => r.secteur));
  } catch (e) {
    console.error('GET /atex-secteurs', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-batiments', async (req, res) => {
  const pool = getPool(req);
  const { secteur } = req.query;
  try {
    const params = [];
    let where = `WHERE batiment IS NOT NULL AND trim(batiment) <> ''`;
    if (secteur) { params.push(secteur); where += ` AND secteur = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT DISTINCT batiment FROM public.atex_equipments ${where} ORDER BY 1`,
      params
    );
    res.json(rows.map(r => r.batiment));
  } catch (e) {
    console.error('GET /atex-batiments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-locaux', async (req, res) => {
  const pool = getPool(req);
  const { secteur, batiment } = req.query;
  try {
    const params = [];
    let where = `WHERE local IS NOT NULL AND trim(local) <> ''`;
    if (secteur) { params.push(secteur); where += ` AND secteur = $${params.length}`; }
    if (batiment) { params.push(batiment); where += ` AND batiment = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT DISTINCT local FROM public.atex_equipments ${where} ORDER BY 1`,
      params
    );
    res.json(rows.map(r => r.local));
  } catch (e) {
    console.error('GET /atex-locaux', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ----------------- LIST & CRUD (abrégé à l'essentiel) -----------------
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

router.get('/atex-equipments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(
      `SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
              identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
              photo, conformite, comments, last_inspection_date, next_inspection_date,
              risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
              zone_poussieres, ia_history, attachments
         FROM public.atex_equipments WHERE id = $1`,
      [req.params.id]
    );
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

router.post('/atex-equipments', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);
    const { rows } = await pool.query(
      `INSERT INTO public.atex_equipments (composant, identifiant, secteur, batiment, local, marquage_atex, conformite, zone_type, zone_gaz, zone_poussiere)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        nullIfEmpty(b.composant),
        nullIfEmpty(b.identifiant),
        nullIfEmpty(b.secteur),
        nullIfEmpty(b.batiment),
        nullIfEmpty(b.local),
        nullIfEmpty(b.marquage_atex),
        nullIfEmpty(b.conformite),
        nullIfEmpty(b.zone_type),
        zg, zd
      ]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    console.error('POST /atex-equipments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/atex-equipments/:id', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);
    const q = await pool.query(
      `UPDATE public.atex_equipments SET
        composant=$2, identifiant=$3, secteur=$4, batiment=$5, local=$6,
        marquage_atex=$7, conformite=$8, zone_type=$9, zone_gaz=$10, zone_poussiere=$11
       WHERE id=$1`,
      [
        req.params.id,
        nullIfEmpty(b.composant),
        nullIfEmpty(b.identifiant),
        nullIfEmpty(b.secteur),
        nullIfEmpty(b.batiment),
        nullIfEmpty(b.local),
        nullIfEmpty(b.marquage_atex),
        nullIfEmpty(b.conformite),
        nullIfEmpty(b.zone_type),
        zg, zd
      ]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// --------------- IA history & Attachments (abrégé) ---------------
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

router.get('/atex-attachments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments, photo FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const att = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const legacy = rows[0].photo ? [{ id: 'legacy-photo', name: 'photo', mime: 'image/jpeg', url: rows[0].photo }] : [];
    res.json(att.length ? att : legacy);
  } catch (e) {
    console.error('GET /atex-attachments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

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

module.exports = router;


// --- Aide IA (explicative) minimale basée sur l'équipement ---
router.get('/atex-help/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(
      `SELECT id, composant, marquage_atex, conformite, zone_type, zone_gaz, zone_poussiere, zone_poussieres
         FROM public.atex_equipments WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const e = rows[0];

    const zg = (e.zone_gaz || e.zone_type || '') + '';
    const zd = (e.zone_poussiere || (e.zone_poussieres != null ? String(e.zone_poussieres) : '')) + '';

    function reqCat(zg, zd){
      const g = (zg||'').match(/^(0|1|2)$/)?.[1];
      const d = (zd||'').match(/^(20|21|22)$/)?.[1];
      if (g === '0' || d === '20') return 'II 1GD';
      if (g === '1' || d === '21') return 'II 2GD';
      return 'II 3GD';
    }
    const cat = reqCat(zg, zd);
    const isNC = (e.conformite || '').toLowerCase().includes('non');

    const help = {
      id: e.id,
      composant: e.composant,
      marquage_atex: e.marquage_atex,
      zone_g: zg || null,
      zone_d: zd || null,
      categorie_requise: cat,
      conformite: e.conformite || null,
      conseils: [
        isNC ? "Non‑conformité signalée : prévoir sécurisation provisoire et plan d’action." : "Aucune non‑conformité déclarée.",
        `Catégorie minimale estimée : ${cat}.`,
        "Vérifier marquage ATEX (groupe II, catégorie G/D, mode de protection Ex, classe de température).",
        "Documenter la décision et mettre à jour la plaque locale."
      ],
      suggestions_achat: [
        { label: "R.STAHL — Coffrets Ex e / Ex d", href: "https://r-stahl.com/" },
        { label: "IFM — Capteurs ATEX", href: "https://www.ifm.com/" },
        { label: "RS UK — Recherche références ATEX", href: "https://uk.rs-online.com/" }
      ]
    };
    res.json(help);
  } catch (e) {
    console.error('GET /atex-help/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});
