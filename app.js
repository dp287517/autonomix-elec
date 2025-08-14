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

// CSP (identique à ta version d’origine)
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
        "frame-src": ["'self'"],
        "frame-ancestors": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Perf & parsing
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====== API ======
// Auth (login/register/me/debug)
try {
  const authRoutes = require('./auth');
  app.use('/api', authRoutes);
  console.log('✅ Mounted /api (auth)');
} catch (e) {
  console.error('❌ Failed to mount ./auth routes:', e);
}

// Compteurs usage
try {
  const usageRoutes = require('./usage');
  app.use('/api/usage', usageRoutes);
  console.log('✅ Mounted /api/usage');
} catch (e) {
  console.warn('⚠️ usage.js not mounted:', e?.message);
}

// Accounts (routes optionnelles)
(() => {
  try {
    const accountsRoutes = require('./routes/accounts');
    app.use('/api', accountsRoutes);
    console.log('✅ Mounted /api (accounts via routes/...)');
  } catch (e1) {
    try {
      const accountsRoutesAlt = require('./accounts');
      app.use('/api', accountsRoutesAlt);
      console.log('✅ Mounted /api (accounts via ./accounts)');
    } catch (e2) {
      console.warn('⚠️ accounts route not mounted:', e2?.message);
    }
  }
})();

// Licenses — lecture du tier/scope (protégé par requireAuth)
(() => {
  try {
    const licensesRoutes = require('./routes/licenses');
    app.use('/api', licensesRoutes);
    console.log('✅ Mounted /api (licenses)');
  } catch (e) {
    console.warn('⚠️ licenses route not mounted:', e?.message);
  }
})();

// Subscriptions — gérer l’abonnement ATEX (owner/admin)
(() => {
  try {
    const subsRoutes = require('./routes/subscriptions');
    app.use('/api', subsRoutes);
    console.log('✅ Mounted /api (subscriptions)');
  } catch (e) {
    console.warn('⚠️ subscriptions route not mounted:', e?.message);
  }
})();

// ATEX (souvent des middlewares stricts) — en dernier
(() => {
  try {
    const atexRoutes = require('./routes/atex');
    app.use('/api', atexRoutes);
    console.log('✅ Mounted /api (atex via routes/...)');
  } catch (e1) {
    try {
      const atexRoutesAlt = require('./atex');
      app.use('/api', atexRoutesAlt);
      console.log('✅ Mounted /api (atex via ./atex)');
    } catch (e2) {
      console.warn('⚠️ atex route not mounted:', e2?.message);
    }
  }
})();

// Healthcheck
app.get('/ping', (req, res) => res.send('pong'));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// 404 JSON pour /api/*
app.use('/api', (req, res, next) => {
  res.status(404).json({ error: 'not_found' });
});

// Handler d’erreurs JSON
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
