const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const { pool } = require('../config/db');
const initDb = require('../config/initDb');
const atexRouter = require('../routes/atex');

const app = express();

// Security & perf
app.use(helmet());
app.use(compression());

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN }));

// Body parsers
const BODY_LIMIT = process.env.BODY_LIMIT || '5mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Logging
app.use(morgan('dev'));

// Static
app.use(express.static(path.join(__dirname, '..', 'public')));

// Attach pool for legacy middlewares if needed
app.locals.pool = pool;

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// API routes
app.use('/api', (req, res, next) => { req.pool = pool; next(); }, atexRouter);

// Entrypoints
app.get('/atex-control', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'atex-control.html'));
});

// Initialize DB then start server
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await initDb(pool);
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error('DB init failed', e);
    process.exit(1);
  }
})();

module.exports = app;
