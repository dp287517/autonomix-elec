// app.js — App (Express) v7
// - CORS, JSON
// - Static /public
// - API: /api (accounts, atex, etc.)
// - SPA fallback pour /dashboard et /atex-control

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares de base
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// API
try {
  app.use('/api', require('./routes/accounts'));
} catch {}
try {
  app.use('/api', require('./routes/atex'));
} catch {}
try {
  app.use('/api', require('./routes/entitlements'));
} catch {}
try {
  app.use('/api', require('./routes/auth'));
} catch {}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// SPA fallback — permet d'ouvrir directement les pages déclarées en front
const SPA_INDEX = new Set(['/dashboard', '/atex-control']);
app.get('*', (req, res, next) => {
  if (SPA_INDEX.has(req.path)) {
    // renvoie le fichier HTML correspondant si présent dans /public
    const file = req.path.replace(/^\//, '') + '.html';
    return res.sendFile(path.join(PUBLIC_DIR, file), (err) => {
      if (err) next(); // si pas trouvé, continuer vers 404
    });
  }
  next();
});

// 404 API & static
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Boot
app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
});

module.exports = app;
