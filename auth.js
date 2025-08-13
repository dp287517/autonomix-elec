// auth.js (root) — Auth Postgres (Neon) : /api/register • /api/login • /api/me

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ====== CONFIG ======
const { pool } = require('./config/db'); // <- utilise ta config PG existante :contentReference[oaicite:4]{index=4}
const JWT_SECRET  = process.env.JWT_SECRET  || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// Compte admin fallback (optionnel, via variables d'env)
const AUTH_USER = process.env.AUTH_USER || 'admin@autonomix.local';
const AUTH_PASS = process.env.AUTH_PASS || 'AutonomiX!2025';

// ====== INIT TABLE ======
async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
      ON public.users (LOWER(email));
  `);
}
ensureUsersTable().catch(err => {
  console.error('[auth] failed to ensure users table:', err);
});

// ====== HELPERS ======
const normEmail = (e) => String(e||'').trim();
const bad = (res, code, msg) => res.status(code).json({ error: msg });

// ====== ROUTES ======

/**
 * POST /api/register
 * body: { email, password, name? }
 */
router.post('/register', async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();

    if (!email || !password) return bad(res, 400, 'Email et mot de passe requis');
    if (password.length < 8)   return bad(res, 400, 'Mot de passe trop court (min 8)');

    // Unicité insensible à la casse
    const exists = await pool.query(
      `SELECT 1 FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [email]
    );
    if (exists.rowCount) return bad(res, 409, 'Email déjà utilisé');

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO public.users (email, name, password) VALUES ($1,$2,$3)`,
      [email, name || email.split('@')[0], hash]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error('[POST /register]', e);
    return bad(res, 500, 'Erreur inscription');
  }
});

/**
 * POST /api/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) return bad(res, 400, 'Email et mot de passe requis');

    // 1) Essayer en base
    const { rows } = await pool.query(
      `SELECT id, email, password FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [email]
    );
    if (rows.length) {
      const u = rows[0];
      const ok = await bcrypt.compare(password, u.password);
      if (!ok) return bad(res, 401, 'Identifiants incorrects');

      const token = jwt.sign({ sub: u.email, uid: u.id, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      return res.json({ token, user: { email: u.email } });
    }

    // 2) Fallback admin via variables d’env
    if (email === AUTH_USER && password === AUTH_PASS) {
      const token = jwt.sign({ sub: email, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      return res.json({ token, user: { email } });
    }

    return bad(res, 401, 'Identifiants incorrects');
  } catch (e) {
    console.error('[POST /login]', e);
    return bad(res, 500, 'Erreur login');
  }
});

/**
 * GET /api/me
 * headers: Authorization: Bearer <token>
 */
router.get('/me', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return bad(res, 401, 'Non authentifié');

    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ ok: true, user: { email: payload.sub } });
  } catch (e) {
    return bad(res, 401, 'Session invalide/expirée');
  }
});

module.exports = router;
