// app.js

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// Chargement tolérant de la connexion DB
let pool;
try {
  ({ pool } = require('./config/db')); // si db.js est dans config/
} catch (err) {
  console.warn('⚠️ Fichier config/db.js introuvable, tentative de chargement direct depuis la racine…');
  ({ pool } = require('./db')); // si db.js est à la racine du projet
}

const app = express();

// Logs HTTP
app.use(morgan('dev'));

// 🔐 Helmet avec CSP qui autorise :
// - scripts locaux ('self')
// - CDN: unpkg (Lucide) & jsdelivr (Bootstrap)
// - 2 scripts inline via leurs hashes (ligne 9 et ~562 de atex-control.html)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Pour tout JS (incl. inline, workers…)
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          // hashes EXACTS de tes deux scripts inline
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='"
        ],

        // Très important : même règles pour les <script> éléments (sinon Chrome bloque l'inline)
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          // ➜ ajouter aussi les HASHES ici
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='"
        ],

        // CSS (Bootstrap) + Google Fonts utilisés par la page
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          // Tu peux tenter de retirer 'unsafe-inline' si tout marche sans
          "'unsafe-inline'"
        ],

        // Polices (Google Fonts)
        "font-src": [
          "'self'",
          "https://fonts.gstatic.com",
          "data:"
        ],

        // Images locales + base64 + blob (tu utilises du base64 côté front)
        "img-src": [
          "'self'",
          "data:",
          "blob:"
        ],

        // fetch/XHR vers ton API même origine
        "connect-src": [
          "'self'"
        ],

        // Si tu n’embarques rien en iframe, reste strict
        "frame-src": ["'self'"],

        // Évite l’embed du site ailleurs
        "frame-ancestors": ["'self'"]
      }
    },

    // Laisse à false si tu affiches des PDFs/images/ifames sans COEP complet
    crossOriginEmbedderPolicy: false,
  })
);

// Compression & CORS
app.use(compression());
app.use(cors());

// Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes API
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes);

// Fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Route de test
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Lancement
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
