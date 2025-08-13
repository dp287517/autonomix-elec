// config/initDb.js — idempotent, corrigé (casts TEXT) + compatible avec app.js (initDb(pool))
// - Crée les tables minimales si absentes
// - Ajoute ia_history, attachments si manquants
// - Nettoie '' -> NULL (zones)
// - Crée indexes basiques (idempotents)
// - Crée/Remplace la vue atex_equipments_v en CASTANT en TEXT pour éviter les erreurs de COALESCE
const { Pool } = require('pg');

async function initDb(pool) {
  console.log('[Server] Initialisation DB…');
  const localPool = pool || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });

  const client = await localPool.connect();
  try {
    await client.query('BEGIN');

    // === Table équipements ATEX (structure conforme à ton dump) ===
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
        zone_type            VARCHAR,
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
        zone_gaz             TEXT,
        zone_poussiere       TEXT,
        zone_poussieres      SMALLINT,
        ia_history           JSONB,
        attachments          JSONB
      );
    `);

    // === Table EPD (si utilisée) ===
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.atex_epd_docs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150),
        status VARCHAR(20) DEFAULT 'Brouillon',
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // === Index utiles (idempotents) ===
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_equipments_identifiant' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_equipments_identifiant ON public.atex_equipments (identifiant);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_next_inspection' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_next_inspection ON public.atex_equipments (next_inspection_date);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_filters_secteur_bat_local' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_filters_secteur_bat_local ON public.atex_equipments (secteur, batiment, local);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_conformite' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_conformite ON public.atex_equipments (conformite);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_zone_gaz' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_zone_gaz ON public.atex_equipments (zone_gaz);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_zone_poussieres' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_zone_poussieres ON public.atex_equipments (zone_poussieres);
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='idx_atex_ia_history_gin' AND n.nspname='public'
      ) THEN
        CREATE INDEX idx_atex_ia_history_gin ON public.atex_equipments USING GIN (ia_history);
      END IF;
    END $$;`);

    // === Contraintes simples sur zones (idempotentes) ===
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_zone_gaz_values') THEN
        ALTER TABLE public.atex_equipments
          ADD CONSTRAINT chk_zone_gaz_values CHECK (zone_gaz IS NULL OR zone_gaz ~ '^(0|1|2)$');
      END IF;
    END $$;`);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_zone_poussieres_values') THEN
        ALTER TABLE public.atex_equipments
          ADD CONSTRAINT chk_zone_poussieres_values CHECK (zone_poussieres IS NULL OR zone_poussieres IN (20,21,22));
      END IF;
    END $$;`);

    // === Trigger: calcule next_inspection_date à partir de last_inspection_date + frequence ===
    await client.query(`
      CREATE OR REPLACE FUNCTION public.atex_set_next_date()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.last_inspection_date IS NOT NULL THEN
          IF TG_OP = 'INSERT'
             OR NEW.last_inspection_date IS DISTINCT FROM COALESCE(OLD.last_inspection_date, DATE '0001-01-01')
             OR NEW.frequence IS DISTINCT FROM COALESCE(OLD.frequence, 3) THEN
            NEW.next_inspection_date := (NEW.last_inspection_date + make_interval(years => COALESCE(NEW.frequence, 3)));
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_atex_set_next_date') THEN
        CREATE TRIGGER trg_atex_set_next_date
        BEFORE INSERT OR UPDATE ON public.atex_equipments
        FOR EACH ROW EXECUTE PROCEDURE public.atex_set_next_date();
      END IF;
    END $$;`);

    // === Nettoyage '' -> NULL sur zones ===
    await client.query(`
      UPDATE public.atex_equipments
      SET zone_gaz = NULLIF(zone_gaz, ''),
          zone_poussiere = NULLIF(zone_poussiere, '')
      WHERE (zone_gaz = '' OR zone_poussiere = '');
    `);

    // === Vue canonique avec CASTs TEXT pour éviter COALESCE text/smallint ===
    await client.query(`
      CREATE OR REPLACE VIEW public.atex_equipments_v AS
      SELECT
        e.*,
        /* zone_code text (priorité : zone_type -> zone_gaz -> zone_poussiere -> zone_poussieres) */
        COALESCE(
          NULLIF(e.zone_type, ''),
          NULLIF(e.zone_gaz, ''),
          NULLIF(e.zone_poussiere, ''),
          CASE WHEN e.zone_poussieres IS NOT NULL THEN e.zone_poussieres::text END
        ) AS zone_code,

        /* extraction explicite G / D en TEXT */
        CASE
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) ~ '^(0|1|2)$'
          THEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, ''))
        END AS zone_g,

        CASE
          WHEN e.zone_poussieres IN (20,21,22) THEN e.zone_poussieres::text
          WHEN NULLIF(e.zone_poussiere, '') ~ '^(20|21|22)$' THEN e.zone_poussiere
        END AS zone_d,

        /* Catégorie requise (calcul text pour éviter mix int/text) */
        CASE
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) = '0'
               OR COALESCE(e.zone_poussieres::text, NULLIF(e.zone_poussiere,'')) = '20'
            THEN 'II 1GD'
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) = '1'
               OR COALESCE(e.zone_poussieres::text, NULLIF(e.zone_poussiere,'')) = '21'
            THEN 'II 2GD'
          ELSE 'II 3GD'
        END AS cat_requise
      FROM public.atex_equipments e;
    `);

    await client.query('COMMIT');
    console.log('[Server] DB ok.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Server] Erreur init DB:', err);
    throw err;
  } finally {
    client.release();
    if (!pool) await localPool.end();
  }
}

module.exports = { initDb };
