// app.js

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
 * - Autorise JS local ('self') + CDN (unpkg, jsdelivr, cdnjs)
 * - Autorise tes 5 scripts inline via leurs SHA-256 (fournis par la console)
 *   • atex-control.html (script #1 dans <head>)
 *   • atex-control.html (script #2 en bas de page)
 *   • login.html (inline)
 *   • signup.html (inline)
 *   • dashboard.html (inline)
 *
 * ⚠️ Si tu modifies l’un de ces scripts inline (même un espace), le hash change :
 *     remets à jour la valeur correspondante ci-dessous.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // JS général (incl. inline/workers)
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          // inline hashes
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='", // atex-control.html (head) 
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='", // atex-control.html (bas)  
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='", // login.html (inline)
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='", // signup.html (inline)
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg='"  // dashboard.html (inline)
        ],
        // JS dans <script src=...> (Chrome applique aussi aux inline → on répète les hashes)
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='",
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='",
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg='"
        ],
        // CSS (Bootstrap) + Google Fonts
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          // garde si nécessaire (Bootstrap peut injecter des styles dynamiques)
          "'unsafe-inline'"
        ],
        // Polices
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        // Images locales + base64 + blob (tu en utilises côté front)
        "img-src": ["'self'", "data:", "blob:"],
        // Appels XHR/fetch
        "connect-src": ["'self'"],
        // Iframes (strict)
        "frame-src": ["'self'"],
        // Anti-embed
        "frame-ancestors": ["'self'"]
      }
    },
    // Laisse à false si tu as des viewers/iframes sans COEP complet
    crossOriginEmbedderPolicy: false,
  })
);

// Compression, CORS, parsers
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== API =====
/**
 * Routes ATEX disponibles sous /api (GET/POST équipements, etc.)
 * Cf. router Express qui répond déjà sous ce préfixe. 
 */
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes);

// Auth (login/register/me) — fichier auth.js à la racine du projet
// Monte aussi sous /api pour avoir /api/login, /api/register, /api/me
try {
  const authRoutes = require('./auth');
  app.use('/api', authRoutes);
} catch (e) {
  console.warn('⚠️ auth.js introuvable ou non monté. /api/login et /api/me renverront 404 si absent.');
}

// ===== Statique =====
// Sert tout le contenu de ./public (ex.: /js/dashboard.js, /login.html, /dashboard.html)
app.use(express.static(path.join(__dirname, 'public'))); // 

// Santé
app.get('/ping', (req, res) => res.send('pong'));

// Démarrage
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
