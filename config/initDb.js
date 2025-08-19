// Initialize DB schema (ATEX)
// - Garde la création/MAJ de public.atex_equipments
// - AJOUTE la table public.atex_secteurs (et son index unique)
// - Conserve le style "idempotent" (CREATE IF NOT EXISTS / IF NOT EXISTS)

module.exports = async function initDb(pool) {
  // =========================
  // Table des équipements ATEX
  // =========================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_equipments (
      id SERIAL PRIMARY KEY,
      risque INTEGER,
      secteur VARCHAR,
      batiment VARCHAR,
      local VARCHAR,
      composant VARCHAR,
      fournisseur VARCHAR,
      type VARCHAR,
      identifiant VARCHAR,
      interieur VARCHAR,
      exterieur VARCHAR,
      categorie_minimum VARCHAR,
      marquage_atex TEXT,
      photo TEXT,
      conformite VARCHAR,
      comments TEXT,
      last_inspection_date TIMESTAMP WITH TIME ZONE,
      next_inspection_date TIMESTAMP WITH TIME ZONE,
      risk_assessment TEXT,
      grade VARCHAR,
      frequence INTEGER,
      zone_type VARCHAR,
      zone_gaz VARCHAR,
      zone_poussiere VARCHAR,
      zone_poussieres VARCHAR,
      ia_history JSONB,
      attachments JSONB,
      account_id INTEGER,
      created_by VARCHAR
    );
  `);

  // Colonnes utiles (idempotent: ajout si manquantes)
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS account_id INTEGER;`);
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS created_by VARCHAR;`);
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS next_inspection_date TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS zone_poussieres VARCHAR;`);
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS ia_history JSONB;`);
  await pool.query(`ALTER TABLE public.atex_equipments ADD COLUMN IF NOT EXISTS attachments JSONB;`);

  // Fonction de calcul de la prochaine date d’inspection (si frequence/mois définie)
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.atex_set_next_date()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.last_inspection_date IS NOT NULL THEN
        -- frequence en mois (par défaut 36 si null)
        NEW.next_inspection_date := (NEW.last_inspection_date + make_interval(months => COALESCE(NEW.frequence, 36)));
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger pour maintenir next_inspection_date à jour
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_atx_set_next ON public.atex_equipments;
  `);
  await pool.query(`
    CREATE TRIGGER trg_atx_set_next
      BEFORE INSERT OR UPDATE OF last_inspection_date, frequence
      ON public.atex_equipments
      FOR EACH ROW
      EXECUTE FUNCTION public.atex_set_next_date();
  `);

  // Index utile
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_atex_next_date ON public.atex_equipments(next_inspection_date);
  `);

  // =========================
  // (AJOUT) Table des secteurs ATEX
  // =========================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_secteurs (
      id SERIAL PRIMARY KEY,
      name VARCHAR NOT NULL,
      account_id INTEGER NOT NULL,
      created_by VARCHAR
    );
  `);

  // Index / unicité "un nom de secteur par compte"
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_atex_secteurs_account_name'
      ) THEN
        CREATE UNIQUE INDEX idx_atex_secteurs_account_name
          ON public.atex_secteurs(account_id, name);
      END IF;
    END
    $$;
  `);

  console.log('[initDb] ATEX: tables atex_equipments et atex_secteurs OK');
};
