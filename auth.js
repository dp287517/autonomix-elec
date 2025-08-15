
// auth.js — normalized email auth + invited account claim (root level, next to app.js)
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

async function ensureUsersTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users(
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT
    );
  `);
}

router.post('/signup', async (req, res) => {
  try{
    await ensureUsersTable();
    let email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    // If user exists with same lower(email)
    const ex = await pool.query(`SELECT id, email, password FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (ex.rowCount){
      const u = ex.rows[0];
      // If invited placeholder (no password yet), claim it by setting password
      if (!u.password){
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(`UPDATE public.users SET password=$1, email=LOWER($2) WHERE id=$3`, [hash, email, u.id]);
        const token = signToken({ email, uid: u.id });
        return res.json({ token });
      }
      return res.status(409).json({ error: 'email_exists' });
    }

    // Fresh insert
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const ins = await pool.query(`INSERT INTO public.users(email, password) VALUES(LOWER($1), $2) RETURNING id`, [email, hash]);
    const uid = ins.rows[0].id;
    const token = signToken({ email, uid });
    return res.json({ token });
  }catch(e){
    console.error('[POST /signup] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  try{
    await ensureUsersTable();
    let email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const r = await pool.query(`SELECT id, email, password FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
    const user = r.rows[0];
    if (!user.password) return res.status(401).json({ error: 'set_password_required' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const token = signToken({ email: user.email.toLowerCase(), uid: user.id });
    return res.json({ token });
  }catch(e){
    console.error('[POST /login] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Return who I am, and optionally my role on a specific account
router.get('/me', async (req, res) => {
  try{
    const auth = (req.headers.authorization || '').split(' ')[1] || '';
    const payload = jwt.verify(auth, JWT_SECRET);

    let account_id = null, role = null;
    if (req.query && req.query.account_id){
      account_id = Number(req.query.account_id);
      const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [payload.uid, account_id]);
      if (r.rowCount) role = r.rows[0].role;
    } else {
      const r = await pool.query(`SELECT account_id, role FROM public.user_accounts WHERE user_id=$1 ORDER BY account_id ASC LIMIT 1`, [payload.uid]);
      if (r.rowCount){ account_id = r.rows[0].account_id; role = r.rows[0].role; }
    }
    res.json({ email: payload.sub, account_id, role });
  }catch(e){
    console.error('[GET /me] error', e);
    return res.status(401).json({ error: 'invalid_token' });
  }
});

module.exports = router;
