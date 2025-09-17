// app.js — App (Express) v7, adapté pour ATEX dashboard
const express = require('express');
const path = require('path');
const cors = require('cors');
const { pool } = require('./config/db'); // Si tu as config/db.js
const initDb = require('./initDb'); // Init DB schema

const app = express();
const PORT = process.env.PORT || 3000;

// Init DB au boot
initDb(pool).catch(err => console.error('[initDb] error', err));

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static /public (pour dashboards HTML/JS)
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// API routes
app.use('/api', require('./routes/auth')); // Auth (signup, login, me) - Assumez que ce fichier existe
app.use('/api', require('./routes/accounts')); // Accounts (create, owners, invite) - Assumez que ce fichier existe
app.use('/api', require('./routes/atex')); // ATEX (secteurs, equipments, inspect, chat, etc.)

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// SPA fallback pour dashboards (ex. /atex-control -> public/atex-control.html)
const SPA_INDEX = new Set(['/dashboard', '/atex-control', '/subscription_atex']);
app.get('*', (req, res, next) => {
  if (SPA_INDEX.has(req.path)) {
    const file = req.path.replace(/^\//, '') + '.html';
    return res.sendFile(path.join(PUBLIC_DIR, file), (err) => {
      if (err) next();
    });
  }
  next();
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Boot
app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
});

module.exports = app;
