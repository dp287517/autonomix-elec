require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const app = express();

// ---------- CORS ----------
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ---------- Body size (upload/base64) ----------
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ---------- Static roots ----------
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
    if (fs.existsSync(full)) return res.sendFile(full);
  }
  return res.status(404).send(`Not Found: ${filename}`);
}

// ---------- Routers API ----------
let authRouter, atexRouter, epdStoreRouter;
try { authRouter = require('./auth'); } catch (e) { console.error('[BOOT] auth.js manquant:', e.message); }
try { atexRouter = require('./routes/atex'); } catch (e) { console.error('[BOOT] routes/atex.js manquant:', e.message); }
try { epdStoreRouter = require('./routes/epdStore'); } catch (e) { console.error('[BOOT] routes/epdStore.js manquant:', e.message); }

if (authRouter) app.use('/api', authRouter);
if (atexRouter) app.use('/api', atexRouter);
if (epdStoreRouter) app.use('/api', epdStoreRouter);

// ---------- Uploads (exposés statiquement) ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- Pages HTML connues ----------
app.get(['/', '/index', '/index.html', '/login', '/login.html'], (_req, res) => sendHtmlIfExists(res, 'login.html'));
app.get(['/dashboard', '/dashboard.html'], (_req, res) => sendHtmlIfExists(res, 'dashboard.html'));
app.get(['/atex-control', '/atex-control.html'], (_req, res) => sendHtmlIfExists(res, 'atex-control.html'));
app.get(['/atex-risk', '/atex-risk.html'], (_req, res) => sendHtmlIfExists(res, 'atex-risk.html'));
app.get(['/epd', '/epd.html'], (_req, res) => sendHtmlIfExists(res, 'epd.html'));

// ---------- Healthcheck ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- 404 API ----------
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

// ---------- Fallback front ----------
app.get('*', (req, res) => {
  if (req.path.endsWith('.html')) {
    const file = req.path.replace(/^\//, '');
    return sendHtmlIfExists(res, file);
  }
  return sendHtmlIfExists(res, 'login.html');
});

// ---------- Global error ----------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  if (String(err?.type).includes('entity.too.large') || /request entity too large/i.test(err?.message || '')) {
    return res.status(413).json({ error: 'Payload trop volumineux. Réduisez la taille.' });
  }
  res.status(500).json({ error: 'Erreur serveur', detail: err?.message || 'Unknown' });
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AutonomiX] Server up on port ${PORT}`);
  console.log('Static roots:', STATIC_DIRS);
  console.log('HTML -> /login.html, /dashboard.html, /atex-control.html, /atex-risk.html, /epd.html');
  console.log('API  -> /api/... (auth, atex, epdStore)');
});
