// auth.js (A LA RACINE DU PROJET)
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const router = express.Router();

// ---------- CONFIG ----------
const USERS_FILE = path.join(process.cwd(), 'uploads', 'auth-users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const AUTH_USER = process.env.AUTH_USER || 'admin@autonomix.local';
const AUTH_PASS = process.env.AUTH_PASS || 'AutonomiX!2025';

// ---------- STORE FICHIER ----------
function ensureStore() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
}
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list || [], null, 2), 'utf8');
}
ensureStore();

// ---------- ROUTES ----------
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min 8)' });

    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    const hash = await bcrypt.hash(password, 10);
    users.push({ email, hash, createdAt: new Date().toISOString() });
    saveUsers(users);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur inscription: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    // Comptes "inscrits"
    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
    if (user && await bcrypt.compare(password, user.hash)) {
      const token = jwt.sign({ sub: email, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      return res.json({ token, user: { email } });
    }

    // Fallback admin par variables d'env
    if (email === AUTH_USER && password === AUTH_PASS) {
      const token = jwt.sign({ sub: email, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      return res.json({ token, user: { email } });
    }

    res.status(401).json({ error: 'Identifiants incorrects' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur login: ' + e.message });
  }
});

router.get('/me', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, user: { email: payload.sub } });
  } catch {
    res.status(401).json({ error: 'Session invalide/expirée' });
  }
});

module.exports = router;
