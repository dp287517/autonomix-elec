
// main/routes/epdStore.js
// API EPD (DRPCE) — Postgres (Neon) avec auto-provision (ensureTable)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

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
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trig_updated_at_epd'
      ) THEN
        CREATE TRIGGER trig_updated_at_epd
        BEFORE UPDATE ON atex_epd_docs
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_epd();
      END IF;
    END;
    $$;
  `);
}

// GET /api/epd?status=&q=&limit=&offset=
router.get('/epd', async (req, res, next) => {
  try {
    await ensureTable();
    const { status, q, limit = 50, offset = 0 } = req.query;
    const params = [];
    const where = [];

    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(title ILIKE $${params.length} OR CAST(payload AS TEXT) ILIKE $${params.length})`);
    }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit); params.push(offset);
    const sql = `
      SELECT id, title, status, created_at, updated_at
      FROM atex_epd_docs
      ${w}
      ORDER BY updated_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length};
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// POST /api/epd  { title, status?, payload }
router.post('/epd', async (req, res, next) => {
  try {
    await ensureTable();
    const { title = 'EPD', status = 'Brouillon', payload } = req.body || {};
    if (!payload) return res.status(400).json({ error: 'payload_required' });
    const r = await pool.query(
      `INSERT INTO atex_epd_docs (title, status, payload)
       VALUES ($1,$2,$3) RETURNING *`,
      [title, status, payload]
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// GET /api/epd/:id
router.get('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`SELECT * FROM atex_epd_docs WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// PUT /api/epd/:id  { title?, status?, payload? }
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

// PATCH /api/epd/:id/status  { status }
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

// DELETE /api/epd/:id
router.delete('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`DELETE FROM atex_epd_docs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { next(e); }
});

module.exports = router;
