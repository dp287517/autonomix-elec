// app.js — Autonomix Elec (Express)
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

// ===== Logs / perf / parsers =====
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== CSP (compatible avec tes pages/CDN) =====
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "script-src-elem": ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        "style-src-elem": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'self'"],
        "object-src": ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ===== CORS (utile si tu prévisualises ailleurs) =====
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// ===== Static front =====
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// ===== Routes API réelles =====
const apiRouter = express.Router();

// Monte les routers qui existent vraiment dans ton repo :
try { apiRouter.use(require('./routes/tableaux')); } catch {}
try { apiRouter.use(require('./routes/obsolescence')); } catch {}
try { apiRouter.use(require('./routes/safety')); } catch {}
try { apiRouter.use(require('./routes/reports')); } catch {}
// (si tu as d'autres routers, ajoute-les ici)

// ===== Public GET whitelist (AUCUNE auth) =====
// Objectif: que tes pages front puissent LIRE sans token (comme avant).
const PUBLIC_GET = [
  /^\/tableaux\/?$/i,           // GET /api/tableaux           (list)   — routes/tableaux.js
  /^\/tableaux\/ids\/?$/i,      // GET /api/tableaux/ids       (ids)    — routes/tableaux.js
  /^\/tableaux\/[^/]+\/?$/i,    // GET /api/tableaux/:id       (item)   — routes/tableaux.js
  /^\/equipements\/?$/i,        // GET /api/equipements        (agg)    — routes/tableaux.js
  /^\/arc-flash/i,              // GET /api/arc-flash*                 — routes/tableaux.js
  /^\/fault-level/i,            // GET /api/fault-level*               — routes/tableaux.js
  /^\/obsolescence\/?$/i,       // GET /api/obsolescence               — routes/obsolescence.js
  /^\/safety-actions\/?$/i,     // GET /api/safety-actions             — routes/safety.js
  /^\/reports\/health\/?$/i     // GET /api/reports/health            — routes/reports.js
];

// On sert D'ABORD les GET publics, sans passer par l'auth
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && PUBLIC_GET.some(rx => rx.test(req.path))) {
    return apiRouter(req, res, next);
  }
  next();
});

// ===== Auth middleware (OPTIONNEL) pour le reste =====
// Si tu as un middleware d'auth, on l'active ici uniquement pour les routes non publiques.
let authMiddleware = null;
try { authMiddleware = require('./middleware/auth'); } catch { authMiddleware = (_req, _res, next) => next(); }
app.use(authMiddleware);

// Puis on (re)monte l’API pour toutes les autres routes (POST/PUT/DELETE et GET non whitelists)
app.use('/api', apiRouter);

// ===== Routes front =====
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// 404 API propre
app.use('/api', (req, res, next) => {
  if (!req.route) return res.status(404).json({ error: 'not_found' });
  next();
});

// Handler d’erreurs
app.use((err, req, res, _next) => {
  console.error('💥 API error:', err);
  if (req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({ error: err.code || 'server_error', message: err.message });
  }
  res.status(500).send('Server error');
});

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));

module.exports = app;
