// routes/atex.js — Étape 3 (sécurisé multi-tenant + licences)
// Remplace l'ancien routes/atex.js si présent.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');
const { requireLicense } = require('../middleware/entitlements');

// Toutes les routes ATEX nécessitent : user connecté + licence ATEX (tier >= 1)
router.use(requireAuth, requireLicense('ATEX', 0));

/**
 * GET /api/atex-equipments
 * Liste paginée des équipements du compte courant (filtrés par account_id).
 * Query params optionnels: q (recherche texte), limit, offset, order
 */
router.get('/atex-equipments', async (req, res) => {
  try {
    const accountId = req.account_id;
    const q = (req.query.q || '').trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10), 500));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    let where = 'WHERE account_id = $1';
    const params = [accountId];

    if (q) {
      where += ` AND (identifiant ILIKE $2 OR composant ILIKE $2 OR fournisseur ILIKE $2 OR secteur ILIKE $2)`;
      params.push(`%${q}%`);
    }

    const order = 'ORDER BY COALESCE(next_inspection_date, DATE \'1970-01-01\') ASC, id ASC';

    const sql = `
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
             interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
             last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
             zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments,
             created_by, account_id
      FROM public.atex_equipments
      ${where}
      ${order}
      LIMIT ${limit} OFFSET ${offset};
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('[GET /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /api/atex-equipments/:id
 * Détail d'un équipement (même compte).
 */
router.get('/atex-equipments/:id', async (req, res) => {
  try {
    const accountId = req.account_id;
    const id = Number(req.params.id);
    const { rows } = await pool.query(`
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
             interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
             last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
             zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments,
             created_by, account_id
      FROM public.atex_equipments
      WHERE id=$1 AND account_id=$2
      LIMIT 1
    `, [id, accountId]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[GET /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/atex-equipments
 * Création d'un équipement pour le compte courant.
 * Body: JSON des champs connus. account_id et created_by sont posés côté serveur.
 */
router.post('/atex-equipments', async (req, res) => {
  try {
    const b = req.body || {};
    const accountId = req.account_id;
    const userId = req.user.id;

    const values = [
      b.risque ?? null,
      b.secteur ?? null,
      b.batiment ?? null,
      b.local ?? null,
      b.composant ?? null,
      b.fournisseur ?? null,
      b.type ?? null,
      b.identifiant ?? null,
      b.interieur ?? null,
      b.exterieur ?? null,
      b.categorie_minimum ?? null,
      b.marquage_atex ?? null,
      b.photo ?? null,
      b.conformite ?? null,
      b.comments ?? null,
      b.last_inspection_date ?? null,
      b.next_inspection_date ?? null,
      b.risk_assessment ?? null,
      b.grade ?? null,
      b.frequence ?? null,
      b.zone_type ?? null,
      b.zone_gaz ?? null,
      b.zone_poussiere ?? null,
      b.zone_poussieres ?? null,
      b.ia_history ?? null,
      b.attachments ?? null,
      accountId,
      userId,
    ];

    const { rows } = await pool.query(`
      INSERT INTO public.atex_equipments
        (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
         interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
         last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
         zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments,
         account_id, created_by)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      RETURNING id;
    `, values);

    res.json({ id: rows[0].id });
  } catch (e) {
    console.error('[POST /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /api/atex-equipments/:id
 * Mise à jour (dans le même compte).
 */
router.put('/atex-equipments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const accountId = req.account_id;
    const b = req.body || {};

    const values = [
      b.risque ?? null,
      b.secteur ?? null,
      b.batiment ?? null,
      b.local ?? null,
      b.composant ?? null,
      b.fournisseur ?? null,
      b.type ?? null,
      b.identifiant ?? null,
      b.interieur ?? null,
      b.exterieur ?? null,
      b.categorie_minimum ?? null,
      b.marquage_atex ?? null,
      b.photo ?? null,
      b.conformite ?? null,
      b.comments ?? null,
      b.last_inspection_date ?? null,
      b.next_inspection_date ?? null,
      b.risk_assessment ?? null,
      b.grade ?? null,
      b.frequence ?? null,
      b.zone_type ?? null,
      b.zone_gaz ?? null,
      b.zone_poussiere ?? null,
      b.zone_poussieres ?? null,
      b.ia_history ?? null,
      b.attachments ?? null,
      id,
      accountId,
    ];

    const r = await pool.query(`
      UPDATE public.atex_equipments SET
        risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7, identifiant=$8,
        interieur=$9, exterieur=$10, categorie_minimum=$11, marquage_atex=$12, photo=$13, conformite=$14, comments=$15,
        last_inspection_date=$16, next_inspection_date=$17, risk_assessment=$18, grade=$19, frequence=$20,
        zone_type=$21, zone_gaz=$22, zone_poussiere=$23, zone_poussieres=$24, ia_history=$25, attachments=$26
      WHERE id=$27 AND account_id=$28
    `, values);

    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * DELETE /api/atex-equipments/:id
 * Suppression (dans le même compte).
 */
router.delete('/atex-equipments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const accountId = req.account_id;
    const r = await pool.query(`DELETE FROM public.atex_equipments WHERE id=$1 AND account_id=$2`, [id, accountId]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /atex-equipments/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});



/**
 * ===== SECTEURS (liste + ajout) =====
 * GET /api/atex-secteurs
 *   -> retourne la liste des secteurs connus de l'espace (distincts des équipements + personnalisés)
 * POST /api/atex-secteurs { name }
 *   -> ajoute un secteur personnalisé (en base) pour l'espace
 */

async function ensureEquipmentsAccountColumn() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='atex_equipments' AND column_name='account_id'
        ) THEN
          ALTER TABLE public.atex_equipments ADD COLUMN account_id BIGINT;
          CREATE INDEX IF NOT EXISTS idx_atex_equip_account ON public.atex_equipments(account_id);
        END IF;
      END
      $$;
    `);
  } catch (e) {
    console.warn('[ensureEquipmentsAccountColumn] warning:', e && e.message ? e.message : e);
  }
}

