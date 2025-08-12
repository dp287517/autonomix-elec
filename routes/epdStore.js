// main/routes/epdStore.js — version robuste avec auth optionnelle
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../config/db');

// 🔐 Auth middleware (robuste / optionnel)
let requireAuth = (_req, _res, next) => next();
try {
  const auth = require('../auth');
  const candidate =
    (auth && typeof auth.requireAuth === 'function' && auth.requireAuth) ||
    (typeof auth === 'function' && auth);
  if (typeof candidate === 'function') requireAuth = candidate;
  else console.warn('[epdStore] Module auth trouvé mais sans middleware `requireAuth` fonctionnel. Routes non protégées (dev).');
} catch {
  console.warn('[epdStore] Module auth absent. Routes non protégées (dev).');
}
router.use(requireAuth);

// ====== DB bootstrap
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_epd_docs (
      id SERIAL PRIMARY KEY,
      title VARCHAR(150),
      status VARCHAR(20) DEFAULT 'Brouillon',
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_epd_updated ON atex_epd_docs(updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_epd_status ON atex_epd_docs(status);`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_epd()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_updated_at_epd') THEN
        CREATE TRIGGER trig_updated_at_epd
        BEFORE UPDATE ON atex_epd_docs
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_epd();
      END IF;
    END;
    $$;
  `);
}

// ====== Upload pièces jointes
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const out = (req.files || []).map(f => ({
      name: f.originalname, type: f.mimetype, size: f.size,
      url: `/uploads/${path.basename(f.path)}`
    }));
    res.json(out);
  } catch {
    res.status(500).json({ error: 'upload_failed' });
  }
});

// ====== CRUD EPD
router.get('/epd', async (req, res, next) => {
  try {
    await ensureTable();
    const { status, q, limit = 50, offset = 0 } = req.query;
    const params = [];
    const where = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(title ILIKE $${params.length} OR CAST(payload AS TEXT) ILIKE $${params.length})`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    params.push(offset);
    const sql = `
      SELECT id, title, status, created_at, updated_at
      FROM atex_epd_docs
      ${w}
      ORDER BY updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/epd', async (req, res, next) => {
  try {
    await ensureTable();
    const { title = 'EPD', status = 'Brouillon', payload = {} } = req.body || {};
    const r = await pool.query(
      `INSERT INTO atex_epd_docs (title, status, payload)
       VALUES ($1,$2,$3) RETURNING *`,
      [title, status, payload]
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`SELECT * FROM atex_epd_docs WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.put('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const { title, status, payload } = req.body || {};
    const fields = [];
    const params = [];
    if (title !== undefined) { params.push(title); fields.push(`title = $${params.length}`); }
    if (status !== undefined) { params.push(status); fields.push(`status = $${params.length}`); }
    if (payload !== undefined) { params.push(payload); fields.push(`payload = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE atex_epd_docs SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch('/epd/:id/status', async (req, res, next) => {
  try {
    await ensureTable();
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status_required' });
    const r = await pool.query(
      `UPDATE atex_epd_docs SET status=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.delete('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`DELETE FROM atex_epd_docs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { next(e); }
});

module.exports = router;
