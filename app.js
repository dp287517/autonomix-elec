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

// Routers
app.use('/api', require('./routes/tableaux'));
app.use('/api', require('./routes/obsolescence'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/maintenance'));
app.use('/api', require('./routes/emergency'));
app.use('/api', require('./routes/safety'));
app.use('/api', require('./routes/projects'));
app.use('/', require('./routes/trades')); // garde les mêmes chemins /trades
app.use('/api', require('./routes/translate'));

// Gestion erreurs
app.use(errorHandler);

initDb().then(() => {
  app.listen(PORT, () => console.log(`[Server] Écoute sur : ${PORT}`));
}).catch(err => {
  console.error('[Server] Échec init DB:', err);
  process.exit(1);
});