async function ensureSecteursTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_secteurs (
      id SERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL,
      name VARCHAR(120) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, name)
    );
  `);
}

router.get('/atex-secteurs', async (req, res) => {
  try {
    const accountId = req.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_required' });
    await ensureSecteursTable();
    await ensureEquipmentsAccountColumn();

    let fromEquip;
try {
  fromEquip = await pool.query(
    `SELECT DISTINCT e.secteur AS name
     FROM public.atex_equipments e
     LEFT JOIN public.user_accounts ua ON ua.user_id = e.created_by
     WHERE (e.secteur IS NOT NULL AND btrim(e.secteur) <> '')
       AND (e.account_id = $1 OR (e.account_id IS NULL AND ua.account_id = $1))
     ORDER BY 1 ASC`,
    [accountId]
  );
} catch (err) {
  if (err && err.code === '42703') {
    fromEquip = await pool.query(
      `SELECT DISTINCT e.secteur AS name
       FROM public.atex_equipments e
       LEFT JOIN public.user_accounts ua ON ua.user_id = e.created_by
       WHERE (e.secteur IS NOT NULL AND btrim(e.secteur) <> '')
         AND ua.account_id = $1
       ORDER BY 1 ASC`,
      [accountId]
    );
  } else {
    throw err;
  }
}
    const fromCustom = await pool.query(
      `SELECT name
       FROM public.atex_secteurs
       WHERE account_id=$1
       ORDER BY 1 ASC`,
      [accountId]
    );

    const seen = new Set();
    const out = [];
    for (const r of fromEquip.rows) {
      const n = (r.name || '').trim();
      if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }
    for (const r of fromCustom.rows) {
      const n = (r.name || '').trim();
      if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }
    res.json(out);
  } catch (e) {
    console.error('[GET /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/atex-secteurs', async (req, res) => {
  try {
    const accountId = req.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_required' });
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    await ensureSecteursTable();
    await pool.query(
      `INSERT INTO public.atex_secteurs(account_id, name)
       VALUES ($1,$2) ON CONFLICT (account_id, name) DO NOTHING`,
      [accountId, name]
    );
    res.json({ ok: true, name });
  } catch (e) {
    console.error('[POST /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});


module.exports = router;
