// app.js (hardened) — robust startup with guarded requires and better logs
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
});

dotenv.config();
const app = express();
app.use(morgan('dev'));

// CSP (identique à ta version)
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

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== API =====
// AUTH (must load first)
try {
  const authRoutes = require('./auth');
  app.use('/api', authRoutes);
  console.log('✅ Mounted /api (auth)');
} catch (e) {
  console.error('❌ Failed to mount ./auth routes:', e);
}

// ACCOUNTS (optional)
try {
  const accountsRoutes = require('./routes/accounts');
  app.use('/api', accountsRoutes);
  console.log('✅ Mounted /api (accounts)');
} catch (e) {
  console.warn('⚠️ routes/accounts.js not mounted:', e?.message);
}

// ATEX (may have strict middlewares; load last)
try {
  const atexRoutes = require('./routes/atex');
  app.use('/api', atexRoutes);
  console.log('✅ Mounted /api (atex)');
} catch (e) {
  console.warn('⚠️ routes/atex.js not mounted:', e?.message);
}

// Static
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => res.send('pong'));

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
