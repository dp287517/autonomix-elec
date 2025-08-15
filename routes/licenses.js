// routes/licenses.js — lecture licence accessible à tout membre
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

// GET /api/licenses/:app_code?account_id=…
// -> retourne { app_code, account_id, tier } ; défaut tier=0 si pas d'abonnement actif
router.get('/licenses/:app', requireAuth, async (req, res) => {
  try {
    const app = (req.params.app || '').toUpperCase();
    const accountId = req.account_id;
    if (!app || !accountId) return res.status(400).json({ error: 'bad_request' });

    // Vue/agrégat attendu: subscriptions_active(account_id, app_code, active_tier, active_seats)
    let row;
    try {
      const r = await pool.query(
        `SELECT active_tier AS tier, active_seats
         FROM public.subscriptions_active
         WHERE account_id=$1 AND app_code=$2
         LIMIT 1`,
        [accountId, app]
      );
      row = r.rows[0];
    } catch {
      // Fallback si subscriptions_active n'existe pas: calcul à partir de subscriptions
      const r = await pool.query(
        `SELECT tier AS tier
         FROM public.subscriptions
         WHERE account_id=$1 AND app_code=$2 AND status='active'
         ORDER BY started_at DESC
         LIMIT 1`,
        [accountId, app]
      );
      row = r.rows[0];
    }

    res.json({
      app_code: app,
      account_id: accountId,
      tier: row ? Number(row.tier) : 0
    });
  } catch (e) {
    console.error('[GET /licenses/:app] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
