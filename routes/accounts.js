// routes/accounts.js — endpoints comptes (mine / create / owners / delete)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

// GET /accounts/mine → {accounts:[{id,name,role}]}
router.get('/accounts/mine', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.id, a.name, ua.role
      FROM public.accounts a
      JOIN public.user_accounts ua ON ua.account_id = a.id
      WHERE ua.user_id = $1
      ORDER BY a.id ASC
    `, [req.user.id]);
    return res.json({ accounts: r.rows });
  } catch (e) {
    console.error('[GET /accounts/mine] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /accounts  body: {name} → crée l’espace + te met owner
router.post('/accounts', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });

    await client.query('BEGIN');

    const insAcc = await client.query(
      `INSERT INTO public.accounts(name) VALUES($1) RETURNING id, name`,
      [name]
    );
    const acc = insAcc.rows[0];

    await client.query(
      `INSERT INTO public.user_accounts(user_id, account_id, role)
       VALUES($1,$2,'owner')
       ON CONFLICT (user_id, account_id) DO NOTHING`,
      [req.user.id, acc.id]
    );

    await client.query('COMMIT');
    return res.json({ account_id: acc.id, name: acc.name });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /accounts] error', e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

// GET /accounts/:accountId/owners → [{email}]
router.get('/accounts/:accountId/owners', requireAuth, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!accountId) return res.status(400).json({ error: 'bad_account_id' });

    const r = await pool.query(`
      SELECT u.email
      FROM public.user_accounts ua
      JOIN public.users u ON u.id = ua.user_id
      WHERE ua.account_id = $1 AND ua.role = 'owner'
      ORDER BY u.email ASC
    `, [accountId]);

    return res.json(r.rows);
  } catch (e) {
    console.error('[GET /accounts/:id/owners] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// DELETE /accounts/:accountId  (seulement owner du compte ciblé)
router.delete('/accounts/:accountId', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const accountId = Number(req.params.accountId);
    if (!accountId) return res.status(400).json({ error: 'bad_account_id' });

    // Vérifie que l’appelant est owner du compte ciblé
    const who = await client.query(`
      SELECT 1 FROM public.user_accounts
      WHERE user_id = $1 AND account_id = $2 AND role = 'owner'
      LIMIT 1
    `, [req.user.id, accountId]);
    if (!who.rowCount) return res.status(403).json({ error: 'forbidden' });

    await client.query('BEGIN');

    // Supprime membership
    await client.query(`DELETE FROM public.user_accounts WHERE account_id=$1`, [accountId]);

    // Supprime subscriptions si la table existe
    try {
      await client.query(`DELETE FROM public.subscriptions WHERE account_id=$1`, [accountId]);
    } catch (e) {
      if (e.code !== '42P01') throw e; // ignore "table n'existe pas"
    }

    // Supprime le compte
    await client.query(`DELETE FROM public.accounts WHERE id=$1`, [accountId]);

    await client.query('COMMIT');
    return res.json({ ok: true, account_id: accountId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[DELETE /accounts/:id] error', e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

module.exports = router;
