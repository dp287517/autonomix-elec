// routes/subscriptions.js — v4 (GET visible aux membres, POST choose réservé owner)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

async function roleOnAccount(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

router.get('/subscriptions/:app', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const app = String(req.params.app || '').toUpperCase();
    const accountId = Number(req.query.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const q = await pool.query(
      `SELECT tier, seats_total, status
       FROM public.subscriptions
       WHERE account_id=$1 AND app_code=$2
       ORDER BY id DESC LIMIT 1`,
      [accountId, app]
    );
    if (!q.rowCount) return res.json({ tier: 0, seats_total: 0, status: 'none' });
    const s = q.rows[0];
    res.json({ tier: Number(s.tier||0), seats_total: Number(s.seats_total||0), status: s.status || 'active' });
  } catch (e) {
    console.error('[GET /subscriptions/:app] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/subscriptions/:app/choose', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const app = String(req.params.app || '').toUpperCase();
    theAccountId = Number(req.query.account_id);
    const accountId = theAccountId;
    const tier = Number(req.body && req.body.tier);

    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !tier) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (role !== 'owner') return res.status(403).json({ error: 'owner_required' });

    await pool.query(
      `INSERT INTO public.subscriptions (account_id, app_code, scope, tier, seats_total, status, started_at)
       VALUES ($1, $2, 'account', $3, 1, 'active', NOW())
       ON CONFLICT (account_id, app_code, scope) DO UPDATE SET tier=EXCLUDED.tier, status='active'`,
       [accountId, app, tier]
    );

    try {
      await pool.query(
        `INSERT INTO public.active_subscriptions (account_id, app_code, active_tier, active_seats)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (account_id, app_code) DO UPDATE SET active_tier=EXCLUDED.active_tier, active_seats=EXCLUDED.active_seats`,
        [accountId, app, tier]
      );
    } catch {}

    res.json({ ok: true, tier });
  } catch (e) {
    console.error('[POST /subscriptions/:app/choose] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
