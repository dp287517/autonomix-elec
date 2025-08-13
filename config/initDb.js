// Initialize DB schema for public.atex_equipments
module.exports = async function initDb(pool) {
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
      marquage_atex VARCHAR,
      photo TEXT,
      conformite VARCHAR,
      comments TEXT,
      last_inspection_date DATE,
      next_inspection_date DATE,
      risk_assessment TEXT,
      grade VARCHAR,
      frequence INTEGER,
      zone_type VARCHAR,
      zone_gaz TEXT,
      zone_poussiere TEXT,
      zone_poussieres SMALLINT,
      ia_history JSONB,
      attachments JSONB
    );
  `);

  // Trigger to set next_inspection_date in MONTHS (default 12 if null/<=0)
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.atex_set_next_date() RETURNS trigger AS $$
    DECLARE
      base_date DATE;
      months INT;
    BEGIN
      base_date := NEW.last_inspection_date;
      IF base_date IS NULL THEN
        RETURN NEW;
      END IF;
      months := COALESCE(NEW.frequence, 12);
      IF months <= 0 THEN months := 12; END IF;
      NEW.next_inspection_date := base_date + make_interval(months => months);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_atx_set_next ON public.atex_equipments;
    CREATE TRIGGER trg_atx_set_next
      BEFORE INSERT OR UPDATE OF last_inspection_date, frequence
      ON public.atex_equipments
      FOR EACH ROW
      EXECUTE FUNCTION public.atex_set_next_date();
  `);

  // Useful index
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_atex_next_date ON public.atex_equipments(next_inspection_date);
  `);
};
