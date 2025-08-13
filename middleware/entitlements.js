// middleware/entitlements.js
// Vérifie qu'un utilisateur possède une licence valide pour une application donnée
// et un niveau (tier) minimal. Supporte scope 'user' ou 'account' (avec seats).
const { pool } = require('../config/db');

/**
 * requireLicense(appCode, minTier)
 * - appCode: ex. 'ATEX', 'EPD'
 * - minTier: entier >=1 (ex. 1, 2, 3)
 */
function requireLicense(appCode, minTier=1) {
  return async function(req, res, next) {
    try {
      // Si la page est gratuite ou si minTier <= 0, passe quand même
      if (!appCode || !minTier || minTier <= 0) return next();

      const userId = req.user?.id;
      const accountId = req.account_id;
      if (!userId || !accountId) {
        return res.status(401).json({ error: 'unauthenticated' });
      }

      // 1) Licence user-scope prioritaire
      const userLic = await pool.query(`
        SELECT tier, status, ends_at
        FROM public.subscriptions
        WHERE user_id=$1 AND app_code=$2 AND scope='user' AND status='active'
          AND (ends_at IS NULL OR ends_at > NOW())
        ORDER BY tier DESC
        LIMIT 1
      `, [userId, appCode]);

      let allowedTier = 0;
      if (userLic.rowCount) {
        allowedTier = userLic.rows[0].tier || 0;
      } else {
        // 2) Licence account-scope : vérifier l'affectation (si seats_total non null)
        const accLic = await pool.query(`
          SELECT s.id, s.tier, s.seats_total
          FROM public.subscriptions s
          WHERE s.account_id=$1 AND s.app_code=$2 AND s.scope='account' AND s.status='active'
            AND (s.ends_at IS NULL OR s.ends_at > NOW())
          ORDER BY s.tier DESC
          LIMIT 1
        `, [accountId, appCode]);

        if (accLic.rowCount) {
          const lic = accLic.rows[0];
          if (lic.seats_total === null) {
            // seatless -> tout membre du compte est autorisé
            allowedTier = lic.tier || 0;
          } else {
            // seat-based -> vérifier l'assignation
            const seat = await pool.query(`
              SELECT 1
              FROM public.license_assignments la
              WHERE la.subscription_id=$1 AND la.user_id=$2
              LIMIT 1
            `, [lic.id, userId]);
            if (seat.rowCount) {
              allowedTier = lic.tier || 0;
            }
          }
        }
      }

      if (allowedTier >= minTier) return next();
      return res.status(402).json({ error: 'payment_required', required_tier: minTier, have_tier: allowedTier, app: appCode });
    } catch (e) {
      console.error('[requireLicense] error', e);
      return res.status(500).json({ error: 'server_error' });
    }
  };
}

module.exports = { requireLicense };
