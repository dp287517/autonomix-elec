// routes/neonRouter.js — passerelle Neon (Postgres) avec auth Bearer + endpoints GET read-only
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const router = express.Router();

router.use(express.json({ limit: '1mb' }));

// Rate limit léger
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

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

/**
 * --------- GET READ-ONLY ENDPOINTS (pour “mode connecteur”) ----------
 * Auth par token via query ?token=... OU header Authorization: Bearer ...
 * Ces endpoints n'acceptent PAS d'SQL arbitraire => sûrs et cacheables si besoin.
 */

// Petite fonction d’auth : accepte header Bearer OU query ?token=
function checkToken(req) {
  const q = (req.query?.token || '').toString().trim();
  const h = (req.get('authorization') || '').trim();
  const fromHeader = h.startsWith('Bearer ') ? h.slice(7) : '';
  return (process.env.API_TOKEN && (q === process.env.API_TOKEN || fromHeader === process.env.API_TOKEN));
}

// Health public
router.get('/health', (_req, res) => res.json({ ok: true }));

// Dernières safety_actions (lecture seule)
router.get('/safety-actions/latest', async (req, res) => {
  try {
    if (!checkToken(req)) return res.status(401).json({ error: 'Unauthorized' });

    let limit = Number(req.query.limit ?? 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 100) limit = 10;

    const sql = `
      SELECT id, type, description
      FROM public.safety_actions
      ORDER BY id DESC
      LIMIT $1
    `;
    const result = await pool.query(sql, [limit]);
    return res.json({ rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * --------- POST /query (SQL paramétrée) ----------
 * Protégée par header Bearer. Conserve le comportement existant.
 */

// Auth Bearer pour POST /query
router.use((req, res, next) => {
  if (req.method === 'GET') return next(); // GET géré plus haut avec checkToken
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.API_TOKEN || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

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
