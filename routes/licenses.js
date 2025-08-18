// routes/licenses.js — licence globale par utilisateur
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

// GET /licenses/:appCode?account_id=ID
// -> { app, account_id, tier, source, role }
router.get('/licenses/:appCode', requireAuth, async (req, res) => {
  try {
    const appCode = req.params.appCode;
    const accountId = Number(req.query.account_id) || req.account_id;

    // requireAuth a déjà validé la membership et rempli req.role
    const u = await pool.query(
      `SELECT COALESCE(plan_tier,1)::int AS tier FROM public.users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );
    const tier = u.rows[0]?.tier || 1;

    return res.json({
      app: appCode,
      account_id: accountId,
      tier,
      source: 'user-plan',
      role: req.role
    });
  } catch (e) {
    console.error('[GET /licenses/:appCode] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
