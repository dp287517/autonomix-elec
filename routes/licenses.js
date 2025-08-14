
// routes/licenses.js — license lookup (seatful + seatless)
const router = require('express').Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/authz');

async function ensureTables(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.subscriptions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT,
      account_id BIGINT,
      app_code TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('user','account')),
      tier INT NOT NULL DEFAULT 0,
      seats_total INT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.license_assignments (
      subscription_id BIGINT NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (subscription_id, user_id)
    );
  `);
}

async function getRole(userId, accountId){
  const r = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`, [userId, accountId]);
  return r.rowCount ? r.rows[0].role : null;
}

router.get('/licenses/:appCode', requireAuth, async (req,res)=>{
  try{
    await ensureTables();
    const { appCode } = req.params;
    const accountId = Number(req.query.account_id) || req.account_id;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const role = await getRole(req.user.id, accountId);
    if (!role) return res.status(403).json({ error: 'forbidden_account' });

    const u = await pool.query(`
      SELECT tier FROM public.subscriptions
      WHERE user_id=$1 AND app_code=$2 AND scope='user' AND status='active'
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY tier DESC LIMIT 1
    `, [req.user.id, appCode]);
    if (u.rowCount) return res.json({ app: appCode, account_id: accountId, scope:'user', source:'direct', assigned:true, tier: u.rows[0].tier || 0, role });

    const a = await pool.query(`
      SELECT id, tier, seats_total FROM public.subscriptions
      WHERE account_id=$1 AND app_code=$2 AND scope='account' AND status='active'
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY tier DESC LIMIT 1
    `, [accountId, appCode]);
    if (!a.rowCount) return res.json({ app: appCode, account_id: accountId, scope:null, source:null, assigned:false, tier: 0, role });

    const lic = a.rows[0];
    if (lic.seats_total === null) {
      return res.json({ app: appCode, account_id: accountId, scope:'account', source:'seatless', assigned:true, tier: lic.tier || 0, role });
    }
    const seat = await pool.query(`SELECT 1 FROM public.license_assignments WHERE subscription_id=$1 AND user_id=$2 LIMIT 1`, [lic.id, req.user.id]);
    const assigned = !!seat.rowCount;
    return res.json({ app: appCode, account_id: accountId, scope:'account', source:'seatful', assigned, tier: assigned ? (lic.tier || 0) : 0, role, seats_total: lic.seats_total });
  }catch(e){
    console.error('[GET /licenses/:appCode] error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
