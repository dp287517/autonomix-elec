// app.js

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Chargement tolérant de la connexion DB
let pool;
try {
  ({ pool } = require('./config/db')); // si db.js est dans config/
} catch (err) {
  console.warn('⚠️ Fichier config/db.js introuvable, tentative de chargement direct depuis la racine…');
  ({ pool } = require('./db')); // si db.js est à la racine du projet
}

const path = require('path');

// Initialisation de l'app
const app = express();

// Middlewares
app.use(morgan('dev'));
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes);

// Fichiers statiques
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
