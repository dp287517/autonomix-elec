// routes/usage.js — simple usage counters
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

async function ensure(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.usage_aggregate (
      user_id BIGINT NOT NULL,
      app TEXT NOT NULL,
      count BIGINT NOT NULL DEFAULT 0,
      last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, app)
    );
  `);
}

router.get('/', requireAuth, async (req, res) => {
  try{
    await ensure();
    const apps = (req.query.apps || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (!apps.length) return res.json({});
    const r = await pool.query(`SELECT app, count, last_at FROM public.usage_aggregate WHERE user_id=$1 AND app = ANY($2)`, [req.user.id, apps]);
    const out = {};
    r.rows.forEach(row => out[row.app] = { count: Number(row.count || 0), last_at: row.last_at });
    res.json(out);
  }catch(e){
    console.error('[GET /usage] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/bump', requireAuth, async (req, res) => {
  try{
    await ensure();
    const app = (req.body?.app || '').trim();
    if (!app) return res.status(400).json({ error: 'missing_app' });
    const r = await pool.query(`
      INSERT INTO public.usage_aggregate(user_id, app, count, last_at)
      VALUES ($1,$2,1,NOW())
      ON CONFLICT (user_id, app)
      DO UPDATE SET count = public.usage_aggregate.count + 1, last_at = NOW()
      RETURNING count, last_at
    `, [req.user.id, app]);
    res.json({ app, count: Number(r.rows[0].count), last_at: r.rows[0].last_at });
  }catch(e){
    console.error('[POST /usage/bump] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
