
// routes/accounts_invite.js — invite member, seats grow automatically
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

function roleRank(r){ return r==='owner'?3 : r==='admin'?2 : r==='member'?1 : 0; }

async function ensureTables(){
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

async function ensureCoreTables(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.accounts (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_accounts (
      user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
      PRIMARY KEY (user_id, account_id)
    );
  `);
}

router.post('/accounts/invite', requireAuth, async (req, res) => {
  try{
    await ensureCoreTables(); await ensureTables();
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const roleRow = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [req.user.id, accountId]);
    const role = roleRow.rowCount ? roleRow.rows[0].role : null;
    if (!role || roleRank(role) < 2) return res.status(403).json({ error: 'forbidden_role' });

    const { email, role: invitedRole = 'member', appCode = 'ATEX' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'missing_email' });

    let userId = null;
    const u = await pool.query(`SELECT id FROM public.users WHERE email=$1 LIMIT 1`, [email]);
    if (u.rowCount) userId = u.rows[0].id;
    else {
      const ins = await pool.query(`INSERT INTO public.users(email, name, password) VALUES ($1,$2,'') RETURNING id`, [email, (email.split('@')[0] || 'User')]);
      userId = ins.rows[0].id;
    }

    await pool.query(`
      INSERT INTO public.user_accounts(user_id, account_id, role)
      VALUES ($1,$2,$3)
      ON CONFLICT (user_id, account_id) DO UPDATE SET role=EXCLUDED.role
    `, [userId, accountId, invitedRole]);

    const sub = await pool.query(`
      SELECT id, tier, seats_total FROM public.subscriptions
      WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
      ORDER BY tier DESC LIMIT 1
    `, [accountId, appCode]);

    let subId = null, seats = 1;
    if (sub.rowCount) {
      subId = sub.rows[0].id;
      seats = (sub.rows[0].seats_total ?? 0) + 1;
      await pool.query(`UPDATE public.subscriptions SET seats_total=$1 WHERE id=$2`, [seats, subId]);
    } else {
      const ins = await pool.query(`
        INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
        VALUES ($1,$2,'account',0,1,'active') RETURNING id, seats_total
      `, [accountId, appCode]);
      subId = ins.rows[0].id; seats = ins.rows[0].seats_total;
    }

    await pool.query(`
      INSERT INTO public.license_assignments(subscription_id, user_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING
    `, [subId, userId]);

    res.status(201).json({ ok: true, invited: email, role: invitedRole, app: appCode, account_id: accountId, seats_total: seats });
  }catch(e){
    console.error('[POST /accounts/invite] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/accounts/members/:appCode', requireAuth, async (req, res) => {
  try{
    const { appCode } = req.params;
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const roleRow = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [req.user.id, accountId]);
    const role = roleRow.rowCount ? roleRow.rows[0].role : null;
    if (!role || (role !== 'owner' && role !== 'admin')) return res.status(403).json({ error: 'forbidden_role' });

    const r = await pool.query(`
      SELECT u.email, ua.role,
             CASE WHEN la.user_id IS NULL THEN false ELSE true END AS has_seat
      FROM public.user_accounts ua
      JOIN public.users u ON u.id = ua.user_id
      LEFT JOIN LATERAL (
        SELECT s.id FROM public.subscriptions s
        WHERE s.account_id=$1 AND s.app_code=$2 AND s.scope='account' AND s.status='active'
        ORDER BY s.tier DESC LIMIT 1
      ) s ON TRUE
      LEFT JOIN public.license_assignments la ON la.subscription_id = s.id AND la.user_id = ua.user_id
      WHERE ua.account_id=$1
      ORDER BY u.email ASC
    `, [accountId, appCode]);
    res.json({ app: appCode, account_id: accountId, role, members: r.rows });
  }catch(e){
    console.error('[GET /accounts/members/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
