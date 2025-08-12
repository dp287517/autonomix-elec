// app.js — Serveur principal AutonomiX (fix 404 .html)
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

// ---------- Body size (upload base64 & co) ----------
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ---------- Static folders ----------
// On essaye plusieurs répertoires potentiels (selon ta structure)
const STATIC_DIRS = [
  path.join(__dirname),                 // /opt/render/project/src
  path.join(__dirname, 'public'),       // /opt/render/project/src/public
  path.join(process.cwd()),             // répertoire de travail
];

// Middleware statique pour chacun
for (const dir of STATIC_DIRS) {
  if (fs.existsSync(dir)) {
    app.use(express.static(dir));
  }
}

// Helper pour envoyer un HTML s'il existe quelque part
function sendHtmlIfExists(res, filename) {
  for (const dir of STATIC_DIRS) {
    const full = path.join(dir, filename);
    if (fs.existsSync(full)) return res.sendFile(full);
  }
  console.error(`[STATIC] Fichier introuvable: ${filename} (cherché dans: ${STATIC_DIRS.join(' , ')})`);
  return res.status(404).send(`Not Found: ${filename}`);
}

// ---------- Routers API ----------
let authRouter, atexRouter;
try {
  authRouter = require('./auth'); // auth.js doit être à la racine (même niveau que app.js)
} catch (e) {
  console.error('[BOOT] auth.js introuvable ou invalide:', e.message);
}
try {
  atexRouter = require('./routes/atex'); // routes/atex.js
} catch (e) {
  console.error('[BOOT] routes/atex.js introuvable ou invalide:', e.message);
}

if (authRouter) app.use('/api', authRouter);
if (atexRouter) app.use('/api', atexRouter);

// ---------- Pages HTML "connues" ----------
app.get(['/', '/index', '/index.html', '/login', '/login.html'], (_req, res) => {
  return sendHtmlIfExists(res, 'login.html');
});
app.get(['/dashboard', '/dashboard.html'], (_req, res) => {
  return sendHtmlIfExists(res, 'dashboard.html');
});
app.get(['/atex-control', '/atex-control.html'], (_req, res) => {
  return sendHtmlIfExists(res, 'atex-control.html');
});
app.get(['/atex-risk', '/atex-risk.html'], (_req, res) => {
  return sendHtmlIfExists(res, 'atex-risk.html');
});

// ---------- Healthcheck ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- 404 API uniquement ----------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ---------- Fallback front (évite 404 sur chemins front) ----------
app.get('*', (req, res) => {
  // Si on demande explicitement un .html inconnu → tentative d’envoi
  if (req.path.endsWith('.html')) {
    const file = req.path.replace(/^\//, '');
    return sendHtmlIfExists(res, file);
  }
  // Sinon on renvoie le login par défaut (tu peux mettre dashboard si tu préfères)
  return sendHtmlIfExists(res, 'login.html');
});

// ---------- Global error handler ----------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  if (String(err?.type).includes('entity.too.large') || /request entity too large/i.test(err?.message || '')) {
    return res.status(413).json({ error: 'Payload trop volumineux. Réduisez la taille de l’image/fichier.' });
  }
  res.status(500).json({ error: 'Erreur serveur', detail: err?.message || 'Unknown' });
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AutonomiX] Server up on port ${PORT}`);
  console.log('Static roots:', STATIC_DIRS);
  console.log('HTML -> /login.html, /dashboard.html, /atex-control.html, /atex-risk.html');
  console.log('API  -> /api/... (auth, atex, etc.)');
});
