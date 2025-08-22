// routes/neonRouter.js — passerelle Neon (Postgres) avec auth Bearer
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const router = express.Router();

router.use(express.json({ limit: '1mb' }));

// Rate limit léger
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

// Health public
router.get('/health', (_req, res) => res.json({ ok: true }));

// Auth Bearer pour le reste
router.use((req, res, next) => {
  if (req.path === '/health') return next();
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.API_TOKEN || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Connexion Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper: SELECT-only si ALLOW_WRITE ≠ '1'
function isSelectOnly(sql) {
  if (!sql) return false;
  const first = sql.trim().split(/\s+/)[0]?.toLowerCase();
  return first === 'select' || first === 'with';
}

// POST /neon/query { sql, params? }
router.post('/query', async (req, res) => {
  const { sql, params } = req.body || {};
  if (typeof sql !== 'string') {
    return res.status(400).json({ error: "Body invalide: attendu { sql: string, params?: any[] }" });
  }
  if (process.env.ALLOW_WRITE !== '1' && !isSelectOnly(sql)) {
    return res.status(403).json({ error: "Écriture désactivée. Autorisées: requêtes SELECT." });
  }
  try {
    const result = await pool.query(sql, Array.isArray(params) ? params : []);
    res.json({ rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
