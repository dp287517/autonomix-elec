require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./config/initDb');
const { errorHandler } = require('./middleware/error');
const { requestLogger } = require('./middleware/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// Logs requête/réponse
app.use(requestLogger);

// Helper: accepte CommonJS ou ESM ou objets {router: ...}
function pickRouter(mod, name) {
  const candidate = (mod && (mod.default || mod.router || mod)) || mod;
  if (typeof candidate !== 'function') {
    console.error(`[Boot] Mauvais export pour ${name}. Attendu un router fonction, reçu:`, typeof candidate);
    throw new TypeError(`[Boot] ${name} n'exporte pas un router valide`);
  }
  return candidate;
}

// Import des routes avec normalisation
const tableaux = pickRouter(require('./routes/tableaux'), 'routes/tableaux');
const obsolescence = pickRouter(require('./routes/obsolescence'), 'routes/obsolescence');
const reports = pickRouter(require('./routes/reports'), 'routes/reports');
const maintenance = pickRouter(require('./routes/maintenance'), 'routes/maintenance');
const emergency = pickRouter(require('./routes/emergency'), 'routes/emergency');
const safety = pickRouter(require('./routes/safety'), 'routes/safety');
const projects = pickRouter(require('./routes/projects'), 'routes/projects');
const trades = pickRouter(require('./routes/trades'), 'routes/trades');
const translate = pickRouter(require('./routes/translate'), 'routes/translate');

// Montage des routers (endpoints conservés)
app.use('/api', tableaux);
app.use('/api', obsolescence);
app.use('/api', reports);
app.use('/api', maintenance);
app.use('/api', emergency);
app.use('/api', safety);
app.use('/api', projects);
app.use('/', trades);           // garde /trades*
app.use('/api', translate);

// Gestion erreurs
app.use(errorHandler);

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`[Server] Écoute sur : ${PORT}`));
  })
  .catch(err => {
    console.error('[Server] Échec init DB:', err);
    process.exit(1);
  });
