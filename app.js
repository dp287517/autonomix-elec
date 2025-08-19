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

// CSP (patch: autoriser PDF en iframe via data:/blob:/https: + hash inline EPD)
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
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg'",
          // ✅ hash du NOUVEAU script inline (guard EPD multi-clés)
          'sha256-dgFlJLGuSetG4Ib7uL23SCpXN69n6VqYAJ42Nlgggag='
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
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg'",
          // ✅ idem pour <script> du DOM
          'sha256-dgFlJLGuSetG4Ib7uL23SCpXN69n6VqYAJ42Nlgggag='
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
        // ✅ PATCH IFRAME PDF
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
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====== API ======

// (optionnel) /api/me minimal pour le front ATEX si ton auth ne le fournit pas
app.get('/api/me', (req, res) => {
  const account_id = Number(req.query.account_id || 0) || null;
  const email = process.env.DEMO_EMAIL || 'palhadaniel.elec@gmail.com';
  return res.json({ email, account_id, role: 'owner' });
});

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

// Accounts
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

// Licenses
(() => {
  try {
    const licensesRoutes = require('./routes/licenses');
    app.use('/api', licensesRoutes);
    console.log('✅ Mounted /api (licenses)');
  } catch (e) {
    console.warn('⚠️ licenses route not mounted:', e?.message);
  }
})();

// Subscriptions
(() => {
  try {
    const subsRoutes = require('./routes/subscriptions');
    app.use('/api', subsRoutes);
    console.log('✅ Mounted /api (subscriptions)');
  } catch (e) {
    console.warn('⚠️ subscriptions route not mounted:', e?.message);
  }
})();

// Invitations (members & seats)
(() => {
  try {
    const inviteRoutes = require('./routes/accounts_invite');
    app.use('/api', inviteRoutes);
    console.log('✅ Mounted /api (accounts_invite)');
  } catch (e) {
    console.warn('⚠️ accounts_invite route not mounted:', e?.message);
  }
})();

// ATEX — en dernier
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

// ✅ [AJOUT] EPD: montage du routeur /api/epd* et /api/upload
(() => {
  try {
    const epdStoreRoutes = require('./routes/epdStore');
    app.use('/api', epdStoreRoutes);
    console.log('✅ Mounted /api (epdStore via routes/epdStore)');
  } catch (e1) {
    try {
      const epdStoreRoutesAlt = require('./epdStore');
      app.use('/api', epdStoreRoutesAlt);
      console.log('✅ Mounted /api (epdStore via ./epdStore)');
    } catch (e2) {
      console.warn('⚠️ epdStore route not mounted:', e2?.message);
    }
  }
})();

// Healthcheck
app.get('/ping', (_req, res) => res.send('pong'));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// ✅ [AJOUT] Servir les fichiers uploadés (thumbnails/pièces jointes)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 404 JSON pour /api/*
app.use('/api', (_req, res) => {
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
