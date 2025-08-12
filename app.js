
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
app.use(express.json({ limit: '25mb' }));
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

// Routes existantes
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

// ⬇️ NEW: EPD Store + Uploads
let epdStore = null;
let uploads = null;
try { epdStore = pickRouter(require('./routes/epdStore'), 'routes/epdStore'); } catch (e) { console.warn('[Boot] routes/epdStore absent'); }
try { uploads  = pickRouter(require('./routes/uploads'),  'routes/uploads'); }  catch (e) { console.warn('[Boot] routes/uploads absent'); }

// Montage API
app.use('/api', tableaux);
app.use('/api', obsolescence);
app.use('/api', reports);
app.use('/api', maintenance);
app.use('/api', emergency);
app.use('/api', safety);
app.use('/api', projects);
app.use('/',    trades);      // garde /trades*
app.use('/api', translate);
app.use('/api', atex);
if (epdStore) app.use('/api', epdStore);
if (uploads)  app.use('/api', uploads);

// Servir fichiers uploadés (si présents)
const UP_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });
app.use('/uploads', express.static(UP_DIR));

// Servir le JS front epd rangé dans routes/
app.get('/js/epd.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'routes', 'epd.js'), err => {
    if (err) res.status(404).send('epd.js introuvable (place-le dans main/routes/epd.js)');
  });
});

// Erreurs
app.use(errorHandler);

initDb()
  .then(() => app.listen(PORT, () => console.log(`[Server] Écoute sur : ${PORT}`)))
  .catch(err => {
    console.error('[Server] Échec init DB:', err);
    process.exit(1);
  });
