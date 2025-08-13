// initDb.js — version corrigée et idempotente
// --------------------------------------------------
// - Crée les tables si elles n'existent pas
// - Ajoute les colonnes manquantes (ia_history) sans casser les types existants
// - Ne modifie PAS les types actuels (ex.: zone_poussieres smallint conservé)
// - Peut être appelée à chaque démarrage du serveur en toute sécurité

const { Pool } = require('pg');

/**
 * Initialise le schéma de base de données.
 * @param {Pool} [pool] - Optionnel. Si non fourni, un Pool sera instancié via les variables d'env PG.
 */
async function initDb(pool) {
  const localPool = pool || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });

  const client = await localPool.connect();
  try {
    await client.query('BEGIN');

    // ========== TABLE atex_equipments (si elle n'existe pas) ==========
    // On reprend la structure que tu m'as fournie, avec les types actuels.
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

    // ========== TABLE atex_inspections (si utilisée par l'app) ==========
    // Schéma minimal sécurisant les contraintes, ajustable selon tes besoins réels.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.atex_inspections (
        id            SERIAL PRIMARY KEY,
        equipment_id  INTEGER NOT NULL REFERENCES public.atex_equipments(id) ON DELETE CASCADE,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        notes         TEXT
      );
    `);

    // ========== MIGRATIONS IDempotentes ==========
    // 1) Historique IA (JSONB) pour stocker les threads / commentaires IA
    await client.query(`
      ALTER TABLE public.atex_equipments
        ADD COLUMN IF NOT EXISTS ia_history JSONB;
    `);

    // 2) Nettoyage : convertir les chaînes vides en NULL sur les zones (évite erreurs PG lors de cast/contrôles)
    await client.query(`
      UPDATE public.atex_equipments
      SET zone_gaz = NULLIF(zone_gaz, ''),
          zone_poussiere = NULLIF(zone_poussiere, '')
      WHERE (zone_gaz = '' OR zone_poussiere = '');
    `);

    // 3) Index utiles (idempotents)
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
