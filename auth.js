// auth.js — Routes d'authentification (racine du projet)
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { pool } = require('./config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

function signToken({ email, uid, account_id, role }) {
  return jwt.sign({ sub: email, uid, account_id, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

router.get('/debug/ping', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
router.get('/debug/db', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error('[GET /debug/db] error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    await ensureUsersTable();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    // Empêche les doublons
    const dupli = await pool.query(`SELECT 1 FROM public.users WHERE email=$1 LIMIT 1`, [email]);
    if (dupli.rowCount) return res.status(409).json({ error: 'email_exists' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Tables multi-tenant minimales (si absentes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.accounts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL,
        parent_account_id BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_accounts (
        user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        PRIMARY KEY (user_id, account_id)
      );`);

    // Nom d'affichage par défaut (évite NOT NULL sur certaines bases existantes)
    const displayName = (email.split('@')[0] || 'Utilisateur').trim();

    // Crée le compte (tenant) en premier
    const accName = displayName + "'s account";
    const acc = await pool.query(
      `INSERT INTO public.accounts(name) VALUES ($1) RETURNING id`,
      [accName]
    );
    const accountId = acc.rows[0].id;

    // ✅ INSERT utilisateur AVEC name pour respecter une éventuelle contrainte NOT NULL
    const u = await pool.query(
      `INSERT INTO public.users(email, name, password)
       VALUES ($1,$2,$3)
       RETURNING id, email`,
      [email, displayName, hash]
    );
    const user = u.rows[0];

    // Lien user -> account (owner)
    await pool.query(
      `INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1,$2,'owner')`,
      [user.id, accountId]
    );

    const token = signToken({ email: user.email, uid: user.id, account_id: accountId, role: 'owner' });
    return res.status(201).json({ token });
  } catch (e) {
    console.error('[POST /register] code=', e.code, ' detail=', e.detail, ' msg=', e.message);
    if (e && e.code === '23505') return res.status(409).json({ error: 'email_exists' });
    // (Optionnel en dev) décommenter pour exposer plus de détails :
    // return res.status(500).json({ error: 'server_error', code: e.code, detail: e.detail, message: e.message });
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    await ensureUsersTable();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const r = await pool.query(
      `SELECT id, email, password FROM public.users WHERE email=$1 LIMIT 1`,
      [email]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
    const user = r.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const a = await pool.query(`
      SELECT ua.account_id, ua.role
      FROM public.user_accounts ua
      WHERE ua.user_id=$1
      ORDER BY ua.account_id ASC
      LIMIT 1
    `, [user.id]);

    let accountId = null, role = null;
    if (a.rowCount) {
      accountId = a.rows[0].account_id;
      role = a.rows[0].role;
    } else {
      const acc = await pool.query(
        `INSERT INTO public.accounts(name) VALUES ($1) RETURNING id`,
        [(email.split('@')[0] || 'Mon compte') + "'s account"]
      );
      accountId = acc.rows[0].id;
      role = 'owner';
      await pool.query(
        `INSERT INTO public.user_accounts(user_id, account_id, role) VALUES ($1,$2,$3)`,
        [user.id, accountId, role]
      );
    }

    const token = signToken({ email: user.email, uid: user.id, account_id: accountId, role });
    return res.json({ token });
  } catch (e) {
    console.error('[POST /login] code=', e.code, ' detail=', e.detail, ' msg=', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const payload = jwt.verify(token, JWT_SECRET);
    let role = payload.role || null;

    if (payload.account_id && payload.uid) {
      const r = await pool.query(
        `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
        [payload.uid, payload.account_id]
      );
      if (r.rowCount) role = r.rows[0].role;
    }

    res.json({ email: payload.sub, account_id: payload.account_id || null, role });
  } catch (e) {
    console.error('[GET /me] error', e);
    return res.status(401).json({ error: 'invalid_token' });
  }
});

module.exports = router;
