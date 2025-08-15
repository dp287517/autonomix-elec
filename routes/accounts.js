// routes/accounts.js — espaces (workspaces) listés pour l'utilisateur courant
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

// GET /api/accounts/mine
// -> [{ account_id, account_name, role }]
router.get('/accounts/mine', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    const r = await pool.query(
      `SELECT a.id AS account_id, a.name AS account_name, ua.role
       FROM public.accounts a
       JOIN public.user_accounts ua ON ua.account_id = a.id
       WHERE ua.user_id = $1
       ORDER BY a.id ASC`,
      [uid]
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error('[GET /accounts/mine] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/accounts/:id/owners -> liste des owners (email)
router.get('/accounts/:id/owners', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r = await pool.query(
      `SELECT u.email
       FROM public.user_accounts ua
       JOIN public.users u ON u.id = ua.user_id
       WHERE ua.account_id = $1 AND ua.role = 'owner'
       ORDER BY u.email ASC`,
      [id]
    );
    res.json(r.rows.map(x => x.email));
  } catch (e) {
    console.error('[GET /accounts/:id/owners] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
