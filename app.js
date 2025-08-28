// app.js — Autonomix Elec (Express)
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

// Logs / perf / parsers
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🔐 CSP compatible avec TON HTML actuel (inline JS + Font Awesome via cdnjs)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        // autorise scripts depuis nos CDN + inline (ton create.html en a besoin)
        "script-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "script-src-elem": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        // styles (Tailwind + Google Fonts + cdnjs); inline OK
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        "style-src-elem": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        // ✅ polices : autoriser cdnjs (Font Awesome), jsDelivr et fonts.gstatic
        "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'self'"],
        "object-src": ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS (utile si preview ailleurs)
app.use(cors({ origin: true, credentials: true }));

// Static front
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// ====== API ======
const apiRouter = express.Router();
// Monte les routers EXISTANTS de ton repo (ajuste si besoin)
try { apiRouter.use(require('./routes/tableaux')); } catch {}
try { apiRouter.use(require('./routes/obsolescence')); } catch {}
try { apiRouter.use(require('./routes/safety')); } catch {}
try { apiRouter.use(require('./routes/reports')); } catch {}

// GET publics (sans auth) pour que les pages lisent librement
const PUBLIC_GET = [
  /^\/tableaux\/?$/i,           // GET /api/tableaux
  /^\/tableaux\/ids\/?$/i,      // GET /api/tableaux/ids
  /^\/tableaux\/[^/]+\/?$/i,    // GET /api/tableaux/:id
  /^\/equipements\/?$/i,        // GET /api/equipements
  /^\/arc-flash/i,              // GET /api/arc-flash*
  /^\/fault-level/i,            // GET /api/fault-level*
  /^\/obsolescence\/?$/i,       // GET /api/obsolescence
  /^\/safety-actions\/?$/i,     // GET /api/safety-actions
  /^\/reports\/health\/?$/i     // GET /api/reports/health
];

// Servir d'abord ces GET sans passer par l'auth
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && PUBLIC_GET.some(rx => rx.test(req.path))) {
    return apiRouter(req, res, next);
  }
  next();
});

// Auth middleware (optionnel) pour le reste
let authMiddleware = null;
try { authMiddleware = require('./middleware/auth'); } catch { authMiddleware = (_req, _res, next) => next(); }
app.use(authMiddleware);

// API protégée (POST/PUT/DELETE et GET non whitelisted)
app.use('/api', apiRouter);

// Routes front
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// 404 API
app.use('/api', (req, res, next) => {
  if (!req.route) return res.status(404).json({ error: 'not_found' });
  next();
});

// Erreurs
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
