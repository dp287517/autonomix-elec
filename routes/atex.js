// initDb.js — version corrigée & idempotente (ATEX)
// - Crée les tables minimales si absentes (structure conforme à ton dump)
// - Ajoute les colonnes manquantes (ia_history, attachments) sans toucher les types existants
// - Nettoie '' -> NULL sur zone_gaz/zone_poussiere
// - Ajoute un index utile sur identifiant
// - Compatible Neon (SSL)

const { Pool } = require('pg');

async function initDb(pool) {
  const localPool = pool || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });

  const client = await localPool.connect();
  try {
    await client.query('BEGIN');

    // Table ATEX (structure basée sur ton état actuel)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.atex_equipments (
        id                   SERIAL PRIMARY KEY,
        risque               INTEGER,
        secteur              VARCHAR,
        batiment             VARCHAR,
        local                VARCHAR,
        composant            VARCHAR,
        fournisseur          VARCHAR,
        type                 VARCHAR,
        identifiant          VARCHAR,
        interieur            VARCHAR,
        exterieur            VARCHAR,
        categorie_minimum    VARCHAR,
        marquage_atex        VARCHAR,
        photo                TEXT,
        conformite           VARCHAR,
        comments             TEXT,
        last_inspection_date DATE,
        next_inspection_date DATE,
        risk_assessment      TEXT,
        grade                VARCHAR DEFAULT 'V',
        frequence            INTEGER  DEFAULT 3,
        zone_type            VARCHAR,
        zone_gaz             TEXT,
        zone_poussiere       TEXT,
        zone_poussieres      SMALLINT
      );
    `);

    // Table inspections (minimale)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.atex_inspections (
        id            SERIAL PRIMARY KEY,
        equipment_id  INTEGER NOT NULL REFERENCES public.atex_equipments(id) ON DELETE CASCADE,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        notes         TEXT
      );
    `);

    // Colonnes manquantes
    await client.query(`
      ALTER TABLE public.atex_equipments
        ADD COLUMN IF NOT EXISTS ia_history JSONB;
    `);
    await client.query(`
      ALTER TABLE public.atex_equipments
        ADD COLUMN IF NOT EXISTS attachments JSONB;
    `);

    // Normalisation: '' -> NULL
    await client.query(`
      UPDATE public.atex_equipments
      SET zone_gaz = NULLIF(zone_gaz, ''),
          zone_poussiere = NULLIF(zone_poussiere, '')
      WHERE (zone_gaz = '' OR zone_poussiere = '');
    `);

    // Index utile (idempotent)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'i' AND c.relname = 'idx_atex_equipments_identifiant' AND n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_atex_equipments_identifiant ON public.atex_equipments (identifiant);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[initDb] Migration failed:', err);
    throw err;
  } finally {
    client.release();
    if (!pool) await localPool.end();
  }
}

module.exports = { initDb };
