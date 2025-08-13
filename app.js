// app.js (fix ordre des routes: AUTH avant ATEX)

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// Logs
app.use(morgan('dev'));

/**
 * 🔐 Content-Security-Policy
 * (inchangé)
 */
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

// Compression, CORS, parsers
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== API =====
// ⚠️ IMPORTANT: Monter AUTH AVANT toute route qui exige requireAuth (ex. ATEX)
try {
  const authRoutes = require('./auth'); // /api/register, /api/login, /api/me
  app.use('/api', authRoutes);
} catch (e) {
  console.warn('⚠️ auth.js introuvable ou non monté. /api/login et /api/me renverront 404 si absent.');
}

// Routes comptes/membres
try {
  const accountsRoutes = require('./routes/accounts');
  app.use('/api', accountsRoutes);
} catch (e) {
  console.warn('⚠️ routes/accounts.js introuvable ou non monté. /api/accounts indisponible.');
}

/**
 * Routes ATEX disponibles sous /api
 * La nouvelle version de routes/atex.js utilise requireAuth au niveau du router.
 * Donc il faut que les routes AUTH ci-dessus soient montées AVANT.
 */
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes);

// ===== Statique =====
app.use(express.static(path.join(__dirname, 'public')));

// Santé
app.get('/ping', (req, res) => res.send('pong'));

// Démarrage
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
