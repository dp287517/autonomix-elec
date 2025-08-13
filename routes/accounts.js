// routes/accounts.js
// Étape 2 — Comptes & membres (minimal)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middlewares/authz');

// Lister les comptes de l'utilisateur
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.id, a.name, a.parent_account_id, ua.role
      FROM public.accounts a
      JOIN public.user_accounts ua ON ua.account_id=a.id
      WHERE ua.user_id=$1
      ORDER BY a.id ASC
    `, [req.user.id]);
    res.json(r.rows);
  } catch (e) {
    console.error('[GET /accounts] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Ajouter un membre dans un compte (owner/admin)
router.post('/accounts/:id/members', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    const accountId = Number(req.params.id);
    const { user_id, role } = req.body || {};

    if (!user_id || !role) return res.status(400).json({ error: 'missing_fields' });
    if (!['owner','admin','member'].includes(role)) return res.status(400).json({ error: 'invalid_role' });

    // Vérifie que le caller appartient au compte ciblé
    const ok = await pool.query(
      `SELECT 1 FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
      [req.user.id, accountId]
    );
    if (!ok.rowCount) return res.status(403).json({ error: 'forbidden_account' });

    await pool.query(
      `INSERT INTO public.user_accounts(user_id, account_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, account_id) DO UPDATE SET role=EXCLUDED.role`,
      [user_id, accountId, role]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /accounts/:id/members] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
