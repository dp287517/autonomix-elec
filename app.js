// app.js — Serveur principal AutonomiX
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

// ---- Création app ----
const app = express();

// ---- Sécurité / CORS ----
app.use(cors({
  origin: '*', // ajuste si besoin (ex: ['https://ton-domaine'])
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ---- Tailles de payload (corrige "request entity too large") ----
// Monte si tu veux accepter de grosses images base64
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ---- Statique ----
// Sert les fichiers HTML/CSS/JS à la racine du projet (login.html, dashboard.html, atex-control.html, etc.)
app.use(express.static(path.join(__dirname)));

// Optionnel: un dossier public si tu en as un
// app.use('/public', express.static(path.join(__dirname, 'public')));

// ---- Routers API ----
// IMPORTANT : auth.js doit être au même niveau que app.js
let authRouter;
try {
  authRouter = require('./auth');
} catch (e) {
  console.error('[BOOT] auth.js introuvable ou invalide:', e.message);
  // on continue quand même pour ne pas planter le boot
}
let atexRouter;
try {
  atexRouter = require('./routes/atex');
} catch (e) {
  console.error('[BOOT] routes/atex.js introuvable ou invalide:', e.message);
}

// Monte les routes sous /api
if (authRouter) app.use('/api', authRouter);
if (atexRouter) app.use('/api', atexRouter);

// ---- Routes de confort (HTML) ----

// Page d’accueil -> redirige vers login (le front gère le token et peut renvoyer vers dashboard)
app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Route de fallback pour les fichiers front connus
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.get('/atex-control', (_req, res) => {
  res.sendFile(path.join(__dirname, 'atex-control.html'));
});
app.get('/atex-risk', (_req, res) => {
  res.sendFile(path.join(__dirname, 'atex-risk.html'));
});

// ---- Healthcheck ----
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---- 404 API ----
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ---- Gestion erreurs globale ----
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  // Cas fréquent: payload trop gros
  if (String(err?.type).includes('entity.too.large') || /request entity too large/i.test(err?.message || '')) {
    return res.status(413).json({ error: 'Payload trop volumineux. Réduis la taille de l’image ou compresse le fichier.' });
  }
  res.status(500).json({ error: 'Erreur serveur', detail: err?.message || 'Unknown' });
});

// ---- Lancement ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AutonomiX] Server up on port ${PORT}`);
  console.log('HTML -> /login.html, /dashboard.html, /atex-control.html');
  console.log('API  -> /api/... (auth, atex, etc.)');
});
