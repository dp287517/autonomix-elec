require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./config/initDb');
const { errorHandler } = require('./middleware/error');
const { requestLogger } = require('./middleware/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(requestLogger);

// Helper: récupère un Router quelle que soit la forme d'export
function pickRouter(mod, name) {
  const candidates = [
    mod && mod.default,
    mod && mod.router,
    mod,
    ...(mod && typeof mod === 'object' ? Object.values(mod) : [])
  ].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === 'function' && (c.use || c.handle || c.stack)) return c;
  }

  console.error(`[Boot] Mauvais export pour ${name}. Type: ${typeof mod}, clés: ${
    mod && typeof mod === 'object' ? Object.keys(mod).join(',') : 'n/a'
  }`);
  throw new TypeError(`[Boot] ${name} n'exporte pas un router valide`);
}

// Charge les routes
const tableaux     = pickRouter(require('./routes/tableaux'),     'routes/tableaux');
const obsolescence = pickRouter(require('./routes/obsolescence'), 'routes/obsolescence');
const reports      = pickRouter(require('./routes/reports'),      'routes/reports');
const maintenance  = pickRouter(require('./routes/maintenance'),  'routes/maintenance');
const emergency    = pickRouter(require('./routes/emergency'),    'routes/emergency');
const safety       = pickRouter(require('./routes/safety'),       'routes/safety');
const projects     = pickRouter(require('./routes/projects'),     'routes/projects');
const trades       = pickRouter(require('./routes/trades'),       'routes/trades');
const translate    = pickRouter(require('./routes/translate'),    'routes/translate');
const atex         = pickRouter(require('./routes/atex'),         'routes/atex');

let epdStore = null;
try {
  epdStore = pickRouter(require('./routes/epdStore'), 'routes/epdStore');
} catch (e) {
  console.warn('[Boot] routes/epdStore absent.');
}

// Montage
app.use('/api', tableaux);
app.use('/api', obsolescence);
app.use('/api', reports);
app.use('/api', maintenance);
app.use('/api', emergency);
app.use('/api', safety);
app.use('/api', projects);
app.use('/',    trades);
app.use('/api', translate);
app.use('/api', atex);
if (epdStore) app.use('/api', epdStore);

// Servir le JS front EPD placé dans routes/
app.get('/js/epd.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'routes', 'epd.js'), err => {
    if (err) res.status(404).send('epd.js introuvable (place-le dans main/routes/epd.js)');
  });
});

// Servir les fichiers uploadés
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Erreurs
app.use(errorHandler);

initDb()
  .then(() => app.listen(PORT, () => console.log(`[Server] Écoute sur : ${PORT}`)))
  .catch(err => {
    console.error('[Server] Échec init DB:', err);
    process.exit(1);
  });
