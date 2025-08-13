// app.js

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// Chargement tolérant de la connexion DB (selon où est ton fichier db.js)
let pool;
try {
  ({ pool } = require('./config/db'));
} catch (err) {
  console.warn('⚠️ Fichier config/db.js introuvable, tentative de chargement depuis la racine…');
  try { ({ pool } = require('./db')); } catch {}
}

const app = express();

// Logs
app.use(morgan('dev'));

// 🔐 Helmet + CSP : autorise self + unpkg + jsdelivr + cdnjs
// + 3 hashes d’inline scripts (2 dans atex-control.html, 1 dans login.html)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // JS via <script> (incl. inline/workers)
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          // atex-control.html (head)
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          // atex-control.html (bas de page)
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          // login.html (inline au bas de la page)
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='"
        ],

        // JS via <script src=...> (Chrome applique aussi aux inline, donc on remet les hashes ici)
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='"
        ],

        // CSS: Bootstrap + Google Fonts (si utilisés)
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          // tu peux tenter de retirer 'unsafe-inline' si tout fonctionne sans
          "'unsafe-inline'"
        ],

        // Polices
        "font-src": [
          "'self'",
          "https://fonts.gstatic.com",
          "data:"
        ],

        // Images locales + base64 + blob
        "img-src": [
          "'self'",
          "data:",
          "blob:"
        ],

        // XHR/fetch
        "connect-src": ["'self'"],

        // Iframes si besoin (on reste strict)
        "frame-src": ["'self'"],

        // Anti-embed
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

// API routes
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes);

// 🔐 Auth API (login/register/me) — nécessaire pour login.html
const authRoutes = require('./auth');
app.use('/api', authRoutes);

// Fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Santé
app.get('/ping', (req, res) => res.send('pong'));

// Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
