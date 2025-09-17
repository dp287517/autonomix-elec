// app.js — App (Express) v7, adapté pour ATEX dashboard
const express = require('express');
const path = require('path');
const cors = require('cors');
const { pool } = require('./config/db');
const initDb = require('./initDb');

const app = express();
const PORT = process.env.PORT || 3000;

// Init DB
initDb(pool).catch(err => console.error('[initDb] error', err));

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static /public
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// API routes
app.use('/api', require('./routes/auth')); // Assumez que ce fichier existe
app.use('/api', require('./routes/accounts')); // Assumez que ce fichier existe
app.use('/api', require('./routes/atex'));

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// SPA fallback
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
