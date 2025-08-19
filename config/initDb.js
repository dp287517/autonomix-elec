// config/initDb.js — adds ATEX secteurs table if missing (safe to run at boot)
const { pool } = require('./db');

async function ensureAtexSecteurs() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_secteurs (
      id SERIAL PRIMARY KEY,
      name VARCHAR NOT NULL,
      account_id INTEGER NOT NULL,
      created_by VARCHAR
    );
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_atex_secteurs_account_name'
      ) THEN
        CREATE UNIQUE INDEX idx_atex_secteurs_account_name
          ON public.atex_secteurs(account_id, name);
      END IF;
    END $$;
  `);
}

async function initDb() {
  // call your existing initializers here if you have any...
  await ensureAtexSecteurs();
  console.log('[initDb] ATEX secteurs table ensured');
}

module.exports = { initDb };
