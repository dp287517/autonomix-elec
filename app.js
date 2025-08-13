require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// ---- App ----
const app = express();

// ---- Trust proxy (Render/Heroku/Vercel, etc.) ----
app.set('trust proxy', 1);

// ---- CORS ----
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',').map(s=>s.trim()).filter(Boolean) || '*',
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ---- Body size (uploads/base64) ----
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ---- Static roots ----
const STATIC_DIRS = [
  path.join(__dirname),
  path.join(__dirname, 'public'),
  path.join(process.cwd()),
];
for (const dir of STATIC_DIRS) {
  if (fs.existsSync(dir)) app.use(express.static(dir));
}

// Helper pour renvoyer un HTML s'il existe
function sendHtmlIfExists(res, filename) {
  for (const dir of STATIC_DIRS) {
    const full = path.join(dir, filename);
    if (fs.exists(full)) return res.sendFile(full);
  }
  return res.status(404).send(`Not Found: ${filename}`);
}

// ---- Database (Pool + init) ----
const { initDb } = require('./config/initDb');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000)
});

// Expose pool aux routers si besoin (req.app.locals.pool)
app.locals.pool = pool;

// ---- Routers API ----
let authRouter, atexRouter, epdStoreRouter;
try { authRouter = require('./auth'); } catch (e) { console.warn('[BOOT] auth.js manquant:', e.message); }
try { atexRouter = require('./routes/atex'); } catch (e) { console.warn('[BOOT] routes/atex.js manquant:', e.message); }
try { epdStoreRouter = require('./routes/epdStore'); } catch (e) { console.warn('[BOOT] routes/epdStore.js manquant:', e.message); }

if (authRouter) app.use('/api', authRouter);
if (atexRouter) app.use('/api', atexRouter);
if (epdStoreRouter) app.use('/api', epdStoreRouter);

// ---- Uploads (exposés statiquement) ----
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- Pages HTML connues ----
app.get(['/', '/index', '/index.html', '/login', '/login.html'], (_req, res) => sendHtmlIfExists(res, 'login.html'));
app.get(['/dashboard', '/dashboard.html'], (_req, res) => sendHtmlIfExists(res, 'dashboard.html'));
app.get(['/atex-control', '/atex-control.html'], (_req, res) => sendHtmlIfExists(res, 'atex-control.html'));
app.get(['/atex-risk', '/atex-risk.html'], (_req, res) => sendHtmlIfExists(res, 'atex-risk.html'));
app.get(['/epd', '/epd.html'], (_req, res) => sendHtmlIfExists(res, 'epd.html'));

// ---- Healthcheck ----
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---- 404 API ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

// ---- Fallback front ----
app.get('*', (req, res) => {
  if (req.path.endsWith('.html')) {
    const file = req.path.replace(/^\//, '');
    return sendHtmlIfExists(res, file);
  }
  return sendHtmlIfExists(res, 'login.html');
});

// ---- Global error ----
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  if (String(err?.type).includes('entity.too.large') || /request entity too large/i.test(err?.message || '')) {
    return res.status(413).json({ error: 'Payload trop volumineux. Réduisez la taille.' });
  }
  res.status(500).json({ error: 'Erreur serveur', detail: err?.message || 'Unknown' });
});

// ---- Start (DB init puis listen) ----
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    // initDb accepte un pool en argument (ou utilisera sa config interne si non fourni)
    await initDb(pool);
    app.listen(PORT, () => {
      console.log(`[AutonomiX] Server up on port ${PORT}`);
      console.log('Static roots:', STATIC_DIRS);
      console.log('HTML -> /login.html, /dashboard.html, /atex-control.html, /atex-risk.html, /epd.html');
      console.log('API  -> /api/... (auth, atex, epdStore)');
    });
  } catch (err) {
    console.error('[BOOT] initDb failed:', err);
    process.exit(1);
  }
})();

// ---- Graceful shutdown ----
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  try { await pool.end(); } catch (_) {}
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  try { await pool.end(); } catch (_) {}
  process.exit(0);
});
