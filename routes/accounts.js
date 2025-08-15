// routes/accounts.js — v3
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

async function ensureAccountsSoftDelete(){
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='accounts' AND column_name='deleted_at'
      ) THEN
        ALTER TABLE public.accounts ADD COLUMN deleted_at TIMESTAMP NULL;
      END IF;
    END
    $$;`);
}

router.get('/accounts/mine', requireAuth, async (req, res) => {
  try {
    await ensureAccountsSoftDelete();
    const uid = req.user && req.user.uid;
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    const r = await pool.query(
      `SELECT a.id AS account_id, a.name AS account_name, ua.role
       FROM public.accounts a
       JOIN public.user_accounts ua ON ua.account_id = a.id
       WHERE ua.user_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.id ASC`,
      [uid]
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error('[GET /accounts/mine] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/accounts/:id/owners', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r = await pool.query(
      `SELECT u.email
       FROM public.user_accounts ua
       JOIN public.users u ON u.id = ua.user_id
       JOIN public.accounts a ON a.id = ua.account_id
       WHERE ua.account_id = $1 AND ua.role = 'owner' AND a.deleted_at IS NULL
       ORDER BY u.email ASC`,
      [id]
    );
    res.json(r.rows.map(x => x.email));
  } catch (e) {
    console.error('[GET /accounts/:id/owners] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/accounts', requireAuth, async (req, res) => {
  try {
    await ensureAccountsSoftDelete();
    const uid = req.user && req.user.uid;
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    const name = ((req.body && req.body.name) || '').trim() || "Nouvel espace";
    const ins = await pool.query(
      `INSERT INTO public.accounts(name) VALUES ($1) RETURNING id, name`,
      [name]
    );
    const acc = ins.rows[0];
    await pool.query(
      `INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [uid, acc.id]
    );
    res.status(201).json({ account_id: acc.id, account_name: acc.name, role: 'owner' });
  } catch (e) {
    console.error('[POST /accounts] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  try {
    await ensureAccountsSoftDelete();
    const uid = req.user && req.user.uid;
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    const accountId = Number(req.params.id);
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const m = await pool.query(
      `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
      [uid, accountId]
    );
    if (!m.rowCount) return res.status(403).json({ error: 'forbidden_account' });
    if (m.rows[0].role !== 'owner') return res.status(403).json({ error: 'owner_required' });

    await pool.query(
      `UPDATE public.accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id=$1`,
      [accountId]
    );
    res.json({ ok: true, deleted: accountId });
  } catch (e) {
    console.error('[DELETE /accounts/:id] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
