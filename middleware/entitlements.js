// middleware/entitlements.js
// Guard de licence avec fallback fiable :
// 1) Essaie une subscription par compte (table public.subscriptions {account_id, app, tier:int})
// 2) Sinon fallback sur plan utilisateur (users.plan_tier, défaut 1)
// 3) Renvoie 402 si have_tier < required_tier

const { pool } = require('../config/db');

function normalizeInt(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function getAccountId(req) {
  return normalizeInt(req.query?.account_id ?? req.account_id ?? null, null);
}

async function fetchAccountTier(accountId, appCode) {
  if (!accountId) return 0;
  try {
    const sql = `
      SELECT COALESCE(tier,0)::int AS tier
      FROM public.subscriptions
      WHERE account_id = $1 AND app = $2
      LIMIT 1
    `;
    const r = await pool.query(sql, [accountId, appCode]);
    return normalizeInt(r.rows[0]?.tier, 0);
  } catch (e) {
    // Si la table n'existe pas en dev (42P01), on ignore
    if (e?.code !== '42P01') console.warn('[entitlements] fetchAccountTier:', e.message || e);
    return 0;
  }
}

async function fetchUserTier(userId) {
  try {
    const sql = `SELECT COALESCE(plan_tier,1)::int AS tier FROM public.users WHERE id=$1 LIMIT 1`;
    const r = await pool.query(sql, [userId]);
    // fallback min 1
    return normalizeInt(r.rows[0]?.tier, 1);
  } catch (e) {
    console.warn('[entitlements] fetchUserTier:', e.message || e);
    // si vraiment tout casse : défaut 1 plutôt que 0
    return 1;
  }
}

function requireLicense(appCode, requiredTier = 1) {
  return async function entitlementsGuard(req, res, next) {
    try {
      // requireAuth doit déjà avoir posé req.user / req.account_id / req.role
      const userId = req.user?.id ?? req.user?.uid;
      if (!userId) return res.status(401).json({ error: 'unauthorized' });

      const accountId = getAccountId(req);
      let have = await fetchAccountTier(accountId, appCode);

      // Fallback plan utilisateur si pas de sub compte / valeur 0
      if (!have || have <= 0) {
        have = await fetchUserTier(userId);
      }

      req.license = { app: appCode, account_id: accountId, required_tier: requiredTier, have_tier: have };

      if (have < requiredTier) {
        return res.status(402).json({
          error: 'payment_required',
          app: appCode,
          required_tier: requiredTier,
          have_tier: have
        });
      }
      return next();
    } catch (e) {
      console.error('[entitlements] error', e);
      return res.status(500).json({ error: 'server_error' });
    }
  };
}

module.exports = { requireLicense };
