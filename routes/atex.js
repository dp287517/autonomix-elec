// routes/atex.js — ATEX Control (Free) + secteurs robustes + schéma idempotent
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

let { requireLicense } = (() => { try { return require('../middleware/entitlements'); } catch { return {}; } })();
requireLicense = requireLicense || (()=>(_req,_res,next)=>next());

// ATEX Control accessible en Free (tier 0)
router.use(requireAuth, requireLicense('ATEX', 0));

async function hasEquipAccountColumn(){
  const q = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='atex_equipments' AND column_name='account_id'
    LIMIT 1
  `);
  return q.rowCount > 0;
}

async function ensureSecteursSchema(){
  // Crée la table si absente
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_secteurs (
      id SERIAL PRIMARY KEY,
      account_id BIGINT,
      name VARCHAR(120),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Ajoute les colonnes manquantes / contrainte unique si besoin
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='atex_secteurs' AND column_name='account_id'
      ) THEN
        ALTER TABLE public.atex_secteurs ADD COLUMN account_id BIGINT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='atex_secteurs' AND column_name='name'
      ) THEN
        ALTER TABLE public.atex_secteurs ADD COLUMN name VARCHAR(120);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'atex_secteurs_account_name_key'
      ) THEN
        ALTER TABLE public.atex_secteurs
          ADD CONSTRAINT atex_secteurs_account_name_key UNIQUE(account_id, name);
      END IF;
    END
    $$;
  `);
}

/* =========================
 *   EQUIPEMENTS (listing)
 * ========================= */
router.get('/atex-equipments', async (req, res) => {
  try {
    const accountId = req.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_required' });

    const hasCol = await hasEquipAccountColumn();

    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit||'100',10), 500);
    const offset = Math.max(parseInt(req.query.offset||'0',10), 0);

    const params = [accountId];
    const where = [];
    let sql;

    if (hasCol) {
      where.push(`e.account_id = $1`);
      if (q) { params.push(`%${q}%`); where.push(`(e.identifiant ILIKE $${params.length} OR e.composant ILIKE $${params.length})`); }
      params.push(limit, offset);
      sql = `
        SELECT e.*
        FROM public.atex_equipments e
        WHERE ${where.join(' AND ')}
        ORDER BY e.id DESC
        LIMIT $${params.length-1} OFFSET $${params.length};
      `;
    } else {
      where.push(`ua.account_id = $1`);
      if (q) { params.push(`%${q}%`); where.push(`(e.identifiant ILIKE $${params.length} OR e.composant ILIKE $${params.length})`); }
      params.push(limit, offset);
      sql = `
        SELECT e.*
        FROM public.atex_equipments e
        JOIN public.user_accounts ua ON ua.user_id = e.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY e.id DESC
        LIMIT $${params.length-1} OFFSET $${params.length};
      `;
    }

    const r = await pool.query(sql, params);
    res.json(r.rows || []);
  } catch (e) {
    console.error('[GET /atex-equipments] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* =========================
 *       SECTEURS
 * ========================= */
router.get('/atex-secteurs', async (req, res) => {
  try {
    const accountId = req.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_required' });

    await ensureSecteursSchema();

    const hasCol = await hasEquipAccountColumn();

    let fromEquip;
    if (hasCol) {
      fromEquip = await pool.query(
        `SELECT DISTINCT e.secteur AS name
         FROM public.atex_equipments e
         WHERE e.secteur IS NOT NULL AND btrim(e.secteur) <> '' AND e.account_id = $1
         ORDER BY 1 ASC`, [accountId]
      );
    } else {
      fromEquip = await pool.query(
        `SELECT DISTINCT e.secteur AS name
         FROM public.atex_equipments e
         JOIN public.user_accounts ua ON ua.user_id = e.created_by
         WHERE e.secteur IS NOT NULL AND btrim(e.secteur) <> '' AND ua.account_id = $1
         ORDER BY 1 ASC`, [accountId]
      );
    }

    const fromCustom = await pool.query(
      `SELECT name FROM public.atex_secteurs WHERE account_id=$1 ORDER BY 1 ASC`, [accountId]
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
    await ensureSecteursSchema();
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    await pool.query(
      `INSERT INTO public.atex_secteurs(account_id, name)
       VALUES ($1,$2)
       ON CONFLICT (account_id, name) DO NOTHING`,
      [accountId, name]
    );
    res.json({ ok: true, name });
  } catch (e) {
    console.error('[POST /atex-secteurs] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
