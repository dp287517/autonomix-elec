// middleware/authz.js — AuthN/AuthZ multi-tenant robuste
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';

/**
 * Décodage + rattachement d'espace (account) robuste :
 * - lit le Bearer token (obligatoire)
 * - récupère l'utilisateur (uid) depuis le token
 * - si ?account_id= est présent dans la requête, vérifie que l'utilisateur est membre de cet espace
 *   -> si oui : req.account_id = celui de la query
 *   -> sinon : 403 forbidden_account
 * - sinon, si le token contient un account_id, vérifie la membership, sinon fallback
 * - sinon, utilise le premier espace auquel l'utilisateur appartient (ordre arbitraire)
 * - expose req.user, req.account_id, req.role
 */
async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const uid = payload.uid;
    if (!uid) return res.status(401).json({ error: 'invalid_token' });

    // Liste des memberships de l'utilisateur
    const memberships = await pool.query(
      `SELECT account_id, role FROM public.user_accounts WHERE user_id=$1`,
      [uid]
    );

    if (!memberships.rowCount) {
      return res.status(403).json({ error: 'no_account' });
    }

    const requested = req.query.account_id ? Number(req.query.account_id) : null;
    const tokenAcc = payload.account_id ? Number(payload.account_id) : null;

    function findMembership(accId) {
      return memberships.rows.find(r => Number(r.account_id) === Number(accId));
    }

    let accId = null;
    let role = null;

    if (requested) {
      const m = findMembership(requested);
      if (!m) return res.status(403).json({ error: 'forbidden_account' });
      accId = requested;
      role = m.role;
    } else if (tokenAcc) {
      const m = findMembership(tokenAcc);
      if (m) { accId = tokenAcc; role = m.role; }
    }

    if (!accId) {
      // fallback: premier espace du user
      accId = Number(memberships.rows[0].account_id);
      role  = memberships.rows[0].role;
    }

    req.user = { uid, email: payload.sub };
    // Back-compat for routes using req.user.id
    req.user.id = uid;
    req.account_id = accId;
    req.role = role;

    next();
  } catch (e) {
    console.error('[requireAuth] error', e);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.role) return res.status(403).json({ error: 'forbidden' });
    if (!allowed.includes(req.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
