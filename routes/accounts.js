// routes/accounts.js — create/list workspaces (multi-account)
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

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

router.get('/accounts/mine', requireAuth, async (req, res) => {
  try{
    await ensureCoreTables();
    const r = await pool.query(`
      SELECT a.id, a.name, ua.role
      FROM public.user_accounts ua
      JOIN public.accounts a ON a.id = ua.account_id
      WHERE ua.user_id=$1
      ORDER BY a.name ASC
    `, [req.user.id]);
    // Try infer current from JWT, else first
    const current = req.account_id || r.rows[0]?.id || null;
    res.json({ accounts: r.rows, current_account_id: current });
  }catch(e){
    console.error('[GET /accounts/mine] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/accounts', requireAuth, async (req, res) => {
  try{
    await ensureCoreTables();
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });

    const acc = await pool.query(`INSERT INTO public.accounts(name) VALUES ($1) RETURNING id, name`, [name]);
    const accountId = acc.rows[0].id;
    await pool.query(`
      INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1,$2,'owner')
      ON CONFLICT (user_id, account_id) DO UPDATE SET role='owner'
    `, [req.user.id, accountId]);

    res.status(201).json({ id: accountId, name, role: 'owner' });
  }catch(e){
    console.error('[POST /accounts] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
