// config/db.js
const { Pool } = require('pg');
const connectionString = process.env.DATABASE_URL;
let sslOption = undefined;
if (process.env.PGSSLMODE && process.env.PGSSLMODE.toLowerCase() === 'disable') {
  sslOption = false;
} else {
  sslOption = { rejectUnauthorized: false };
}
const pool = new Pool({ connectionString, ssl: sslOption });
pool.on('error', (err) => console.error('[DB] Pool error', err));
module.exports = { pool };
