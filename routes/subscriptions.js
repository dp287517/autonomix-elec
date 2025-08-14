// routes/subscriptions.js
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middlewares/authz');

// assure tables minimalistes si besoin
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.subscriptions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT,
      account_id BIGINT,
      app_code TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('user','account')),
      tier INT NOT NULL DEFAULT 0,
      seats_total INT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.license_assignments (
      subscription_id BIGINT NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (subscription_id, user_id)
    );
  `);
}

// Retourne l’abonnement account seatless (le plus simple pour ATEX)
router.get('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    const acc = await pool.query(
      `SELECT id, tier, seats_total, status, ends_at
       FROM public.subscriptions
       WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
         AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY tier DESC LIMIT 1`,
      [req.account_id, appCode]
    );
    if (!acc.rowCount) return res.json({ app: appCode, tier: 0, scope: 'account', status: 'none' });
    const s = acc.rows[0];
    res.json({ app: appCode, tier: s.tier, scope: 'account', status: s.status, seats_total: s.seats_total });
  } catch (e) {
    console.error('[GET /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Met à jour le plan (owner/admin)
router.post('/subscriptions/:appCode', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    let { tier } = req.body || {};
    tier = Number.isFinite(+tier) ? +tier : 0;   // 0=free,1=personal,2=pro

    // on “désactive” l’existant (soft-switch), puis on crée la sub seatless
    await pool.query(
      `UPDATE public.subscriptions
       SET status='canceled', ends_at=NOW()
       WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'`,
      [req.account_id, appCode]
    );

    const ins = await pool.query(
      `INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
       VALUES ($1,$2,'account',$3,NULL,'active')
       RETURNING id, tier`,
      [req.account_id, appCode, tier]
    );

    res.status(201).json({ ok: true, app: appCode, tier: ins.rows[0].tier, scope: 'account' });
  } catch (e) {
    console.error('[POST /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
