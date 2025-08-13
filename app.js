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

// Initialisation de l'app
const app = express();

// Logs HTTP
app.use(morgan('dev'));

// 🔐 Helmet avec CSP configurée pour tes besoins (CDN + inline hashes)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Scripts autorisés :
        // - self (fichiers locaux)
        // - unpkg (Lucide) + jsdelivr (Bootstrap)
        // - 2 scripts inline identifiés par leurs hashes (vus dans la console)
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='"
        ],
        // Précaution : certains navigateurs distinguent les balises <script src=...>
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net"
        ],

        // Styles : Bootstrap CSS + Google Fonts (Poppins) utilisés dans atex-control.html
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          // Optionnel : tu peux retirer 'unsafe-inline' si tout fonctionne sans
          "'unsafe-inline'"
        ],

        // Polices : Google Fonts
        "font-src": [
          "'self'",
          "https://fonts.gstatic.com",
          "data:"
        ],

        // Images locales + data: + blob: (tu utilises des images base64 côté front)
        "img-src": [
          "'self'",
          "data:",
          "blob:"
        ],

        // Appels XHR/fetch vers la même origine (API /api/*)
        "connect-src": [
          "'self'"
        ],

        // Iframes si un jour tu intègres des viewers (ici on reste strict)
        "frame-src": [
          "'self'"
        ],

        // Empêche l’embed du site ailleurs
        "frame-ancestors": ["'self'"]
      }
    },

    // Selon les besoins de viewers/Workers, tu peux désactiver COEP strict
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

// Fichiers statiques (public/)
app.use(express.static(path.join(__dirname, 'public')));

// Route de test
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
