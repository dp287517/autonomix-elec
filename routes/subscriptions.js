// routes/subscriptions.js — plan global utilisateur
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/authz');

const PLAN_MAP = { free: 1, personal: 2, perso: 2, pro: 3 };
function planToTier(plan, tier) {
  if (typeof tier === 'number' && [1,2,3].includes(tier)) return tier;
  const key = String(plan || '').trim().toLowerCase();
  return PLAN_MAP[key] || 1;
}

// GET /subscriptions/:appCode?account_id=ID
// -> { app, account_id, tier, source }
router.get('/subscriptions/:appCode', requireAuth, async (req, res) => {
  try {
    const appCode = req.params.appCode;
    const accountId = Number(req.query.account_id) || req.account_id;

    const r = await pool.query(
      `SELECT COALESCE(plan_tier,1)::int AS tier FROM public.users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );
    const tier = r.rows[0]?.tier || 1;

    return res.json({ app: appCode, account_id: accountId, tier, source: 'user-plan' });
  } catch (e) {
    console.error('[GET /subscriptions/:appCode] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /subscriptions/:appCode/choose?account_id=ID
// body: { plan: 'free'|'personal'|'pro' }  ou  { tier: 1|2|3 }
router.post('/subscriptions/:appCode/choose', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    const appCode = req.params.appCode;
    const accountId = Number(req.query.account_id) || req.account_id;

    const desiredTier = planToTier(req.body?.plan, Number(req.body?.tier));
    if (![1,2,3].includes(desiredTier)) return res.status(400).json({ error: 'bad_tier' });

    await pool.query(`UPDATE public.users SET plan_tier=$1 WHERE id=$2`, [desiredTier, req.user.id]);

    return res.json({ ok: true, app: appCode, account_id: accountId, tier: desiredTier, source: 'user-plan' });
  } catch (e) {
    console.error('[POST /subscriptions/:appCode/choose] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
