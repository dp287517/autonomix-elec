
// routes/accounts_invite.js — normalize email + LOWER lookups
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/authz');

router.post('/accounts/invite', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try{
    const accountId = Number(req.query.account_id);
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });
    const email = (req.body.email || '').trim().toLowerCase();
    const role = (req.body.role || 'member');

    // ensure inviter is member owner/admin of this account
    const chk = await pool.query(`SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
      [ (req.user.uid || req.user.id), accountId ]);
    if (!chk.rowCount) return res.status(403).json({ error: 'forbidden_account' });
    const inviterRole = chk.rows[0].role;
    if (!['owner','admin'].includes(inviterRole)) return res.status(403).json({ error: 'forbidden_role' });

    // upsert user by LOWER(email)
    let uid = null;
    const u = await pool.query(`SELECT id, password FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (u.rowCount){
      uid = u.rows[0].id;
    } else {
      const nu = await pool.query(`INSERT INTO public.users(email) VALUES(LOWER($1)) RETURNING id`, [email]);
      uid = nu.rows[0].id;
    }

    // upsert membership
    await pool.query(`
      INSERT INTO public.user_accounts(user_id, account_id, role)
      VALUES($1,$2,$3)
      ON CONFLICT (user_id, account_id) DO UPDATE SET role=EXCLUDED.role
    `, [uid, accountId, role]);

    // bump seats: seats_total = number of members
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM public.user_accounts WHERE account_id=$1`, [accountId]);
    const n = count.rows[0].n;
    await pool.query(`
      INSERT INTO public.active_subscriptions(account_id, app_code, active_tier, active_seats)
      VALUES($1,'ATEX',1,$2)
      ON CONFLICT (account_id, app_code) DO UPDATE SET active_seats = EXCLUDED.active_seats
    `, [accountId, n]);

    return res.json({ invited: email, role, seats_total: n });
  }catch(e){
    console.error('[POST /accounts/invite] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
