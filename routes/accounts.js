
// routes/accounts.js — create/list/delete workspaces + /me
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

router.get('/me', requireAuth, async (req, res) => {
  try {
    await ensureCoreTables();
    let account_id = req.account_id;
    let role = req.role;
    if (!account_id) {
      const r = await pool.query(`
        SELECT account_id, role FROM public.user_accounts
        WHERE user_id=$1 ORDER BY role='owner' DESC, role='admin' DESC LIMIT 1
      `, [req.user.id]);
      if (r.rowCount){
        account_id = r.rows[0].account_id;
        role = r.rows[0].role;
      }
    }
    res.json({ email: req.user.email, account_id, role });
  } catch (e) {
    console.error('[GET /me] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

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

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  try{
    await ensureCoreTables();
    const accountId = Number(req.params.id);
    if (!accountId) return res.status(400).json({ error: 'bad_account_id' });
    const roleRow = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [req.user.id, accountId]);
    const role = roleRow.rowCount ? roleRow.rows[0].role : null;
    if (role !== 'owner') return res.status(403).json({ error: 'owner_only' });

    await pool.query(`DELETE FROM public.license_assignments WHERE subscription_id IN (SELECT id FROM public.subscriptions WHERE account_id=$1)`, [accountId]).catch(()=>{});
    await pool.query(`DELETE FROM public.subscriptions WHERE account_id=$1`, [accountId]).catch(()=>{});
    await pool.query(`DELETE FROM public.user_accounts WHERE account_id=$1`, [accountId]);
    await pool.query(`DELETE FROM public.accounts WHERE id=$1`, [accountId]);

    res.json({ ok: true, deleted_account_id: accountId });
  }catch(e){
    console.error('[DELETE /accounts/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
