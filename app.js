// app.js

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// (DB optionnelle)
let pool;
try { ({ pool } = require('./config/db')); }
catch { try { ({ pool } = require('./db')); } catch {} }

const app = express();
app.use(morgan('dev'));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          // atex-control.html (inline #1 et #2)
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          // login.html (inline)
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='",
          // signup.html (inline)
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='",
          // dashboard.html (inline)
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg='"
        ],
        "script-src-elem": [
          "'self'",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "'sha256-QXP0lggFom0sCQGU7C8Ga1ZZ4nZXMv/Ae7a6FMMPn8Q='",
          "'sha256-Wglttk6u7n6jtm/l0HzvsAle8kFKAnhMIkQBLkiJpTA='",
          "'sha256-fzrEw4S1b1r+XcBoUL+/L7ZjCdR96GNidBRivIM+PFY='",
          "'sha256-VBsLKmk1R7Ia418rRwDElBT39eCZENxnujzihkgLpHQ='",
          "'sha256-dmtOGFVV8ciM0XL1bXpiarcZDOCMOUdk6XJB4yFFUsg='"
        ],
        "style-src": [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          "'unsafe-inline'"
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "frame-src": ["'self'"],
        "frame-ancestors": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API
const atexRoutes = require('./routes/atex');
app.use('/api', atexRoutes); // expose /api/... (ex: atex-equipments):contentReference[oaicite:3]{index=3}
// (si tu as un router d'auth: app.use('/api', require('./auth')); )

// Static
app.use(express.static(path.join(__dirname, 'public'))); // sert /public/**:contentReference[oaicite:4]{index=4}

app.get('/ping', (req, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
