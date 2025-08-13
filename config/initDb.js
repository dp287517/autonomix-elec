// config/initDb.js — idempotent, aligne ATEX + EPD sans rien casser

const { pool } = require('./db');

async function initDb() {
  console.log('[Server] Initialisation DB…');
  let client;
  try {
    client = await pool.connect();

    // 1) Table équipements ATEX (ne casse rien si déjà présente)
    await client.query(`
      CREATE TABLE IF NOT EXISTS atex_equipments (
        id SERIAL PRIMARY KEY,
        risque INTEGER,
        secteur VARCHAR(100),
        batiment VARCHAR(100),
        local VARCHAR(100),
        composant VARCHAR(100),
        fournisseur VARCHAR(100),
        type VARCHAR(100),
        identifiant VARCHAR(100) UNIQUE,
        interieur VARCHAR(50),
        exterieur VARCHAR(50),
        zone_type VARCHAR(10),
        categorie_minimum VARCHAR(100),
        marquage_atex VARCHAR(200),
        photo TEXT,
        conformite VARCHAR(50),
        comments TEXT,
        last_inspection_date DATE,
        next_inspection_date DATE,
        risk_assessment TEXT,
        grade VARCHAR(1) DEFAULT 'V',
        frequence INTEGER DEFAULT 3,
        zone_gaz TEXT,
        zone_poussiere SMALLINT,
        zone_poussieres SMALLINT,
        ia_history JSONB
      );
    `);

    // Index utiles
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_identifiant ON atex_equipments (identifiant);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_next_inspection ON atex_equipments (next_inspection_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_filters_secteur_bat_local ON atex_equipments (secteur, batiment, local);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_conformite ON atex_equipments (conformite);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_zone_gaz ON atex_equipments (zone_gaz);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_zone_poussieres ON atex_equipments (zone_poussieres);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_atex_identifiant_norm ON atex_equipments (lower(trim(identifiant))) WHERE identifiant IS NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_atex_ia_history_gin ON atex_equipments USING GIN (ia_history);`);

    // Contraintes simples (idempotentes)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_zone_gaz_values'
        ) THEN
          ALTER TABLE atex_equipments
          ADD CONSTRAINT chk_zone_gaz_values CHECK (zone_gaz IS NULL OR zone_gaz ~ '^(0|1|2)$');
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_zone_poussieres_values'
        ) THEN
          ALTER TABLE atex_equipments
          ADD CONSTRAINT chk_zone_poussieres_values CHECK (zone_poussieres IS NULL OR zone_poussieres IN (20,21,22));
        END IF;
      END $$;
    `);

    // Trigger: calcule la prochaine inspection à partir de la dernière + frequence (années)
    await client.query(`
      CREATE OR REPLACE FUNCTION atex_set_next_date()
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
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_atex_set_next_date') THEN
          CREATE TRIGGER trg_atex_set_next_date
          BEFORE INSERT OR UPDATE ON atex_equipments
          FOR EACH ROW EXECUTE PROCEDURE atex_set_next_date();
        END IF;
      END $$;
    `);

    // Vue pratique (ne perturbe rien côté contrôle ATEX)
    await client.query(`
      CREATE OR REPLACE VIEW atex_equipments_v AS
      SELECT
        e.*,
        COALESCE(
          NULLIF(e.zone_type, ''),
          NULLIF(e.zone_gaz, ''),
          NULLIF(e.zone_poussiere::text, ''),
          CASE WHEN e.zone_poussieres IS NOT NULL THEN e.zone_poussieres::text END
        ) AS zone_code,
        CASE
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) ~ '^(0|1|2)$'
          THEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, ''))
        END AS zone_g,
        CASE
          WHEN e.zone_poussieres IN (20,21,22) THEN e.zone_poussieres::text
          WHEN NULLIF(e.zone_poussiere::text, '') ~ '^(20|21|22)$' THEN e.zone_poussiere::text
        END AS zone_d,
        CASE
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) ~ '^0$'
               OR COALESCE(e.zone_poussieres, e.zone_poussiere) = 20
            THEN 'II 1GD'
          WHEN COALESCE(NULLIF(e.zone_gaz, ''), NULLIF(e.zone_type, '')) ~ '^1$'
               OR COALESCE(e.zone_poussieres, e.zone_poussiere) = 21
            THEN 'II 2GD'
          ELSE 'II 3GD'
        END AS cat_requise
      FROM atex_equipments e;
    `);

    // 2) Table des documents EPD (utilisée par epdStore.js)
    await client.query(`
      CREATE TABLE IF NOT EXISTS atex_epd_docs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150),
        status VARCHAR(20) DEFAULT 'Brouillon',
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_epd_updated ON atex_epd_docs(updated_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_epd_status ON atex_epd_docs(status);`);
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_epd()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_updated_at_epd') THEN
          CREATE TRIGGER trig_updated_at_epd
          BEFORE UPDATE ON atex_epd_docs
          FOR EACH ROW EXECUTE PROCEDURE update_updated_at_epd();
        END IF;
      END $$;
    `);

    console.log('[Server] DB ok.');
  } catch (err) {
    console.error('[Server] Erreur init DB:', err);
    throw err;
  } finally {
    if (client) client.release();
  }
}

module.exports = { initDb };
