// routes/accounts_invite.js — invite + liste des membres
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/authz');

/**
 * GET /accounts/members/:appCode?account_id=ID
 */
router.get('/accounts/members/:appCode', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    const accountId = Number(req.query.account_id);
    const appCode = req.params.appCode;
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });

    const m = await pool.query(`
      SELECT u.email, ua.role
      FROM public.user_accounts ua
      JOIN public.users u ON u.id = ua.user_id
      WHERE ua.account_id = $1
      ORDER BY u.email ASC
    `, [accountId]);

    const members = m.rows.map(r => ({ email: r.email, role: r.role, has_seat: true }));
    const seats_total = members.length;

    return res.json({ app: appCode, account_id: accountId, members, seats_total });
  } catch (e) {
    console.error('[GET /accounts/members/:appCode] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /accounts/invite?account_id=ID
 * body: { email, role='member', appCode:'ATEX' }
 */
router.post('/accounts/invite', requireAuth, requireRole('owner','admin'), async (req, res) => {
  try {
    const accountId = Number(req.query.account_id);
    if (!accountId) return res.status(400).json({ error: 'missing_account_id' });
    const email = (req.body.email || '').trim().toLowerCase();
    const role  = (req.body.role  || 'member');

    // Vérifier permission de l'invitant
    const chk = await pool.query(
      `SELECT role FROM public.user_accounts WHERE user_id=$1 AND account_id=$2 LIMIT 1`,
      [ (req.user.uid || req.user.id), accountId ]
    );
    if (!chk.rowCount) return res.status(403).json({ error: 'forbidden_account' });
    if (!['owner','admin'].includes(chk.rows[0].role)) return res.status(403).json({ error: 'forbidden_role' });

    // Upsert user: email + name (name NOT NULL dans ton schéma)
    const displayName = email.split('@')[0]; // simple fallback
    let uid = null;

    const u = await pool.query(`SELECT id, name FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (u.rowCount) {
      uid = u.rows[0].id;
      // Compléter le name s'il est null
      if (!u.rows[0].name) {
        await pool.query(`UPDATE public.users SET name=$2 WHERE id=$1`, [uid, displayName]);
      }
    } else {
      // Insérer en respectant NOT NULL sur name
      const nu = await pool.query(
        `INSERT INTO public.users(email, name) VALUES(LOWER($1), $2) RETURNING id`,
        [email, displayName]
      );
      uid = nu.rows[0].id;
    }

    // Upsert membership
    await pool.query(`
      INSERT INTO public.user_accounts(user_id, account_id, role)
      VALUES($1,$2,$3)
      ON CONFLICT (user_id, account_id) DO UPDATE SET role=EXCLUDED.role
    `, [uid, accountId, role]);

    // sièges = nb de membres (règle simple)
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM public.user_accounts WHERE account_id=$1`, [accountId]);
    const seats_total = c.rows[0].n;

    return res.json({ invited: email, role, seats_total });
  } catch (e) {
    console.error('[POST /accounts/invite] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
