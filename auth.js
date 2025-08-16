// auth.js — routes d’auth à la racine (montées par app.js sur /api)
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./config/db'); // <-- Option 1 : bon chemin
const router = express.Router();

const JWT_SECRET  = process.env.JWT_SECRET  || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

function signToken({ email, uid, account_id = null, role = null }) {
  return jwt.sign({ sub: email, uid, account_id, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ---------- /signup ----------
router.post('/signup', async (req, res) => {
  try {
    const emailRaw = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const name     = (req.body.name || emailRaw.split('@')[0] || 'user').trim(); // fallback si users.name NOT NULL

    if (!emailRaw || !password) return res.status(400).json({ error: 'missing_fields' });

    // existe déjà ?
    const ex = await pool.query(
      `SELECT id, email, password, name FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [emailRaw]
    );

    if (ex.rowCount) {
      const u = ex.rows[0];
      // Compte "invité" sans password → on le "claim"
      if (!u.password) {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
          `UPDATE public.users SET password=$1, name=COALESCE(name,$2) WHERE id=$3`,
          [hash, name, u.id]
        );
        const token = signToken({ email: emailRaw, uid: u.id });
        return res.json({ token, user: { email: emailRaw } });
      }
      return res.status(409).json({ error: 'email_exists' });
    }

    // nouvel utilisateur
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const ins  = await pool.query(
      `INSERT INTO public.users(email, name, password) VALUES(LOWER($1), $2, $3) RETURNING id`,
      [emailRaw, name, hash]
    );

    const uid   = ins.rows[0].id;
    const token = signToken({ email: emailRaw, uid });
    return res.json({ token, user: { email: emailRaw } });
  } catch (e) {
    console.error('[POST /signup] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------- /login ----------
router.post('/login', async (req, res) => {
  try {
    const emailRaw = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!emailRaw || !password) return res.status(400).json({ error: 'missing_fields' });

    const r = await pool.query(
      `SELECT id, email, password FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [emailRaw]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });

    const user = r.rows[0];
    if (!user.password) return res.status(401).json({ error: 'set_password_required' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const token = signToken({ email: user.email.toLowerCase(), uid: user.id });
    return res.json({ token, user: { email: user.email.toLowerCase() } });
  } catch (e) {
    console.error('[POST /login] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------- /me ----------
router.get('/me', async (req, res) => {
  try {
    const auth = (req.headers.authorization || '').split(' ')[1] || '';
    const payload = jwt.verify(auth, JWT_SECRET);

    let account_id = null, role = null;
    if (req.query && req.query.account_id) {
      account_id = Number(req.query.account_id);
      const r = await pool.query(
        `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
        [payload.uid, account_id]
      );
      if (r.rowCount) role = r.rows[0].role;
    } else {
      const r = await pool.query(
        `SELECT account_id, role FROM public.user_accounts WHERE user_id=$1 ORDER BY account_id ASC LIMIT 1`,
        [payload.uid]
      );
      if (r.rowCount) { account_id = r.rows[0].account_id; role = r.rows[0].role; }
    }

    return res.json({ email: payload.sub, account_id, role });
  } catch (e) {
    console.error('[GET /me] error', e);
    return res.status(401).json({ error: 'invalid_token' });
  }
});

module.exports = router;
