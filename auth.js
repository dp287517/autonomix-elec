// extrait de /auth.js — route POST /signup
router.post('/signup', async (req, res) => {
  try{
    let email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const name = (req.body.name || email.split('@')[0] || 'user').trim(); // fallback pour NOT NULL

    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const ex = await pool.query(`SELECT id, email, password, name FROM public.users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (ex.rowCount){
      const u = ex.rows[0];
      // Si invité (password null), on "claim" le compte: on set password (+ name si manquant)
      if (!u.password){
        const hash = await bcrypt.hash(password, 10);
        await pool.query(`UPDATE public.users SET password=$1, name=COALESCE(name,$2) WHERE id=$3`, [hash, name, u.id]);
        const token = signToken({ email, uid: u.id });
        return res.json({ token });
      }
      return res.status(409).json({ error: 'email_exists' });
    }

    // insert normal: email + name + password
    const hash = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO public.users(email, name, password) VALUES(LOWER($1), $2, $3) RETURNING id`,
      [email, name, hash]
    );
    const uid = ins.rows[0].id;
    const token = signToken({ email, uid });
    return res.json({ token });
  }catch(e){
    console.error('[POST /signup] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});
