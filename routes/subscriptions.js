// routes/subscriptions.js — v5
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

let { requireAuth } = (() => { try { return require('../middleware/authz'); } catch { return {}; } })();
requireAuth = requireAuth || ((_req,_res,next)=>next());

async function roleOnAccount(userId, accountId){
  const r = await pool.query(
    `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2`,
    [userId, accountId]
  );
  return r.rowCount ? r.rows[0].role : null;
}

// GET lecture "safe" (membres ok)
router.get('/subscriptions/:app', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const app = String(req.params.app || '').toUpperCase();
    const accountId = Number(req.query.account_id || req.body?.account_id);
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId) return res.status(400).json({ error: 'bad_request' });

    const role = await roleOnAccount(uid, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    // active_subscriptions prioritaire si présent
    let tier = 0, seats = 0, status = 'none';
    try {
      const a = await pool.query(
        `SELECT active_tier, active_seats FROM public.active_subscriptions
         WHERE account_id=$1 AND app_code=$2`,
        [accountId, app]
      );
      if (a.rowCount) {
        tier = Number(a.rows[0].active_tier || 0);
        seats = Number(a.rows[0].active_seats || 0);
        status = tier > 0 ? 'active' : 'none';
      }
    } catch {}

    if (tier === 0) {
      const q = await pool.query(
        `SELECT tier, seats_total, status
         FROM public.subscriptions
         WHERE account_id=$1 AND app_code=$2
         ORDER BY id DESC LIMIT 1`,
        [accountId, app]
      );
      if (q.rowCount) {
        tier = Number(q.rows[0].tier || 0);
        seats = Number(q.rows[0].seats_total || 0);
        status = q.rows[0].status || (tier>0 ? 'active':'none');
      }
    }

    return res.json({ tier, seats_total: seats, status });
  } catch (e) {
    console.error('[GET /subscriptions/:app] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST changement plan — owner requis
router.post('/subscriptions/:app/choose', requireAuth, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const app = String(req.params.app || '').toUpperCase();
    const accountId = Number(req.query.account_id || req.body?.account_id);
    let tier = Number(req.body && req.body.tier);
    if (!Number.isFinite(tier) || tier <= 0) tier = Number(req.query.tier);

    if (!uid) return res.status(401).json({ error: 'unauthenticated' });
    if (!accountId || !Number.isFinite(tier)) return res.status(400).json({ error: 'bad_request' });
    if (![1,2,3].includes(tier)) return res.status(400).json({ error: 'invalid_tier' });

    const role = await roleOnAccount(uid, accountId);
    if (role !== 'owner') return res.status(403).json({ error: 'owner_required' });

    // Upsert "active" (fallback sur subscriptions si table miroir absente)
    try {
      await pool.query(
        `INSERT INTO public.active_subscriptions (account_id, app_code, active_tier, active_seats)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (account_id, app_code) DO UPDATE
           SET active_tier=EXCLUDED.active_tier, active_seats=EXCLUDED.active_seats`,
        [accountId, app, tier]
      );
    } catch {}

    await pool.query(
      `INSERT INTO public.subscriptions (account_id, app_code, scope, tier, seats_total, status, started_at)
       VALUES ($1, $2, 'account', $3, 1, 'active', NOW())`,
      [accountId, app, tier]
    );

    return res.json({ ok: true, tier });
  } catch (e) {
    console.error('[POST /subscriptions/:app/choose] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
