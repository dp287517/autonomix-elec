// usage.js — Synchro des compteurs d'app côté serveur
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { pool } = require('./config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';

async function ensureTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_app_usage (
      user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
      app TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, account_id, app)
    );
  `);
}

function requireAuth(req, res, next){
  try{
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, account_id: payload.account_id, email: payload.sub };
    next();
  }catch(e){
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// GET /api/usage?apps=A,B,C  ->  { "A": {count, last_at}, "B": {...}, ... }
router.get('/', requireAuth, async (req,res)=>{
  try{
    await ensureTable();
    const apps = String(req.query.apps || '').split(',').map(s=>s.trim()).filter(Boolean);
    let rows;
    if (apps.length){
      const params = [req.user.id, req.user.account_id, ...apps];
      const placeholders = apps.map((_,i)=>`$${i+3}`).join(',');
      const q = `SELECT app, count, last_at FROM public.user_app_usage
                 WHERE user_id=$1 AND account_id=$2 AND app IN (${placeholders})`;
      rows = (await pool.query(q, params)).rows;
    }else{
      const q = `SELECT app, count, last_at FROM public.user_app_usage WHERE user_id=$1 AND account_id=$2`;
      rows = (await pool.query(q, [req.user.id, req.user.account_id])).rows;
    }
    const out = {};
    rows.forEach(r => out[r.app] = { count: r.count, last_at: r.last_at });
    return res.json(out);
  }catch(e){
    console.error('[GET /api/usage] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/usage/bump { app }  ->  { app, count, last_at }
router.post('/bump', requireAuth, express.json(), async (req,res)=>{
  try{
    await ensureTable();
    const app = (req.body && req.body.app || '').trim();
    if(!app) return res.status(400).json({ error: 'missing_app' });
    const q = `INSERT INTO public.user_app_usage(user_id, account_id, app, count, last_at)
               VALUES ($1,$2,$3,1,NOW())
               ON CONFLICT (user_id, account_id, app)
               DO UPDATE SET count = public.user_app_usage.count + 1, last_at = NOW()
               RETURNING app, count, last_at;`;
    const r = await pool.query(q, [req.user.id, req.user.account_id, app]);
    return res.json(r.rows[0]);
  }catch(e){
    console.error('[POST /api/usage/bump] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
