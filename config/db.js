// config/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Format Neon: postgres://user:password@neon-host/dbname
  ssl: {
    rejectUnauthorized: false // Nécessaire pour Neon
  }
});

// Test connexion
pool.connect((err) => {
  if (err) {
    console.error('[db] Erreur connexion Neon:', err);
  } else {
    console.log('[db] Connecté à Neon');
  }
});

module.exports = { pool };
