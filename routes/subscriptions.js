
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

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

async function getRole(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

async function getOwners(accountId){
  const r = await pool.query(`
    SELECT u.email, COALESCE(u.name,'') AS name
    FROM public.user_accounts ua
    JOIN public.users u ON u.id = ua.user_id
    WHERE ua.account_id=$1 AND ua.role='owner'
    ORDER BY u.email ASC
  `, [accountId]);
  return r.rows;
}

router.get('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const role = await getRole(req.user.id, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const owners = await getOwners(accountId);

    const s = await pool.query(`
      SELECT id, tier, seats_total, status FROM public.subscriptions
      WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
      ORDER BY tier DESC LIMIT 1`,
      [accountId, appCode]
    );
    if (!s.rowCount) return res.json({ app: appCode, account_id: accountId, role, tier: 0, scope: 'account', status: 'none', seats_total: 1, owners });
    const row = s.rows[0];
    res.json({ app: appCode, account_id: accountId, role, tier: row.tier, scope: 'account', status: row.status, seats_total: row.seats_total ?? 1, owners });
  } catch (e) {
    console.error('[GET /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const role = await getRole(req.user.id, accountId);
    if (role !== 'owner') return res.status(403).json({ error: 'owner_only' });

    let { tier } = req.body || {};
    tier = Number.isFinite(+tier) ? +tier : 0;

    await pool.query(
      `UPDATE public.subscriptions SET status='canceled', ends_at=NOW()
       WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'`,
      [accountId, appCode]
    );

    const lastSeats = await pool.query(`SELECT MAX(seats_total) AS s FROM public.subscriptions WHERE account_id=$1 AND app_code=$2`, [accountId, appCode]);
    const seats = Math.max(1, +(lastSeats.rows[0]?.s || 0));

    const ins = await pool.query(
      `INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
       VALUES ($1,$2,'account',$3,$4,'active')
       RETURNING id, tier, seats_total`,
      [accountId, appCode, tier, seats]
    );

    const subId = ins.rows[0].id;
    if (ins.rows[0].seats_total !== null) {
      await pool.query(`
        INSERT INTO public.license_assignments(subscription_id, user_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING
      `, [subId, req.user.id]);
    }

    res.status(201).json({ ok: true, app: appCode, account_id: accountId, tier: ins.rows[0].tier, scope: 'account', seats_total: ins.rows[0].seats_total });
  } catch (e) {
    console.error('[POST /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
