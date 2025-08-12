// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ⚙️ Identifiants par défaut (tu peux mettre ça en variables d'env)
const AUTH_USER = process.env.AUTH_USER || 'admin@autonomix.local';
const AUTH_PASS = process.env.AUTH_PASS || 'AutonomiX!2025';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// POST /api/login { email, password }
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  if (email !== AUTH_USER || password !== AUTH_PASS) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = jwt.sign({ sub: email, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { email } });
});

// GET /api/me   (vérifie le token transmis dans l’en-tête Authorization: Bearer ...)
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
