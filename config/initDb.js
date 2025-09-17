// initDb.js — Initialize DB schema for ATEX
module.exports = async function initDb(pool) {
  // Table atex_secteurs (secteurs/sites)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_secteurs (
      id SERIAL PRIMARY KEY,
      name VARCHAR NOT NULL,
      account_id INTEGER NOT NULL
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_atex_secteurs_account_name ON public.atex_secteurs (account_id, name);
  `);

  // Table atex_equipments (équipements)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_equipments (
      id SERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
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
      frequence INTEGER DEFAULT 36, -- Mois par défaut
      ia_history JSONB DEFAULT '[]'::jsonb
    );
  `);
  // Indexes pour performance
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_equipments_account ON public.atex_equipments (account_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_equipments_secteur ON public.atex_equipments (secteur_id);`);

  // Fonction et trigger pour next_inspection_date
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.atex_set_next_date() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.last_inspection_date IS NOT NULL THEN
        NEW.next_inspection_date = NEW.last_inspection_date + make_interval(0, COALESCE(NEW.frequence, 36));
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER trg_atex_set_next
    BEFORE INSERT OR UPDATE OF last_inspection_date, frequence ON public.atex_equipments
    FOR EACH ROW EXECUTE FUNCTION public.atex_set_next_date();
  `);

  // Table atex_inspections (inspections)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_inspections (
      id SERIAL PRIMARY KEY,
      equipment_id INTEGER REFERENCES public.atex_equipments(id) ON DELETE CASCADE,
      inspection_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      comments TEXT,
      conformite VARCHAR,
      attachments JSONB DEFAULT '[]'::jsonb
    );
  `);

  // Table atex_chat_threads (chat IA persistent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.atex_chat_threads (
      id SERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      equipment_id INTEGER REFERENCES public.atex_equipments(id),
      user_id INTEGER NOT NULL,
      history JSONB DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_atex_chat_unique ON public.atex_chat_threads (account_id, equipment_id, user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_atex_chat_updated ON public.atex_chat_threads (updated_at DESC);
  `);

  console.log('[initDb] Tables ATEX initialisées');
};
