// routes/licenses.js
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middlewares/authz'); // hydrate req.user/account_id/role

async function getAllowedTierAndScope({ userId, accountId, appCode }) {
  // Licence utilisateur
  const userLic = await pool.query(`
    SELECT tier, status, ends_at
    FROM public.subscriptions
    WHERE user_id=$1 AND app_code=$2 AND scope='user' AND status='active'
      AND (ends_at IS NULL OR ends_at > NOW())
    ORDER BY tier DESC LIMIT 1
  `, [userId, appCode]);
  if (userLic.rowCount) {
    return { tier: userLic.rows[0].tier || 0, scope: 'user', source: 'direct' };
  }

  // Licence compte (seatless ou seats)
  const accLic = await pool.query(`
    SELECT s.id, s.tier, s.seats_total
    FROM public.subscriptions s
    WHERE s.account_id=$1 AND s.app_code=$2 AND s.scope='account' AND s.status='active'
      AND (s.ends_at IS NULL OR s.ends_at > NOW())
    ORDER BY s.tier DESC LIMIT 1
  `, [accountId, appCode]);

  if (!accLic.rowCount) return { tier: 0, scope: null, source: null };

  const lic = accLic.rows[0];
  if (lic.seats_total === null) {
    return { tier: lic.tier || 0, scope: 'account', source: 'seatless' };
  }
  const seat = await pool.query(`
    SELECT 1 FROM public.license_assignments la
    WHERE la.subscription_id=$1 AND la.user_id=$2 LIMIT 1
  `, [lic.id, userId]);
  if (seat.rowCount) {
    return { tier: lic.tier || 0, scope: 'account', source: 'seat' };
  }
  return { tier: 0, scope: 'account', source: 'seat_unassigned' };
}

router.get('/licenses/:appCode', requireAuth, async (req, res) => {
  try {
    const { appCode } = req.params;
    const info = await getAllowedTierAndScope({
      userId: req.user.id,
      accountId: req.account_id,
      appCode
    });
    res.json({ app: appCode, ...info });
  } catch (e) {
    console.error('[licenses] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
