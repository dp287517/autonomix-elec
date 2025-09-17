// routes/accounts.js — Accounts routes /api/accounts
const express = require('express');
const { pool } = require('../config/db');
const authz = require('../middleware/authz'); // Si tu as authz.js pour auth

const router = express.Router();

// Create account/site
router.post('/', authz.requireAuth, async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id; // From token
  try {
    const result = await pool.query(
      'INSERT INTO accounts (name, created_at) VALUES ($1, NOW()) RETURNING id',
      [name]
    );
    const accountId = result.rows[0].id;
    await pool.query(
      'INSERT INTO user_accounts (user_id, account_id, role) VALUES ($1, $2, $3)',
      [userId, accountId, 'owner']
    );
    res.json({ accountId });
  } catch (err) {
    console.error('[create account] error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List accounts for user
router.get('/mine', authz.requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT a.id, a.name, ua.role FROM accounts a JOIN user_accounts ua ON a.id = ua.account_id WHERE ua.user_id = $1',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Invite member
router.post('/invite', authz.requireRole('owner'), async (req, res) => {
  const { email } = req.body;
  const accountId = req.accountId; // From authz
  const inviterId = req.user.id;
  try {
    let userId;
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
    } else {
      const result = await pool.query(
        'INSERT INTO users (email, created_at) VALUES ($1, NOW()) RETURNING id',
        [email]
      );
      userId = result.rows[0].id;
    }
    await pool.query(
      'INSERT INTO user_accounts (user_id, account_id, role) VALUES ($1, $2, $3)',
      [userId, accountId, 'member']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
