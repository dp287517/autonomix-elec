// routes/licenses.js — v4 (lecture tier pour gating, membres autorisés)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

async function roleOnAccount(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

router.get('/licenses/:app', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const app = String(req.params.app || '').toUpperCase();
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    let tier = 0, source = 'none';
    try {
      const a = await pool.query(
        `SELECT active_tier FROM public.active_subscriptions WHERE account_id=$1 AND app_code=$2`,
        [accountId, app]
      );
      if (a.rowCount) { tier = Number(a.rows[0].active_tier || 0); source = 'active_subscriptions'; }
    } catch {}

    if (tier === 0) {
      const q = await pool.query(
        `SELECT tier FROM public.subscriptions
         WHERE account_id=$1 AND app_code=$2
         ORDER BY id DESC LIMIT 1`,
        [accountId, app]
      );
      if (q.rowCount) { tier = Number(q.rows[0].tier || 0); source = 'subscriptions'; }
    }

    return res.json({ app_code: app, tier, source });
  } catch (e) {
    console.error('[GET /licenses/:app] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
