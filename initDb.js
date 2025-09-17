// initDb.js — Initialize DB schema for ATEX (idempotent)
const { pool } = require('./config/db');

module.exports = async function initDb() {
  try {
    // Table users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Table accounts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.accounts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Table user_accounts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES public.users(id),
        account_id INTEGER REFERENCES public.accounts(id),
        role TEXT DEFAULT 'member'
      );
    `);

    // Table atex_secteurs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.atex_secteurs (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        account_id INTEGER REFERENCES public.accounts(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_atex_secteurs_account_name ON public.atex_secteurs (account_id, name);
    `);

    // Table atex_equipments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.atex_equipments (
        id SERIAL PRIMARY KEY,
        account_id INTEGER REFERENCES public.accounts(id),
        secteur_id INTEGER REFERENCES public.atex_secteurs(id),
        batiment VARCHAR,
        local VARCHAR,
        composant VARCHAR NOT NULL,
        fabricant VARCHAR NOT NULL,
        type VARCHAR NOT NULL,
        identifiant VARCHAR,
        zone_gaz VARCHAR,
        zone_poussieres VARCHAR,
        marquage_atex TEXT NOT NULL,
        photo TEXT,
        attachments JSONB DEFAULT '[]'::jsonb,
        conformite VARCHAR,
        comments TEXT,
        last_inspection_date TIMESTAMP WITH TIME ZONE,
        next_inspection_date TIMESTAMP WITH TIME ZONE,
        risk INTEGER,
        grade VARCHAR,
        frequence INTEGER DEFAULT 36,
        ia_history JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_equipments_account ON public.atex_equipments (account_id);`);

    // Trigger pour next_inspection_date
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.atex_set_next_date() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.last_inspection_date IS NOT NULL THEN
          NEW.next_inspection_date = NEW.last_inspection_date + INTERVAL '1 month' * COALESCE(NEW.frequence, 36);
        END IF;
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_atex_set_next ON public.atex_equipments;
      CREATE TRIGGER trg_atex_set_next
      BEFORE INSERT OR UPDATE OF last_inspection_date, frequence ON public.atex_equipments
      FOR EACH ROW EXECUTE FUNCTION public.atex_set_next_date();
    `);

    // Table atex_chat_threads
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.atex_chat_threads (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL,
        equipment_id INTEGER REFERENCES public.atex_equipments(id),
        user_id INTEGER REFERENCES public.users(id),
        history JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_atex_chat_unique ON public.atex_chat_threads (account_id, equipment_id, user_id);
    `);

    // Insert default data for testing
    const accountRes = await pool.query('SELECT id FROM accounts WHERE id = $1', [10]);
    if (!accountRes.rows.length) {
      await pool.query('INSERT INTO accounts (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [10, 'Test Account']);
      await pool.query('INSERT INTO atex_secteurs (name, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['Secteur Test', 10]);
      await pool.query(`
        INSERT INTO atex_equipments (account_id, secteur_id, composant, fabricant, type, marquage_atex, last_inspection_date)
        VALUES ($1, (SELECT id FROM atex_secteurs WHERE account_id = $1 LIMIT 1), $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [10, 'Pompe', 'Fabricant X', 'Type A', 'Ex d IIB T4', '2025-01-01']);
    }

    console.log('[initDb] Tables ATEX initialisées avec succès');
  } catch (err) {
    console.error('[initDb] Erreur:', err);
  }
};
