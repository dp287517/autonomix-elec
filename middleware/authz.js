// middleware/authz.js
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';

async function requireAuth(req, res, next){
  try{
    const token = (req.headers.authorization || '').split(' ')[1] || '';
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { uid: payload.uid, email: payload.sub };
    req.user.id = req.user.uid; // compat

    let accountId = null, role = null;

    // priorité au ?account_id
    if (req.query && req.query.account_id){
      accountId = Number(req.query.account_id);
      const r = await pool.query(
        `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
        [req.user.uid, accountId]
      );
      if (!r.rowCount) return res.status(403).json({ error: 'forbidden_account' });
      role = r.rows[0].role;
    }

    // fallback: 1ère membership
    if (!role){
      const r = await pool.query(
        `SELECT account_id, role FROM public.user_accounts WHERE user_id=$1 ORDER BY account_id ASC LIMIT 1`,
        [req.user.uid]
      );
      if (!r.rowCount) return res.status(403).json({ error: 'no_membership' });
      accountId = r.rows[0].account_id; role = r.rows[0].role;
    }

    req.account_id = accountId;
    req.role = role;
    next();
  }catch(e){
    console.error('[requireAuth] error', e);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireRole(...allowed){
  return (req, res, next) => {
    if (!req.role) return res.status(403).json({ error: 'forbidden' });
    if (!allowed.includes(req.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
