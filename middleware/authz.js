// middleware/authz.js — Auth middleware
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

module.exports = {
  requireAuth: async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  },
  requireRole: (role) => async (req, res, next) => {
    const accountId = req.body.accountId || req.query.accountId;
    req.accountId = accountId;
    try {
      const result = await pool.query(
        'SELECT role FROM user_accounts WHERE user_id = $1 AND account_id = $2',
        [req.user.id, accountId]
      );
      if (result.rows.length === 0 || result.rows[0].role !== role) return res.status(403).json({ error: 'Forbidden' });
      next();
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  }
};
