const { pool } = require('./db');
const { getRecommendedSection, normalizeIcn } = require('../utils/electric');

async function initDb() {
  console.log('[Server] Initialisation de la base de données');
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');

    // Création des tables (identiques à l'existant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tableaux (
        id VARCHAR(50) PRIMARY KEY,
        disjoncteurs JSONB DEFAULT '[]'::jsonb,
        issitemain BOOLEAN DEFAULT FALSE,
        ishta BOOLEAN DEFAULT FALSE,
        htadata JSONB
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS equipements (
        id SERIAL PRIMARY KEY,
        tableau_id VARCHAR(50) REFERENCES tableaux(id) ON DELETE CASCADE,
        equipment_id VARCHAR(50) NOT NULL,
        equipment_type VARCHAR(20) NOT NULL,
        data JSONB NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_reports (
        id SERIAL PRIMARY KEY,
        tableau_id VARCHAR(50) REFERENCES tableaux(id) ON DELETE CASCADE,
        disjoncteur_id VARCHAR(50),
        description TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'En attente'
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_org (
        id SERIAL PRIMARY KEY,
        label VARCHAR(100),
        role TEXT,
        contact VARCHAR(100),
        parent_id INTEGER REFERENCES maintenance_org(id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS safety_actions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20),
        description TEXT,
        building VARCHAR(50),
        tableau_id VARCHAR(50) REFERENCES tableaux(id) ON DELETE SET NULL,
        status VARCHAR(20),
        date DATE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS obsolescence_factors (
        id SERIAL PRIMARY KEY,
        disjoncteur_type VARCHAR(50),
        humidity_factor FLOAT DEFAULT 1.0,
        temperature_factor FLOAT DEFAULT 1.0,
        load_factor FLOAT DEFAULT 1.0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS breaker_checklists (
        id SERIAL PRIMARY KEY,
        tableau_id VARCHAR(50) NOT NULL REFERENCES tableaux(id) ON DELETE CASCADE,
        disjoncteur_id VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        comment TEXT NOT NULL,
        photo TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_date DATE NOT NULL,
        investment DECIMAL NOT NULL,
        profit_loss DECIMAL NOT NULL,
        current_capital DECIMAL NOT NULL,
        notes TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        business_case TEXT,
        business_case_approved BOOLEAN DEFAULT FALSE,
        pip TEXT,
        pip_approved BOOLEAN DEFAULT FALSE,
        wbs_created BOOLEAN DEFAULT FALSE,
        po_launched BOOLEAN DEFAULT FALSE,
        project_phase_completed BOOLEAN DEFAULT FALSE,
        reception_completed BOOLEAN DEFAULT FALSE,
        closure_completed BOOLEAN DEFAULT FALSE,
        wbs_number VARCHAR(50),
        po_requests JSONB DEFAULT '[]'::jsonb,
        quotes JSONB DEFAULT '[]'::jsonb,
        attachments JSONB DEFAULT '[]'::jsonb,
        gantt_data JSONB,
        budget_total DECIMAL DEFAULT 0,
        budget_spent DECIMAL DEFAULT 0,
        status VARCHAR(20) DEFAULT 'En cours',
        chantier_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // --- ATEX tables ---
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
        categorie_minimum VARCHAR(100),
        marquage_atex VARCHAR(100),
        photo TEXT,
        conformite VARCHAR(50),
        comments TEXT,
        last_inspection_date DATE,
        next_inspection_date DATE,
        risk_assessment TEXT,
        grade VARCHAR(1) DEFAULT 'V',
        frequence INTEGER DEFAULT 3
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS atex_inspections (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER REFERENCES atex_equipments(id) ON DELETE CASCADE,
        status VARCHAR(50),
        comment TEXT,
        photo TEXT,
        inspection_date DATE DEFAULT CURRENT_DATE
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS atex_secteurs (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE
      );
    `);
    const secteursCount = await client.query('SELECT COUNT(*) FROM atex_secteurs');
    if (parseInt(secteursCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO atex_secteurs (name) VALUES ('Métro'), ('Utilité'), ('Maintenance');
      `);
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_projects()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trig_updated_at_projects ON projects;
      CREATE TRIGGER trig_updated_at_projects
      BEFORE UPDATE ON projects
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_projects();
    `);

    // Normaliser les disjoncteurs existants
    const result = await client.query('SELECT id, disjoncteurs FROM tableaux');
    for (const row of result.rows) {
      if (!Array.isArray(row.disjoncteurs)) {
        await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', ['[]', row.id]);
        continue;
      }
      const normalized = row.disjoncteurs.map(d => {
        const courbe = d.courbe ? String(d.courbe).toUpperCase() : 'C';
        let defaultTriptime = 0.02;
        if (courbe === 'B') defaultTriptime = 0.01;
        else if (courbe === 'D') defaultTriptime = 0.03;
        else if (courbe === 'K') defaultTriptime = 0.015;
        else if (courbe === 'Z') defaultTriptime = 0.005;
        return {
          ...d,
          id: d.id || `unknown-${Math.random().toString(36).substring(2, 9)}`,
          cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength),
          impedance: d.impedance || null,
          ue: d.ue || '400 V',
          section: d.section || `${getRecommendedSection(d.in)} mm²`,
          icn: normalizeIcn(d.icn),
          replacementDate: d.replacementDate || null,
          humidite: d.humidite || 50,
          temp_ambiante: d.temp_ambiante || 25,
          charge: d.charge || 80,
          linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [],
          isPrincipal: !!d.isPrincipal,
          isHTAFeeder: !!d.isHTAFeeder,
          triptime: d.triptime || defaultTriptime
        }
      });
      await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(normalized), row.id]);
    }

    console.log('[Server] DB OK');
  } catch (e) {
    console.error('[Server] Erreur init DB:', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

module.exports = { initDb };
