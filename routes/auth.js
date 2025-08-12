// auth.js (ajouts)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const USERS_FILE = path.join(__dirname, 'uploads', 'auth-users.json'); // ajuste si besoin
const ensureStore = () => { try{ fs.mkdirSync(path.dirname(USERS_FILE), {recursive:true}); if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]'); }catch{} };
ensureStore();

function loadUsers(){ try{ return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')); } catch{ return []; } }
function saveUsers(arr){ fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2)); }

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// POST /api/register
router.post('/register', async (req, res) => {
  try{
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ error:'Email et mot de passe requis' });
    const users = loadUsers();
    if(users.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(409).json({ error:'Email déjà utilisé' });
    if(String(password).length < 8) return res.status(400).json({ error:'Mot de passe trop court (min 8)' });
    const hash = await bcrypt.hash(password, 10);
    users.push({ email, hash, createdAt: new Date().toISOString() }); saveUsers(users);
    res.json({ success:true });
  }catch(e){ res.status(500).json({ error:'Erreur inscription: '+e.message }); }
});

// POST /api/login (remplacer ta logique fixe si tu veux accepter les comptes créés)
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  // 1) comptes JSON
  const user = loadUsers().find(u=>u.email.toLowerCase()===email.toLowerCase());
  if (user && await bcrypt.compare(password, user.hash)) {
    const token = jwt.sign({ sub: email, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return res.json({ token, user: { email } });
  }

  // 2) fallback éventuel sur variables d'env (compte admin)
  const AUTH_USER = process.env.AUTH_USER || 'admin@autonomix.local';
  const AUTH_PASS = process.env.AUTH_PASS || 'AutonomiX!2025';
  if (email === AUTH_USER && password === AUTH_PASS) {
    const token = jwt.sign({ sub: email, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return res.json({ token, user: { email } });
  }

  res.status(401).json({ error: 'Identifiants incorrects' });
});

// GET /api/me (inchangé)
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
