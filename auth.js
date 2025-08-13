// auth.js — routes d'authentification (racine du projet)
// Étape 2 avec logs détaillés pour debug (500 sur /api/login)
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

// IMPORTANT: chemin DB pour ta structure
const { pool } = require('./config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

// Helpers
function signToken({ email, uid, account_id, role }) {
  return jwt.sign({ sub: email, uid, account_id, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// === Debug endpoints (utiles pendant l'intégration) ===
router.get('/debug/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/debug/db', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error('[GET /api/debug/db] DB error:', e);
    res.status(500).json({ ok: false, error: 'db_error', details: String(e.message || e) });
  }
});

// REGISTER — crée l'user + compte + membership owner, renvoie token
router.post('/register', async (req, res) => {
  try {
    await ensureUsersTable();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // crée l'utilisateur
    const u = await pool.query(
      `INSERT INTO public.users(email, password) VALUES ($1,$2) RETURNING id, email`,
      [email, hash]
    );
    const user = u.rows[0];

    // crée un compte + membership owner
    const acc = await pool.query(
      `INSERT INTO public.accounts(name) VALUES ($1) RETURNING id`,
      [email.split('@')[0] + "'s account"]
    );
    const accountId = acc.rows[0].id;

    await pool.query(
      `INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1,$2,'owner')`,
      [user.id, accountId]
    );

    const token = signToken({ email: user.email, uid: user.id, account_id: accountId, role: 'owner' });
    res.json({ token });
  } catch (e) {
    console.error('[POST /api/register] error:', e);
    if (e.code === '23505') return res.status(409).json({ error: 'email_exists' });
    // expose un message court côté client, logs détaillés côté serveur
    res.status(500).json({ error: 'server_error' });
  }
});

// LOGIN — renvoie token avec compte par défaut
router.post('/login', async (req, res) => {
  try {
    await ensureUsersTable();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const r = await pool.query(`SELECT id, email, password FROM public.users WHERE email=$1 LIMIT 1`, [email]);
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    // cherche un account existant
    const a = await pool.query(
      `SELECT ua.account_id, ua.role
       FROM public.user_accounts ua
       WHERE ua.user_id=$1
       ORDER BY ua.account_id ASC
       LIMIT 1`,
      [user.id]
    );

    let accountId = null;
    let role = null;
    if (a.rowCount) {
      accountId = a.rows[0].account_id;
      role = a.rows[0].role;
    } else {
      // fallback rare: créer un compte si aucun lien
      const acc = await pool.query(
        `INSERT INTO public.accounts(name) VALUES ($1) RETURNING id`,
        [email.split('@')[0] + "'s account"]
      );
      accountId = acc.rows[0].id;
      role = 'owner';
      await pool.query(
        `INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1,$2,$3)`,
        [user.id, accountId, role]
      );
    }

    const token = signToken({ email: user.email, uid: user.id, account_id: accountId, role });
    res.json({ token });
  } catch (e) {
    console.error('[POST /api/login] error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ME — renvoie email + account_id + role
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const payload = jwt.verify(token, JWT_SECRET);

    // recalcul du rôle (source de vérité: user_accounts)
    let role = payload.role || null;
    if (payload.account_id) {
      const r = await pool.query(
        `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
        [payload.uid, payload.account_id]
      );
      if (r.rowCount) role = r.rows[0].role;
    }

    res.json({ email: payload.sub, account_id: payload.account_id || null, role });
  } catch (e) {
    console.error('[GET /api/me] error:', e);
    res.status(401).json({ error: 'invalid_token' });
  }
});

module.exports = router;
