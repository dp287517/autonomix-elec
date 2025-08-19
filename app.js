// app.js — serveur AutonomiX (Express, Render/Neon ready)
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

process.on('uncaughtException', (err) => console.error('❌ Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('❌ Unhandled Rejection:', err));

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// Logs HTTP
app.use(morgan('dev'));

// CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='",
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='",
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg'"
        ],
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='",
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='",
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg'"
        ],
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          "'unsafe-inline'"
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        // ✅ PATCH ICI : on autorise l’aperçu PDF en <iframe>
        "frame-src": ["'self'", "data:", "blob:", "https:"],
        "child-src": ["'self'", "data:", "blob:", "https:"],
        "frame-ancestors": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Perf & parsing
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: true, credentials: true }));

// Static
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Health
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

// /api/me minimal (si token + account_id)
app.get('/api/me', async (req, res) => {
  try {
    const account_id = Number(req.query.account_id || 0) || null;
    const email = process.env.DEMO_EMAIL || 'palhadaniel.elec@gmail.com';
    // Renvoie un objet minimal pour le front
    return res.json({ email, account_id, role: 'owner' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

// Routes API
try {
  const atexRoutes = require('./routes/atex');
  app.use('/api', atexRoutes);
  console.log('✅ Mounted /api (ATEX routes)');
} catch (e) {
  console.error('❌ Impossible de monter ./routes/atex:', e);
}

// Fallback HTML (SPA)
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'atex-control.html'));
});

// 404 API
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// 500 handler
app.use((err, req, res, next) => {
  console.error('💥 API error:', err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ error: 'server_error' });
  }
  next(err);
});

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
