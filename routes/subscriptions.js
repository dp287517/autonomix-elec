// routes/subscriptions.js
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/authz');

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.subscriptions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT,
      account_id BIGINT,
      app_code TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('user','account')),
      tier INT NOT NULL DEFAULT 0,
      seats_total INT, -- seatful si NOT NULL
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

async function getOrCreateAccountSub({ accountId, appCode, defaultTier = 0 }) {
  await ensureTables();
  const q = await pool.query(`
    SELECT id, tier, seats_total, status
    FROM public.subscriptions
    WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
    ORDER BY tier DESC LIMIT 1
  `, [accountId, appCode]);

  if (q.rowCount) return q.rows[0];

  const ins = await pool.query(`
    INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
    VALUES ($1,$2,'account',$3,1,'active')
    RETURNING id, tier, seats_total, status
  `, [accountId, appCode, defaultTier]);
  return ins.rows[0];
}

// GET plan courant (seatful)
router.get('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    const { appCode } = req.params;
    const s = await getOrCreateAccountSub({ accountId: req.account_id, appCode, defaultTier: 0 });
    res.json({ app: appCode, tier: s.tier, scope: 'account', status: s.status, seats_total: s.seats_total ?? 1 });
  } catch (e) {
    console.error('[GET /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST changer de plan (owner/admin) — garde seats_total >= 1
router.post('/subscriptions/:appCode', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    let { tier } = req.body || {};
    tier = Number.isFinite(+tier) ? +tier : 0;

    await pool.query(
      `UPDATE public.subscriptions
       SET status='canceled', ends_at=NOW()
       WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'`,
      [req.account_id, appCode]
    );

    const ins = await pool.query(
      `INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
       VALUES ($1,$2,'account',$3, GREATEST(1, (
         SELECT COALESCE(MAX(seats_total), 0) FROM public.subscriptions WHERE account_id=$1 AND app_code=$2
       )), 'active')
       RETURNING id, tier, seats_total`,
      [req.account_id, appCode, tier]
    );

    res.status(201).json({ ok: true, app: appCode, tier: ins.rows[0].tier, scope: 'account', seats_total: ins.rows[0].seats_total });
  } catch (e) {
    console.error('[POST /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
