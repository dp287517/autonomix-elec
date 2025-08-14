// routes/subscriptions.js — change plan per account (admin+)
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

function roleRank(r){ return r==='owner'?3 : r==='admin'?2 : r==='member'?1 : 0; }

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
}

async function getRole(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

router.get('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { appCode } = req.params;
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const role = await getRole(req.user.id, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const s = await pool.query(`
      SELECT id, tier, seats_total, status FROM public.subscriptions
      WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
      ORDER BY tier DESC LIMIT 1`,
      [accountId, appCode]
    );
    if (!s.rowCount) return res.json({ app: appCode, account_id: accountId, role, tier: 0, scope: 'account', status: 'none', seats_total: 1 });
    const row = s.rows[0];
    res.json({ app: appCode, account_id: accountId, role, tier: row.tier, scope: 'account', status: row.status, seats_total: row.seats_total ?? 1 });
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

    const roleRow = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [req.user.id, accountId]);
    const role = roleRow.rowCount ? roleRow.rows[0].role : null;
    if (!role || roleRank(role) < 2) return res.status(403).json({ error: 'forbidden_role' }); // admin+

    let { tier } = req.body || {};
    tier = Number.isFinite(+tier) ? +tier : 0;

    // cancel previous actives
    await pool.query(
      `UPDATE public.subscriptions SET status='canceled', ends_at=NOW()
       WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'`,
      [accountId, appCode]
    );

    // keep seats if any, else start at 1
    const lastSeats = await pool.query(`SELECT MAX(seats_total) AS s FROM public.subscriptions WHERE account_id=$1 AND app_code=$2`, [accountId, appCode]);
    const seats = Math.max(1, +(lastSeats.rows[0]?.s || 0));

    const ins = await pool.query(
      `INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
       VALUES ($1,$2,'account',$3,$4,'active')
       RETURNING id, tier, seats_total`,
      [accountId, appCode, tier, seats]
    );

    res.status(201).json({ ok: true, app: appCode, account_id: accountId, tier: ins.rows[0].tier, scope: 'account', seats_total: ins.rows[0].seats_total });
  } catch (e) {
    console.error('[POST /subscriptions/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
