// middlewares/authz.js
// Étape 2 — AuthN/AuthZ multi-tenant
// - Décode le JWT
// - Vérifie l'appartenance user -> account (user_accounts)
// - Expose req.user, req.account_id, req.role

const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, email: payload.sub };
    req.account_id = payload.account_id || null;
    req.role = payload.role || null;

    if (req.account_id) {
      const r = await pool.query(
        `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
        [req.user.id, req.account_id]
      );
      if (!r.rowCount) {
        return res.status(403).json({ error: 'forbidden_account' });
      }
      req.role = r.rows[0].role;
    }
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
