// routes/epdStore.js — CRUD + upload + build (aligné sur authz)
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../config/db');

// ===== Auth cohérente avec le reste de l'app =====
let { requireAuth } = (() => {
  try { return require('../middleware/authz'); } catch { return {}; }
})();
if (typeof requireAuth !== 'function') {
  // fallback no-op (dev)
  requireAuth = (_req, _res, next) => next();
}

// Licence (optionnelle) — si absente => no-op
let requireLicense = (_app, _tier) => (_req, _res, next) => next();
try {
  const ent = require('../middleware/entitlements');
  if (ent && typeof ent.requireLicense === 'function') {
    requireLicense = ent.requireLicense;
  }
} catch { /* no-op */ }

// Tous les endpoints EPD exigent auth; licence ATEX tier>=2 si dispo
router.use(requireAuth, requireLicense('ATEX', 2));

// ====== Schema & helpers ======
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
      NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW;
    END; $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_updated_at_epd') THEN
        CREATE TRIGGER trig_updated_at_epd
        BEFORE UPDATE ON atex_epd_docs
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_epd();
      END IF;
    END; $$;
  `);
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ====== Upload (accepte "file" et "files") ======
router.post('/upload', (req, res, next) => {
  const mw = upload.fields([{ name: 'file', maxCount: 10 }, { name: 'files', maxCount: 10 }]);
  mw(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'upload_failed', detail: err?.message });
    const merged = [
      ...((req.files && req.files.file) || []),
      ...((req.files && req.files.files) || [])
    ];
    const out = merged.map(f => ({
      name: f.originalname, type: f.mimetype, size: f.size,
      url: `/uploads/${path.basename(f.path)}`
    }));
    res.json(out);
  });
});

// ====== CRUD ======

// LIST
router.get('/epd', async (_req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`
      SELECT id, title, status, created_at, updated_at
      FROM atex_epd_docs
      ORDER BY updated_at DESC
      LIMIT 200
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// CREATE
router.post('/epd', async (req, res, next) => {
  try {
    await ensureTable();
    const { title = 'EPD', status = 'Brouillon', payload = {}, name } = req.body || {};
    const r = await pool.query(
      `INSERT INTO atex_epd_docs(title, status, payload)
       VALUES($1,$2,$3) RETURNING *`,
      [name || title, status, payload]
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// READ
router.get('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`SELECT * FROM atex_epd_docs WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// UPDATE (PUT)
router.put('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const { title, status, payload } = req.body || {};
    const fields = []; const params = [];
    if (title  !== undefined) { params.push(title);  fields.push(`title=$${params.length}`); }
    if (status !== undefined) { params.push(status); fields.push(`status=$${params.length}`); }
    if (payload!== undefined) { params.push(payload);fields.push(`payload=$${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE atex_epd_docs SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// UPDATE (PATCH) — utilisé par le front
router.patch('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const { title, status, payload, ...rest } = req.body || {};
    const cur  = await pool.query(`SELECT payload FROM atex_epd_docs WHERE id=$1`, [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'not_found' });

    const merged = Object.assign({}, cur.rows[0].payload || {}, payload || {}, rest);
    const fields = []; const params = [];
    if (title  !== undefined) { params.push(title);  fields.push(`title=$${params.length}`); }
    if (status !== undefined) { params.push(status); fields.push(`status=$${params.length}`); }
    params.push(merged); fields.push(`payload=$${params.length}`);
    params.push(req.params.id);

    const r = await pool.query(
      `UPDATE atex_epd_docs SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// DELETE
router.delete('/epd/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`DELETE FROM atex_epd_docs WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { next(e); }
});

// ====== Build ======
router.post('/epd/:id/build', async (req, res, next) => {
  try {
    await ensureTable();
    const r0 = await pool.query(`SELECT * FROM atex_epd_docs WHERE id=$1`, [req.params.id]);
    if (!r0.rows[0]) return res.status(404).json({ error: 'not_found' });
    await pool.query(`UPDATE atex_epd_docs SET status='Generation', updated_at=NOW() WHERE id=$1`, [req.params.id]);

    const p = r0.rows[0].payload || {};
    const html = `
      <h2>EPD #${r0.rows[0].id} — ${r0.rows[0].title || 'EPD'}</h2>
      <p><strong>Contexte:</strong> ${escapeHtml(p.context || '')}</p>
      <p><strong>Zones:</strong> type=${escapeHtml(p.zone_type||'')} gaz=${escapeHtml(p.zone_gaz||'')} poussières=${escapeHtml(p.zone_poussiere||'')}</p>
      <p><em>(contenu généré — stub)</em></p>
    `;

    await pool.query(`UPDATE atex_epd_docs SET status='Généré', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, html });
  } catch (e) { next(e); }
});

// Status
router.get('/epd/:id/status', async (req, res, next) => {
  try {
    await ensureTable();
    const r = await pool.query(`SELECT id, status, updated_at FROM atex_epd_docs WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// ===== Utils =====
function escapeHtml (s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

module.exports = router;
