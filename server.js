const express = require('express');
const { Pool } = require('pg');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// Middleware pour loguer chaque requête et réponse
app.use((req, res, next) => {
    const start = Date.now();
    const requestId = Math.random().toString(36).substring(2, 9);
    console.log(`[${new Date().toISOString()}] [Request ${requestId}] ${req.method} ${req.url}`);
    console.log(`[Request ${requestId}] Body:`, JSON.stringify(req.body, null, 2));

    const oldSend = res.send;
    res.send = function(data) {
        console.log(`[${new Date().toISOString()}] [Response ${requestId}] ${req.method} ${req.url} - Status: ${res.statusCode}, Duration: ${Date.now() - start}ms`);
        console.log(`[Response ${requestId}] Data:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        oldSend.apply(res, arguments);
    };

    next();
});

// Configuration de la base de données PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// Configuration OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gestion du fichier replacementDates.json
const REPLACEMENT_FILE = 'replacementDates.json';
let replacementDates = {};
if (fs.existsSync(REPLACEMENT_FILE)) {
    try {
        const raw = fs.readFileSync(REPLACEMENT_FILE);
        replacementDates = JSON.parse(raw);
    } catch (error) {
        console.error('[Server] Erreur lecture replacementDates.json:', error.message);
    }
}

// Fonction pour obtenir la section recommandée selon In
function getRecommendedSection(inValue) {
    const inNum = parseFloat(inValue?.match(/[\d.]+/)?.[0]) || 0;
    const cableSections = [
        { in: 2, section: 1.5 }, { in: 10, section: 1.5 }, { in: 16, section: 2.5 }, { in: 20, section: 2.5 },
        { in: 25, section: 4 }, { in: 32, section: 6 }, { in: 40, section: 10 }, { in: 50, section: 16 },
        { in: 63, section: 25 }, { in: 80, section: 35 }, { in: 100, section: 50 }, { in: 125, section: 70 },
        { in: 160, section: 95 }, { in: 200, section: 120 }, { in: 250, section: 150 }, { in: 315, section: 185 },
        { in: 400, section: 240 }, { in: 500, section: 300 }, { in: 630, section: 400 }, { in: 800, section: 500 },
        { in: 1000, section: 630 }, { in: 1250, section: 800 }, { in: 1600, section: 1000 }, { in: 2000, section: 1200 },
        { in: 2500, section: 1600 }
    ];
    for (let i = 0; i < cableSections.length; i++) {
        if (inNum <= cableSections[i].in) {
            return cableSections[i].section;
        }
    }
    return 1600;
}

// Validation des données de disjoncteur
function validateDisjoncteurData(data) {
    const errors = [];
    if (data.ip && !['IP20', 'IP40', 'IP54', 'IP65'].includes(data.ip)) {
        errors.push('Indice de protection invalide. Valeurs acceptées : IP20, IP40, IP54, IP65.');
    }
    if (data.temp && (isNaN(parseFloat(data.temp)) || parseFloat(data.temp) < 0)) {
        errors.push('La température doit être une valeur numérique positive (ex. 70).');
    }
    if (data.ue && (isNaN(parseFloat(data.ue.match(/[\d.]+/)?.[0])) || parseFloat(data.ue.match(/[\d.]+/)?.[0]) < 0)) {
        errors.push('La tension nominale doit être une valeur numérique positive (ex. 400).');
    }
    if (data.section && (isNaN(parseFloat(data.section.match(/[\d.]+/)?.[0])) || parseFloat(data.section.match(/[\d.]+/)?.[0]) < 0)) {
        errors.push('La section du câble doit être une valeur numérique positive (ex. 2.5).');
    }
    if (data.cableLength && (isNaN(parseFloat(data.cableLength)) || parseFloat(data.cableLength) < 0)) {
        errors.push('La longueur du câble doit être une valeur numérique positive (ex. 20).');
    }
    if (data.humidite && (isNaN(parseFloat(data.humidite)) || parseFloat(data.humidite) < 0 || parseFloat(data.humidite) > 100)) {
        errors.push('L’humidité doit être une valeur numérique entre 0 et 100 (ex. 60).');
    }
    if (data.temp_ambiante && (isNaN(parseFloat(data.temp_ambiante)) || parseFloat(data.temp_ambiante) < -20 || parseFloat(data.temp_ambiante) > 60)) {
        errors.push('La température ambiante doit être une valeur numérique entre -20 et 60 (ex. 25).');
    }
    if (data.charge && (isNaN(parseFloat(data.charge)) || parseFloat(data.charge) < 0 || parseFloat(data.charge) > 100)) {
        errors.push('La charge doit être une valeur numérique entre 0 et 100 (ex. 80).');
    }
    if (data.id && !/^[\p{L}0-9\s\-_:]+$/u.test(data.id)) {
        errors.push('L\'ID du disjoncteur contient des caractères non autorisés.');
    }
    if (data.newId && !/^[\p{L}0-9\s\-_:]+$/u.test(data.newId)) {
        errors.push('Le nouvel ID du disjoncteur contient des caractères non autorisés.');
    }
    if (data.in && (isNaN(parseFloat(data.in.match(/[\d.]+/)?.[0])) || parseFloat(data.in.match(/[\d.]+/)?.[0]) <= 0)) {
        errors.push('Le courant nominal (In) doit être une valeur numérique positive (ex. 2500).');
    }
    if (data.ir && (isNaN(parseFloat(data.ir.match(/[\d.]+/)?.[0])) || parseFloat(data.ir.match(/[\d.]+/)?.[0]) <= 0)) {
        errors.push('Le courant réglable (Ir) doit être une valeur numérique positive (ex. 2000).');
    }
    if (data.courbe && !['B', 'C', 'D'].includes(data.courbe)) {
        errors.push('La courbe doit être B, C ou D.');
    }
    if (data.triptime && (isNaN(parseFloat(data.triptime)) || parseFloat(data.triptime) <= 0)) {
        errors.push('Le temps de déclenchement (triptime) doit être une valeur numérique positive (ex. 0.1).');
    }
    if (data.icn) {
        const icnMatch = data.icn.match(/[\d.]+/);
        const icnValue = icnMatch ? parseFloat(icnMatch[0]) : NaN;
        if (isNaN(icnValue) || icnValue <= 0) {
            errors.push('Le pouvoir de coupure (Icn) doit être une valeur numérique positive (ex. 6 ou 6 kA).');
        } else {
            data.icn = data.icn.match(/\s*A$/i) ? `${icnValue} kA` : normalizeIcn(data.icn);
        }
    }
    if (data.linkedTableauIds && (!Array.isArray(data.linkedTableauIds) || data.linkedTableauIds.some(id => !id || !/^[\p{L}0-9\s\-_:]+$/u.test(id)))) {
        errors.push('Les IDs des tableaux liés doivent être un tableau de chaînes valides non vides.');
    }
    return errors;
}

// Validation des données HTA
function validateHTAData(data) {
    const errors = [];
    if (!data) return errors;
    console.log('[Server] Validation HTA data:', data);
    const parseValue = (value) => {
        if (!value) return NaN;
        const match = value.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : NaN;
    };
    if (isNaN(parseValue(data.transformerPower)) || parseValue(data.transformerPower) <= 0) {
        errors.push('La puissance du transformateur doit être une valeur numérique positive (ex. 1600).');
    }
    if (isNaN(parseValue(data.voltage)) || parseValue(data.voltage) <= 0) {
        errors.push('La tension HTA doit être une valeur numérique positive (ex. 20).');
    }
    if (isNaN(parseValue(data.in)) || parseValue(data.in) <= 0) {
        errors.push('Le courant nominal HTA (In) doit être une valeur numérique positive (ex. 50).');
    }
    if (isNaN(parseValue(data.ir)) || parseValue(data.ir) <= 0) {
        errors.push('Le courant réglable HTA (Ir) doit être une valeur numérique positive (ex. 40).');
    }
    if (isNaN(parseValue(data.triptime)) || parseValue(data.triptime) <= 0) {
        errors.push('Le temps de déclenchement HTA doit être une valeur numérique positive (ex. 0.2).');
    }
    if (data.icn) {
        const icnMatch = data.icn.match(/[\d.]+/);
        const icnValue = icnMatch ? parseFloat(icnMatch[0]) : NaN;
        if (isNaN(icnValue) || icnValue <= 0) {
            errors.push('Le pouvoir de coupure HTA (Icn) doit être une valeur numérique positive (ex. 16 ou 16 kA).');
        } else {
            data.icn = data.icn.match(/\s*A$/i) ? `${icnValue} kA` : normalizeIcn(data.icn);
        }
    }
    console.log('[Server] Résultat validation HTA:', { errors });
    return errors;
}

// Validation des données de checklist
function validateChecklistData(data) {
    const errors = [];
    if (!['Conforme', 'Non conforme', 'Non applicable'].includes(data.status)) {
        errors.push('Statut invalide. Valeurs acceptées : Conforme, Non conforme, Non applicable.');
    }
    if (!data.comment || typeof data.comment !== 'string' || data.comment.trim().length === 0) {
        errors.push('Le commentaire est requis et doit être une chaîne non vide.');
    }
    if (data.photo && !data.photo.startsWith('data:image/')) {
        errors.push('La photo doit être une URL de données valide (base64).');
    }
    if (!data.tableau_id || !/^[\p{L}0-9\s\-_:]+$/u.test(data.tableau_id)) {
        errors.push('L\'ID du tableau est requis et doit être valide.');
    }
    if (!data.disjoncteur_id || !/^[\p{L}0-9\s\-_:]+$/u.test(data.disjoncteur_id)) {
        errors.push('L\'ID du disjoncteur est requis et doit être valide.');
    }
    return errors;
}

// Validation des données d'équipements non-disjoncteurs
function validateEquipementData(data) {
    const errors = [];
    if (!data.id || !/^[\p{L}0-9\s\-_:]+$/u.test(data.id)) {
        errors.push('L\'ID de l\'équipement est requis et doit être valide.');
    }
    if (data.equipmentType && !['transformateur', 'cellule_mt', 'cable_gaine'].includes(data.equipmentType)) {
        errors.push('Type d\'équipement invalide. Valeurs acceptées : transformateur, cellule_mt, cable_gaine.');
    }
    if (data.equipmentType === 'transformateur') {
        if (data.puissance && !/^\d+(\.?\d+)?(\s*kVA)?$/.test(data.puissance)) {
            errors.push('La puissance doit être une valeur numérique positive (ex. 1600 kVA).');
        }
        if (data.tension_primaire && !/^\d+(\.?\d+)?(\s*kV)?$/.test(data.tension_primaire)) {
            errors.push('La tension primaire doit être une valeur numérique positive (ex. 20 kV).');
        }
        if (data.tension_secondaire && !/^\d+(\.?\d+)?(\s*V)?$/.test(data.tension_secondaire)) {
            errors.push('La tension secondaire doit être une valeur numérique positive (ex. 400 V).');
        }
    } else if (data.equipmentType === 'cellule_mt') {
        if (data.tension && !/^\d+(\.?\d+)?(\s*kV)?$/.test(data.tension)) {
            errors.push('La tension nominale doit être une valeur numérique positive (ex. 20 kV).');
        }
        if (data.courant && !/^\d+(\.?\d+)?(\s*A)?$/.test(data.courant)) {
            errors.push('Le courant nominal doit être une valeur numérique positive (ex. 630 A).');
        }
        if (data.pouvoir_coupure && !/^\d+(\.?\d+)?(\s*kA)?$/.test(data.pouvoir_coupure)) {
            errors.push('Le pouvoir de coupure doit être une valeur numérique positive (ex. 25 kA).');
        }
    } else if (data.equipmentType === 'cable_gaine') {
        if (data.type_cable && !['cable', 'gaine_barre'].includes(data.type_cable)) {
            errors.push('Type de câble invalide. Valeurs acceptées : cable, gaine_barre.');
        }
        if (data.section && !/^\d+(\.?\d+)?(\s*mm²)?$/.test(data.section)) {
            errors.push('La section doit être une valeur numérique positive (ex. 240 mm²).');
        }
        if (data.longueur && !/^\d+(\.?\d+)?(\s*m)?$/.test(data.longueur)) {
            errors.push('La longueur doit être une valeur numérique positive (ex. 50 m).');
        }
        if (data.courant_admissible && !/^\d+(\.?\d+)?(\s*A)?$/.test(data.courant_admissible)) {
            errors.push('Le courant admissible doit être une valeur numérique positive (ex. 400 A).');
        }
    }
    return errors;
}

// Validation des données de projet
function validateProjectData(data) {
    const errors = [];
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
        errors.push('Le nom du projet est requis et doit être une chaîne non vide.');
    }
    if (data.business_case_approved && typeof data.business_case_approved !== 'boolean') {
        errors.push('Business case approved doit être un booléen.');
    }
    if (data.pip_approved && typeof data.pip_approved !== 'boolean') {
        errors.push('PIP approved doit être un booléen.');
    }
    if (data.wbs_created && typeof data.wbs_created !== 'boolean') {
        errors.push('WBS created doit être un booléen.');
    }
    if (data.po_launched && typeof data.po_launched !== 'boolean') {
    errors.push('PO launched doit être un booléen.');
    }
    if (data.project_phase_completed && typeof data.project_phase_completed !== 'boolean') {
        errors.push('Project phase completed doit être un booléen.');
    }
    if (data.reception_completed && typeof data.reception_completed !== 'boolean') {
        errors.push('Reception completed doit être un booléen.');
    }
    if (data.closure_completed && typeof data.closure_completed !== 'boolean') {
        errors.push('Closure completed doit être un booléen.');
    }
    if (data.po_requests && !Array.isArray(data.po_requests)) {
        errors.push('Les demandes PO doivent être un tableau.');
    }
    if (data.quotes && !Array.isArray(data.quotes)) {
        errors.push('Les devis doivent être un tableau.');
    }
    if (data.attachments && !Array.isArray(data.attachments)) {
        errors.push('Les pièces jointes doivent être un tableau.');
    }
    if (data.gantt_data && typeof data.gantt_data !== 'object') {
        errors.push('Les données Gantt doivent être un objet JSON valide.');
    }
    if (data.budget_total && isNaN(parseFloat(data.budget_total))) {
        errors.push('Le budget total doit être un nombre.');
    }
    if (data.chantier_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.chantier_date)) {
        errors.push('La date du chantier doit être au format YYYY-MM-DD.');
    }
    return errors;
}

// Initialisation de la base de données
async function initDb() {
    console.log('[Server] Initialisation de la base de données');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        console.log('[Server] Connexion DB testée avec succès');

        // Création des tables
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

        // Trigger pour updated_at
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
        console.log('[Server] Tables créées avec succès');

        // Insérer des données par défaut pour maintenance_org si vide
        const orgCount = await client.query('SELECT COUNT(*) FROM maintenance_org');
        if (parseInt(orgCount.rows[0].count) === 0) {
            console.log('[Server] Insertion des données par défaut pour maintenance_org');
            await client.query(`
                INSERT INTO maintenance_org (label, role, contact, parent_id) VALUES
                ('Directeur Maintenance', 'Supervision générale', 'dir@autonomix.fr', NULL),
                ('Chef d’Équipe Électrique', 'Gestion des techniciens', 'chef@autonomix.fr', 1),
                ('Technicien Principal', 'Maintenance des tableaux', 'tech1@autonomix.fr', 2),
                ('Technicien Secondaire', 'Support technique', 'tech2@autonomix.fr', 2),
                ('Responsable Sécurité', 'Évaluation des risques', 'secu@autonomix.fr', 1)
            `);
            console.log('[Server] Données maintenance_org insérées');
        }

        // Normaliser les disjoncteurs existants
const result = await client.query('SELECT id, disjoncteurs FROM tableaux');
console.log('[Server] Tableaux à normaliser:', result.rows.length);
for (const row of result.rows) {
    try {
        // Vérifier si les disjoncteurs sont un tableau valide
        if (!Array.isArray(row.disjoncteurs)) {
            console.warn('[Server] Disjoncteurs non valides pour tableau:', row.id, 'Initialisation à []');
            await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', ['[]', row.id]);
            continue;
        }
        // Normaliser chaque disjoncteur
        const normalizedDisjoncteurs = row.disjoncteurs.map(d => {
            try {
                // Définir triptime par défaut basé sur la courbe
                const courbe = d.courbe ? d.courbe.toUpperCase() : 'C'; // Par défaut C si non spécifié
                let defaultTriptime;
                switch (courbe) {
                    case 'B':
                        defaultTriptime = 0.01; // 10 ms pour courbe B (éclairage, charges résistives)
                        break;
                    case 'C':
                        defaultTriptime = 0.02; // 20 ms pour courbe C (moteurs, charges courantes)
                        break;
                    case 'D':
                        defaultTriptime = 0.03; // 30 ms pour courbe D (forts courants d'appel)
                        break;
                    case 'K':
                        defaultTriptime = 0.015; // 15 ms pour courbe K (moteurs spécifiques)
                        break;
                    case 'Z':
                        defaultTriptime = 0.005; // 5 ms pour courbe Z (électronique sensible)
                        break;
                    default:
                        defaultTriptime = 0.02; // Valeur par défaut conservatrice
                }
                return {
                    ...d, // Conserver toutes les propriétés existantes
                    id: d.id || `unknown-${Math.random().toString(36).substring(2, 9)}`, // ID unique si manquant
                    cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength), // Longueur câble: 0 pour principal, 20m sinon
                    impedance: d.impedance || null, // Impédance nulle si non spécifiée
                    ue: d.ue || '400 V', // Tension nominale par défaut
                    section: d.section || `${getRecommendedSection(d.in)} mm²`, // Section basée sur In
                    icn: normalizeIcn(d.icn), // Normalisation du pouvoir de coupure
                    replacementDate: d.replacementDate || null, // Date de remplacement nulle si non spécifiée
                    humidite: d.humidite || 50, // Humidité par défaut
                    temp_ambiante: d.temp_ambiante || 25, // Température ambiante par défaut
                    charge: d.charge || 80, // Charge par défaut
                    linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [], // Normalisation des IDs liés
                    isPrincipal: !!d.isPrincipal, // Booléen pour principal
                    isHTAFeeder: !!d.isHTAFeeder, // Booléen pour HTA
                    triptime: d.triptime || defaultTriptime // Ajout de triptime par défaut
                };
            } catch (err) {
                console.warn('[Server] Erreur normalisation disjoncteur dans tableau:', row.id, 'Disjoncteur:', d, 'Erreur:', err.message);
                return null;
            }
        }).filter(d => d !== null); // Filtrer les disjoncteurs invalides
        // Vérifier si des disjoncteurs ont été ignorés
        if (normalizedDisjoncteurs.length !== row.disjoncteurs.length) {
            console.warn('[Server] Certains disjoncteurs ignorés pour tableau:', row.id, 'Orig:', row.disjoncteurs.length, 'Normalisés:', normalizedDisjoncteurs.length);
        }
        // Mettre à jour le tableau dans la base de données
        await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(normalizedDisjoncteurs), row.id]);
        console.log('[Server] Tableau normalisé:', row.id, 'Disjoncteurs:', normalizedDisjoncteurs.length);
    } catch (err) {
        console.error('[Server] Erreur normalisation tableau:', row.id, 'Erreur:', {
            message: err.message,
            stack: err.stack
        });
    }
}
console.log('[Server] Base de données initialisée avec succès');
} catch (error) {
    console.error('[Server] Erreur lors de l\'initialisation de la DB:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        detail: error.detail
    });
    throw error;
} finally {
    if (client) client.release();
}
}
initDb().catch(err => {
    console.error('[Server] Échec initialisation DB, arrêt serveur:', err);
    process.exit(1);
});

// Fonction pour normaliser icn (pouvoir de coupure)
function normalizeIcn(icn) {
    if (!icn) return null;
    if (typeof icn === 'number' && !isNaN(icn) && icn > 0) return `${icn} kA`;
    if (typeof icn === 'string') {
        const match = icn.match(/[\d.]+/);
        if (!match) return null;
        const number = parseFloat(match[0]);
        if (isNaN(number) || number <= 0) return null;
        const unit = icn.match(/[a-zA-Z]+$/i) || [''];
        return `${number} ${unit[0].toLowerCase() === 'a' ? 'kA' : unit[0] || 'kA'}`;
    }
    return null;
}

// Instance globale de navigateur puppeteer
let browser = null;

// Fonction pour capturer un graphique en image
async function captureChart(url, selector) {
    if (!browser) {
        console.log('[Server] Lancement du navigateur Puppeteer');
        browser = await puppeteer.launch({ headless: true });
    }
    const page = await browser.newPage();
    try {
        console.log(`[Server] Navigation vers ${url} pour capturer ${selector}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector(selector, { timeout: 60000 });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
        const element = await page.$(selector);
        if (!element) throw new Error(`Sélecteur ${selector} non trouvé sur ${url}`);
        const screenshot = await element.screenshot({ type: 'png' });
        console.log(`[Server] Capture réussie pour ${selector}`);
        return screenshot;
    } catch (error) {
        console.error(`[Server] Erreur capture graphique (${selector} sur ${url}):`, {
            message: error.message,
            stack: error.stack
        });
        throw error;
    } finally {
        await page.close();
    }
}

// Route pour rechercher les caractéristiques d'un disjoncteur
app.post('/api/disjoncteur', async (req, res) => {
    const { marque, ref } = req.body;
    console.log('[Server] POST /api/disjoncteur - Requête reçue:', { marque, ref });
    let client;
    try {
        client = await pool.connect();
        if (!marque || !ref) throw new Error('Marque et référence sont requis');
        const prompt = `Fournis les caractéristiques techniques du disjoncteur de marque "${marque}" et référence "${ref}". Retourne un JSON avec les champs suivants : id (laisser vide), type, poles, montage, ue, ui, uimp, frequence, in, ir, courbe, triptime, icn, ics, ip, temp, dimensions, section, date, tension, selectivite, lifespan (durée de vie en années, ex. 30), cableLength (laisser vide), impedance (laisser vide), humidite (en %, ex. 50), temp_ambiante (en °C, ex. 25), charge (en %, ex. 80), linkedTableauIds (tableau vide), isPrincipal (false), isHTAFeeder (false), equipmentType ("disjoncteur"). Si une information est manquante, utilise des valeurs par défaut plausibles ou laisse le champ vide.`;
        console.log('[Server] Prompt envoyé à OpenAI:', prompt);
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });
        const data = JSON.parse(response.choices[0].message.content);
        console.log('[Server] Réponse OpenAI:', data);
        if (Object.keys(data).length === 0) {
            console.log('[Server] Aucune donnée retournée par OpenAI');
            return res.status(404).json({ error: 'Aucune donnée trouvée pour ce disjoncteur' });
        }
        const validationErrors = validateDisjoncteurData(data);
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        const normalizedData = {
            ...data,
            icn: normalizeIcn(data.icn),
            section: data.section || `${getRecommendedSection(data.in)} mm²`,
            humidite: data.humidite || 50,
            temp_ambiante: data.temp_ambiante || 25,
            charge: data.charge || 80,
            linkedTableauIds: Array.isArray(data.linkedTableauIds) ? data.linkedTableauIds : [],
            isPrincipal: !!data.isPrincipal,
            isHTAFeeder: !!data.isHTAFeeder,
            equipmentType: 'disjoncteur'
        };
        res.json(normalizedData);
    } catch (error) {
        console.error('[Server] Erreur POST /api/disjoncteur:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la recherche: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour récupérer les équipements existants (disjoncteurs et autres)
app.get('/api/equipements', async (req, res) => {
    console.log('[Server] GET /api/equipements');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        // Récupérer les disjoncteurs
        const disjoncteursResult = await client.query('SELECT id, disjoncteurs FROM tableaux');
        const allDisjoncteurs = disjoncteursResult.rows.flatMap(row => Array.isArray(row.disjoncteurs) ? row.disjoncteurs.map(d => ({ ...d, equipmentType: 'disjoncteur' })) : []);
        const uniqueDisjoncteurs = Array.from(new Map(allDisjoncteurs.map(d => [`${d.equipmentType}-${d.marque}-${d.ref || d.id}`, d])).values());
        // Récupérer les autres équipements
        const equipementsResult = await client.query('SELECT equipment_id, equipment_type, data FROM equipements');
        const autresEquipements = equipementsResult.rows.map(row => ({
            id: row.equipment_id,
            equipmentType: row.equipment_type,
            ...row.data
        }));
        const allEquipements = [...uniqueDisjoncteurs, ...autresEquipements];
        console.log('[Server] Équipements uniques:', allEquipements.length);
        res.json(allEquipements);
    } catch (error) {
        console.error('[Server] Erreur GET /api/equipements:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour lister les identifiants des tableaux
app.get('/api/tableaux/ids', async (req, res) => {
    console.log('[Server] GET /api/tableaux/ids');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('SELECT id FROM tableaux');
        const ids = result.rows.map(row => row.id);
        console.log('[Server] IDs tableaux:', ids);
        res.json(ids);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux/ids:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des IDs: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour récupérer un tableau spécifique
app.get('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] GET /api/tableaux/:id', id);
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const columnsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tableaux'");
        console.log('[Server] Colonnes de la table tableaux:', columnsResult.rows.map(row => row.column_name));
        const tableauResult = await client.query(
            'SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux WHERE id = $1',
            [id]
        );
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const equipementsResult = await client.query(
            'SELECT equipment_id, equipment_type, data FROM equipements WHERE tableau_id = $1',
            [id]
        );
        const tableau = {
            id: tableauResult.rows[0].id,
            disjoncteurs: tableauResult.rows[0].disjoncteurs || [],
            autresEquipements: equipementsResult.rows.map(row => ({
                id: row.equipment_id,
                equipmentType: row.equipment_type,
                ...row.data
            })),
            isSiteMain: tableauResult.rows[0].issitemain || false,
            isHTA: tableauResult.rows[0].ishta || false,
            htaData: tableauResult.rows[0].htadata || null
        };
        console.log('[Server] Tableau trouvé:', {
            id: tableau.id,
            disjoncteurs: Array.isArray(tableau.disjoncteurs) ? tableau.disjoncteurs.length : 'Invalid',
            autresEquipements: tableau.autresEquipements.length,
            isSiteMain: tableau.isSiteMain,
            isHTA: tableau.isHTA,
            htaData: tableau.htaData
        });
        if (!Array.isArray(tableau.disjoncteurs)) {
            console.warn('[Server] Disjoncteurs non valides pour tableau:', id, 'Initialisation à []');
            tableau.disjoncteurs = [];
            await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', ['[]', id]);
        }
        res.json(tableau);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    } finally {
        if (client) {
            client.release();
            console.log('[Server] Client PostgreSQL libéré pour GET /api/tableaux/:id');
        }
    }
});

// Route pour récupérer tous les tableaux
app.get('/api/tableaux', async (req, res) => {
    console.log('[Server] GET /api/tableaux');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const tableauxResult = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
        const equipementsResult = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
        console.log('[Server] Tableaux récupérés:', tableauxResult.rows.length);
        const tableaux = tableauxResult.rows.map(tableau => {
            const autresEquipements = equipementsResult.rows
                .filter(row => row.tableau_id === tableau.id)
                .map(row => ({
                    id: row.equipment_id,
                    equipmentType: row.equipment_type,
                    ...row.data
                }));
            return {
                id: tableau.id,
                disjoncteurs: Array.isArray(tableau.disjoncteurs) ? tableau.disjoncteurs : [],
                autresEquipements,
                isSiteMain: tableau.issitemain || false,
                isHTA: tableau.ishta || false,
                htaData: tableau.htadata || null
            };
        });
        res.json(tableaux);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des tableaux: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour /api/selectivity
app.get('/api/selectivity', async (req, res) => {
    console.log('[Server] GET /api/selectivity');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
        const tableaux = result.rows.map(row => ({
            id: row.id,
            disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
            building: row.id.split('-')[0] || 'Inconnu',
            isSiteMain: !!row.issitemain,
            isHTA: !!row.ishta,
            htaData: row.htadata || null
        }));
        console.log('[Server] Tableaux pour sélectivité:', tableaux.length);
        res.json(tableaux);
    } catch (error) {
        console.error('[Server] Erreur GET /api/selectivity:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des données de sélectivité: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour /api/arc-flash
app.get('/api/arc-flash', async (req, res) => {
    console.log('[Server] GET /api/arc-flash');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
        const tableaux = result.rows.map(row => ({
            id: row.id,
            disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
            building: row.id.split('-')[0] || 'Inconnu',
            isSiteMain: !!row.issitemain,
            isHTA: !!row.ishta,
            htaData: row.htadata || null
        }));
        console.log('[Server] Tableaux pour arc flash:', tableaux.length);
        res.json(tableaux);
    } catch (error) {
        console.error('[Server] Erreur GET /api/arc-flash:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des données d’arc flash: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour créer un nouveau tableau
app.post('/api/tableaux', async (req, res) => {
    const { id, disjoncteurs, autresEquipements, isSiteMain, isHTA, htaData } = req.body;
    console.log('[Server] POST /api/tableaux - Requête reçue:', { id, disjoncteurs: disjoncteurs?.length, autresEquipements: autresEquipements?.length, isSiteMain, isHTA });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!id || !/^[\p{L}0-9\s\-_:]+$/u.test(id)) {
            throw new Error('L’ID du tableau est requis et doit être valide');
        }
        if (!Array.isArray(disjoncteurs)) {
            throw new Error('Les disjoncteurs doivent être un tableau');
        }
        if (!Array.isArray(autresEquipements)) {
            throw new Error('Les autres équipements doivent être un tableau');
        }
        const checkResult = await client.query('SELECT id FROM tableaux WHERE id = $1', [id]);
        if (checkResult.rows.length > 0) {
            console.log('[Server] Erreur: ID tableau déjà utilisé:', id);
            return res.status(400).json({ error: 'Cet identifiant de tableau existe déjà' });
        }
        // Validation des disjoncteurs
        const disjoncteurIds = disjoncteurs.map(d => d.id).filter(id => id);
        const equipementIds = autresEquipements.map(e => e.id).filter(id => id);
        const allIds = [...disjoncteurIds, ...equipementIds];
        const uniqueIds = new Set(allIds);
        if (uniqueIds.size !== allIds.length) {
            console.log('[Server] Erreur: IDs non uniques:', allIds);
            const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
            throw new Error(`Les IDs suivants sont dupliqués dans le tableau : ${duplicateIds.join(', ')}`);
        }
        // Validation des linkedTableauIds
        for (const d of disjoncteurs) {
            if (d.linkedTableauIds && d.linkedTableauIds.length > 0) {
                const invalidIds = d.linkedTableauIds.filter(lid => lid === id || !/^[\p{L}0-9\s\-_:]+$/u.test(lid));
                if (invalidIds.length > 0) {
                    throw new Error(`IDs de tableaux liés invalides pour disjoncteur ${d.id}: ${invalidIds.join(', ')}`);
                }
                const linkedTableaux = await client.query('SELECT id FROM tableaux WHERE id = ANY($1)', [d.linkedTableauIds]);
                if (linkedTableaux.rows.length !== d.linkedTableauIds.length) {
                    const missingIds = d.linkedTableauIds.filter(lid => !linkedTableaux.rows.some(row => row.id === lid));
                    throw new Error(`Tableaux liés non trouvés pour disjoncteur ${d.id}: ${missingIds.join(', ')}`);
                }
            }
            const validationErrors = validateDisjoncteurData(d);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour disjoncteur ${d.id}: ${validationErrors.join('; ')}`);
            }
        }
        // Validation des autres équipements
        for (const e of autresEquipements) {
            const validationErrors = validateEquipementData(e);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour équipement ${e.id}: ${validationErrors.join('; ')}`);
            }
        }
        // Validation des données HTA
        if (isHTA) {
            const htaErrors = validateHTAData(htaData);
            if (htaErrors.length > 0) {
                console.log('[Server] Erreurs de validation HTA:', htaErrors);
                throw new Error(`Données HTA invalides: ${htaErrors.join('; ')}`);
            }
        }
        // Normalisation des disjoncteurs
        const normalizedDisjoncteurs = disjoncteurs.map(d => {
            const validationErrors = validateDisjoncteurData(d);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour disjoncteur ${d.id}: ${validationErrors.join('; ')}`);
            }
            const courbe = d.courbe ? d.courbe.toUpperCase() : 'C';
            let defaultTriptime;
            switch (courbe) {
                case 'B': defaultTriptime = 0.01; break;
                case 'C': defaultTriptime = 0.02; break;
                case 'D': defaultTriptime = 0.03; break;
                case 'K': defaultTriptime = 0.015; break;
                case 'Z': defaultTriptime = 0.005; break;
                default: defaultTriptime = 0.02;
            }
            return {
                ...d,
                icn: normalizeIcn(d.icn),
                cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength),
                section: d.section || `${getRecommendedSection(d.in)} mm²`,
                ue: d.ue || '400 V',
                triptime: d.triptime || defaultTriptime, // Ajout de triptime
                humidite: d.humidite || 50,
                temp_ambiante: d.temp_ambiante || 25,
                charge: d.charge || 80,
                linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [],
                isPrincipal: !!d.isPrincipal,
                isHTAFeeder: !!d.isHTAFeeder
            };
        });
        // Insérer le tableau
        await client.query(
            'INSERT INTO tableaux (id, disjoncteurs, issitemain, ishta, htadata) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)',
            [id, JSON.stringify(normalizedDisjoncteurs), !!isSiteMain, !!isHTA, isHTA ? JSON.stringify(htaData) : null]
        );
        // Insérer les autres équipements
        for (const e of autresEquipements) {
            const data = { ...e };
            delete data.id;
            delete data.equipmentType;
            await client.query(
                'INSERT INTO equipements (tableau_id, equipment_id, equipment_type, data) VALUES ($1, $2, $3, $4::jsonb)',
                [id, e.id, e.equipmentType, JSON.stringify(data)]
            );
        }
        // Ajouter une checklist par défaut pour chaque disjoncteur
        for (const d of normalizedDisjoncteurs) {
            if (!d.id) {
                console.warn('[Server] Disjoncteur sans ID ignoré pour checklist:', d);
                continue;
            }
            try {
                await client.query(
                    'INSERT INTO breaker_checklists (tableau_id, disjoncteur_id, status, comment, photo) VALUES ($1, $2, $3, $4, $5)',
                    [id, d.id, 'Conforme', 'Contrôle initial par défaut', null]
                );
            } catch (checklistError) {
                console.warn('[Server] Erreur insertion checklist pour disjoncteur:', d.id, {
                    message: checklistError.message,
                    code: checklistError.code
                });
            }
        }
        console.log('[Server] Tableau créé:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/tableaux:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la création: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour mettre à jour un tableau
app.put('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    const { disjoncteurs, autresEquipements, isSiteMain, isHTA, htaData } = req.body;
    console.log('[Server] PUT /api/tableaux/:id', id, { disjoncteurs: disjoncteurs?.length, autresEquipements: autresEquipements?.length, isSiteMain, isHTA, htaData });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!id || !Array.isArray(disjoncteurs) || !Array.isArray(autresEquipements)) {
            throw new Error('ID, disjoncteurs et autres équipements (tableaux) sont requis');
        }
        const checkResult = await client.query('SELECT id FROM tableaux WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        // Validation des disjoncteurs
        const disjoncteurIds = disjoncteurs.map(d => d.id).filter(id => id);
        const equipementIds = autresEquipements.map(e => e.id).filter(id => id);
        const allIds = [...disjoncteurIds, ...equipementIds];
        const uniqueIds = new Set(allIds);
        if (uniqueIds.size !== allIds.length) {
            console.log('[Server] Erreur: IDs non uniques:', allIds);
            const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
            throw new Error(`Les IDs suivants sont dupliqués dans le tableau : ${duplicateIds.join(', ')}`);
        }
        // Validation des linkedTableauIds
        for (const d of disjoncteurs) {
            if (d.linkedTableauIds && d.linkedTableauIds.length > 0) {
                const invalidIds = d.linkedTableauIds.filter(lid => lid === id || !/^[\p{L}0-9\s\-_:]+$/u.test(lid));
                if (invalidIds.length > 0) {
                    throw new Error(`IDs de tableaux liés invalides pour disjoncteur ${d.id}: ${invalidIds.join(', ')}`);
                }
                const linkedTableaux = await client.query('SELECT id FROM tableaux WHERE id = ANY($1)', [d.linkedTableauIds]);
                if (linkedTableaux.rows.length !== d.linkedTableauIds.length) {
                    const missingIds = d.linkedTableauIds.filter(lid => !linkedTableaux.rows.some(row => row.id === lid));
                    throw new Error(`Tableaux liés non trouvés pour disjoncteur ${d.id}: ${missingIds.join(', ')}`);
                }
            }
            const validationErrors = validateDisjoncteurData(d);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour disjoncteur ${d.id || 'sans ID'}: ${validationErrors.join('; ')}`);
            }
        }
        // Validation des autres équipements
        for (const e of autresEquipements) {
            const validationErrors = validateEquipementData(e);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour équipement ${e.id}: ${validationErrors.join('; ')}`);
            }
        }
        // Validation des données HTA
        if (isHTA) {
            const htaErrors = validateHTAData(htaData);
            if (htaErrors.length > 0) {
                console.log('[Server] Erreurs de validation HTA:', htaErrors);
                throw new Error(`Données HTA invalides: ${htaErrors.join('; ')}`);
            }
        }
        // Normalisation des disjoncteurs
        const normalizedDisjoncteurs = disjoncteurs.map(d => ({
            ...d,
            icn: normalizeIcn(d.icn),
            cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength),
            section: d.section || `${getRecommendedSection(d.in)} mm²`,
            humidite: d.humidite || 50,
            temp_ambiante: d.temp_ambiante || 25,
            charge: d.charge || 80,
            linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [],
            isPrincipal: !!d.isPrincipal,
            isHTAFeeder: !!d.isHTAFeeder,
            equipmentType: 'disjoncteur'
        }));
        // Mise à jour des disjoncteurs
        const result = await client.query(
            'UPDATE tableaux SET disjoncteurs = $1::jsonb, issitemain = $2, ishta = $3, htadata = $4::jsonb WHERE id = $5 RETURNING id, disjoncteurs, issitemain, ishta, htadata',
            [JSON.stringify(normalizedDisjoncteurs), !!isSiteMain, !!isHTA, isHTA ? JSON.stringify(htaData) : null, id]
        );
        // Supprimer les anciens équipements
        await client.query('DELETE FROM equipements WHERE tableau_id = $1', [id]);
        // Insérer les nouveaux équipements
        for (const e of autresEquipements) {
            const data = { ...e };
            delete data.id;
            delete data.equipmentType;
            await client.query(
                'INSERT INTO equipements (tableau_id, equipment_id, equipment_type, data) VALUES ($1, $2, $3, $4::jsonb)',
                [id, e.id, e.equipmentType, JSON.stringify(data)]
            );
        }
        console.log('[Server] Tableau modifié:', {
            id,
            disjoncteurs: normalizedDisjoncteurs.length,
            autresEquipements: autresEquipements.length,
            isSiteMain: result.rows[0].issitemain,
            isHTA: result.rows[0].ishta,
            htaData: result.rows[0].htadata
        });
        res.json({
            success: true,
            data: {
                id: result.rows[0].id,
                disjoncteurs: result.rows[0].disjoncteurs,
                autresEquipements,
                isSiteMain: result.rows[0].issitemain,
                isHTA: result.rows[0].ishta,
                htaData: result.rows[0].htadata
            }
        });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(error.message.includes('invalides') || error.message.includes('non trouvé') ? 400 : 500).json({ 
            error: 'Erreur lors de la mise à jour: ' + error.message 
        });
    } finally {
        if (client) {
            client.release();
            console.log('[Server] Client PostgreSQL libéré pour PUT /api/tableaux/:id');
        }
    }
});

// Route pour supprimer un tableau
app.delete('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/tableaux/:id', id);
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        // Vérifier si le tableau est lié par un disjoncteur
        const linkedCheck = await client.query('SELECT id, disjoncteurs FROM tableaux');
        const linkedBy = linkedCheck.rows.filter(row => 
            row.disjoncteurs.some(d => Array.isArray(d.linkedTableauIds) && d.linkedTableauIds.includes(id))
        );
        if (linkedBy.length > 0) {
            const linkedInfo = linkedBy.map(row => `${row.id} (disjoncteurs: ${row.disjoncteurs.filter(d => d.linkedTableauIds?.includes(id)).map(d => d.id).join(', ')})`).join('; ');
            console.log('[Server] Erreur: Tableau lié par d’autres tableaux:', linkedInfo);
            return res.status(400).json({ error: `Impossible de supprimer : ce tableau est lié par ${linkedInfo}.` });
        }
        // Supprimer le tableau (les dépendances sont gérées par ON DELETE CASCADE)
        const result = await client.query('DELETE FROM tableaux WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        console.log('[Server] Tableau supprimé:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Calcul de l'obsolescence avec facteurs environnementaux
function calculateAdjustedLifespan(disjoncteur) {
    const lifespan = parseInt(disjoncteur.lifespan) || 30;
    let humidityFactor = 1.0;
    let temperatureFactor = 1.0;
    let loadFactor = 1.0;
    let criticalReason = [];

    const humidite = parseFloat(disjoncteur.humidite) || 50;
    if (humidite > 70) {
        const excess = (humidite - 70) / 10;
        humidityFactor = Math.max(0.5, 1.0 - (0.1 * excess));
        criticalReason.push(`Humidité élevée (${humidite}%)`);
    }

    const temp_ambiante = parseFloat(disjoncteur.temp_ambiante) || 25;
    if (temp_ambiante > 40) {
        const excess = (temp_ambiante - 40) / 5;
        temperatureFactor = Math.max(0.5, 1.0 - (0.05 * excess));
        criticalReason.push(`Température élevée (${temp_ambiante}°C)`);
    } else if (temp_ambiante < -5) {
        const excess = (-5 - temp_ambiante) / 5;
        temperatureFactor = Math.max(0.5, 1.0 - (0.05 * excess));
        criticalReason.push(`Température basse (${temp_ambiante}°C)`);
    }

    const charge = parseFloat(disjoncteur.charge) || 80;
    if (charge > 80) {
        const excess = (charge - 80) / 10;
        loadFactor = Math.max(0.5, 1.0 - (0.05 * excess));
        criticalReason.push(`Surcharge (${charge}%)`);
    }

    const adjustedLifespan = Math.round(lifespan * humidityFactor * temperatureFactor * loadFactor);
    const isCritical = adjustedLifespan <= 5 || criticalReason.length > 0;

    return {
        adjustedLifespan,
        isCritical,
        criticalReason: criticalReason.length > 0 ? criticalReason.join(', ') : null
    };
}

// Route pour analyser l'obsolescence
app.get('/api/obsolescence', async (req, res) => {
    console.log('[Server] GET /api/obsolescence');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const tableauxResult = await client.query('SELECT id, disjoncteurs, issitemain FROM tableaux');
        const equipementsResult = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
        const tableaux = tableauxResult.rows.map(row => {
            const disjoncteurs = (Array.isArray(row.disjoncteurs) ? row.disjoncteurs : []).map(d => {
                const date = d.date ? new Date(d.date) : null;
                const manufactureYear = date ? date.getFullYear() : null;
                const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                const { adjustedLifespan, isCritical, criticalReason } = calculateAdjustedLifespan(d);
                const status = age !== null && age >= adjustedLifespan ? 'Obsolète' : 'OK';
                let replacementDate = d.replacementDate || replacementDates[`${row.id}-${d.id}`] || null;
                if (!replacementDate) {
                    if (status === 'Obsolète') {
                        replacementDate = `${new Date().getFullYear() + 1}-01-01`;
                    } else if (!manufactureYear) {
                        replacementDate = `${new Date().getFullYear() + 2}-01-01`;
                    }
                }
                return {
                    ...d,
                    manufactureYear,
                    age,
                    status,
                    replacementDate,
                    adjustedLifespan,
                    isCritical,
                    criticalReason
                };
            });
            const autresEquipements = equipementsResult.rows
                .filter(e => e.tableau_id === row.id)
                .map(e => {
                    const date = e.data.date ? new Date(e.data.date) : null;
                    const manufactureYear = date ? date.getFullYear() : null;
                    const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                    const status = age !== null && age >= 30 ? 'Obsolète' : 'OK'; // Durée de vie par défaut de 30 ans
                    let replacementDate = replacementDates[`${row.id}-${e.equipment_id}`] || null;
                    if (!replacementDate && status === 'Obsolète') {
                        replacementDate = `${new Date().getFullYear() + 1}-01-01`;
                    }
                    return {
                        id: e.equipment_id,
                        equipmentType: e.equipment_type,
                        ...e.data,
                        manufactureYear,
                        age,
                        status,
                        replacementDate
                    };
                });
            const validYears = [...disjoncteurs, ...autresEquipements]
                .map(item => item.manufactureYear)
                .filter(year => typeof year === 'number' && !isNaN(year));
            const avgManufactureYear = validYears.length
                ? Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length)
                : 2000;
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                autresEquipements,
                avgManufactureYear,
                isSiteMain: !!row.issitemain
            };
        });
        console.log('[Server] Données obsolescence:', tableaux.length);
        res.json({ data: tableaux });
    } catch (error) {
        console.error('[Server] Erreur GET /api/obsolescence:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de l\'analyse: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour mettre à jour la date de remplacement
app.post('/api/obsolescence/update', async (req, res) => {
    const { tableauId, disjoncteurId, equipmentId, replacementDate } = req.body;
    console.log('[Server] POST /api/obsolescence/update - Requête reçue:', { tableauId, disjoncteurId, equipmentId, replacementDate });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!tableauId || (!disjoncteurId && !equipmentId) || !replacementDate) {
            throw new Error('Tableau ID, ID de disjoncteur ou d\'équipement, et date de remplacement sont requis');
        }
        if (disjoncteurId) {
            const result = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
            if (result.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableauId);
                return res.status(404).json({ error: 'Tableau non trouvé' });
            }
            const disjoncteurs = Array.isArray(result.rows[0].disjoncteurs) ? result.rows[0].disjoncteurs : [];
            const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === disjoncteurId);
            if (disjoncteurIndex === -1) {
                console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
                return res.status(404).json({ error: 'Disjoncteur non trouvé' });
            }
            disjoncteurs[disjoncteurIndex].replacementDate = replacementDate;
            await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
            console.log('[Server] Date de remplacement mise à jour pour disjoncteur:', { tableauId, disjoncteurId, replacementDate });
        } else if (equipmentId) {
            const result = await client.query('SELECT data FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, equipmentId]);
            if (result.rows.length === 0) {
                console.log('[Server] Équipement non trouvé:', equipmentId);
                return res.status(404).json({ error: 'Équipement non trouvé' });
            }
            const data = { ...result.rows[0].data, replacementDate };
            await client.query('UPDATE equipements SET data = $1::jsonb WHERE tableau_id = $2 AND equipment_id = $3', [JSON.stringify(data), tableauId, equipmentId]);
            console.log('[Server] Date de remplacement mise à jour pour équipement:', { tableauId, equipmentId, replacementDate });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/obsolescence/update:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Route pour sauvegarder la date de remplacement manuellement (pour Gantt)
app.post('/api/obsolescence/replacement', (req, res) => {
    const { tableauId, replacementYear } = req.body;
    console.log('[Server] POST /api/obsolescence/replacement - Requête reçue:', { tableauId, replacementYear });
    try {
        if (!tableauId || !replacementYear) {
            throw new Error('Tableau ID et année de remplacement sont requis');
        }
        replacementDates[tableauId] = replacementYear;
        fs.writeFileSync(REPLACEMENT_FILE, JSON.stringify(replacementDates, null, 2));
        console.log(`[Server] Date de remplacement mise à jour: ${tableauId} => ${replacementYear}`);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/obsolescence/replacement:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement: ' + error.message });
    }
});

// Route pour générer les rapports PDF
app.post('/api/reports', async (req, res) => {
    const { reportType, filters } = req.body;
    console.log('[Server] POST /api/reports - Début de la génération:', { reportType, filters });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const tableauxResult = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
        const equipementsResult = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
        let tableauxData = tableauxResult.rows.map(row => {
            const autresEquipements = equipementsResult.rows
                .filter(e => e.tableau_id === row.id)
                .map(e => ({
                    id: e.equipment_id,
                    equipmentType: e.equipment_type,
                    ...e.data
                }));
            return {
                ...row,
                disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
                autresEquipements
            };
        });
        let tableauxReportData = tableauxData;
        let selectivityReportData = tableauxData;
        let obsolescenceReportData = tableauxData.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                const date = d.date ? new Date(d.date) : null;
                const manufactureYear = date ? date.getFullYear() : null;
                const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                const { adjustedLifespan, isCritical, criticalReason } = calculateAdjustedLifespan(d);
                const status = age !== null && age >= adjustedLifespan ? 'Obsolète' : 'OK';
                let replacementDate = d.replacementDate || replacementDates[`${row.id}-${d.id}`] || null;
                if (!replacementDate) {
                    if (status === 'Obsolète') {
                        replacementDate = `${new Date().getFullYear() + 1}-01-01`;
                    } else if (!manufactureYear) {
                        replacementDate = `${new Date().getFullYear() + 2}-01-01`;
                    }
                }
                return { ...d, manufactureYear, age, status, replacementDate, adjustedLifespan, isCritical, criticalReason };
            });
            const autresEquipements = row.autresEquipements.map(e => {
                const date = e.date ? new Date(e.date) : null;
                const manufactureYear = date ? date.getFullYear() : null;
                const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                const status = age !== null && age >= 30 ? 'Obsolète' : 'OK';
                let replacementDate = e.replacementDate || replacementDates[`${row.id}-${e.id}`] || null;
                if (!replacementDate && status === 'Obsolète') {
                    replacementDate = `${new Date().getFullYear() + 1}-01-01`;
                }
                return { ...e, manufactureYear, age, status, replacementDate };
            });
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                autresEquipements,
                isSiteMain: !!row.issitemain
            };
        });
        let faultLevelReportData = tableauxData.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                let ik = null;
                if (d.ue && (d.impedance || d.section)) {
                    const ueMatch = d.ue.match(/[\d.]+/);
                    const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
                    let z;
                    let L = isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength);
                    if (d.isPrincipal && L < 0) L = 0;
                    else if (!d.isPrincipal && L < 20) L = 20;
                    if (d.impedance) {
                        z = parseFloat(d.impedance);
                        if (z < 0.05) z = 0.05;
                    } else {
                        const rho = 0.0175;
                        const sectionMatch = d.section ? d.section.match(/[\d.]+/) : null;
                        const S = sectionMatch ? parseFloat(sectionMatch[0]) : getRecommendedSection(d.in);
                        const Z_cable = (rho * L * 2) / S;
                        const Z_network = 0.01;
                        z = Z_cable + Z_network;
                        if (z < 0.05) z = 0.05;
                    }
                    ik = (ue / (Math.sqrt(3) * z)) / 1000;
                    if (ik > 100) ik = null;
                }
                return { ...d, ik, icn: normalizeIcn(d.icn), tableauId: row.id };
            });
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                isSiteMain: !!row.issitemain
            };
        });
        let safetyReportData = [];
        if (reportType === 'all' || reportType === 'safety') {
            const safetyResult = await client.query('SELECT * FROM safety_actions');
            safetyReportData = safetyResult.rows.map(row => ({
                id: row.id,
                type: row.type,
                description: row.description,
                building: row.building,
                tableau: row.tableau_id,
                status: row.status,
                date: row.date ? row.date.toISOString().split('T')[0] : null
            }));
        }
        if (filters) {
            tableauxData = tableauxData.filter(tableau => {
                let keep = true;
                if (filters.building && tableau.id.split('-')[0] !== filters.building) keep = false;
                if (filters.tableau && tableau.id !== filters.tableau) keep = false;
                if (filters.disjoncteur) {
                    keep = tableau.disjoncteurs.some(d => d.id === filters.disjoncteur);
                }
                if (filters.equipement) {
                    keep = tableau.autresEquipements.some(e => e.id === filters.equipement);
                }
                if (filters.dateFabrication) {
                    keep = tableau.disjoncteurs.some(d => d.date === filters.dateFabrication) ||
                           tableau.autresEquipements.some(e => e.date === filters.dateFabrication);
                }
                if (filters.courantNominal) {
                    keep = tableau.disjoncteurs.some(d => d.in === filters.courantNominal) ||
                           tableau.autresEquipements.some(e => e.courant === filters.courantNominal || e.courant_admissible === filters.courantNominal);
                }
                return keep;
            });
            if (reportType === 'all' || reportType === 'safety') {
                safetyReportData = safetyReportData.filter(action => {
                    let keep = true;
                    if (filters.building && action.building !== filters.building) keep = false;
                    if (filters.tableau && action.tableau !== filters.tableau) keep = false;
                    if (filters.safetyStatus) keep = action.status === filters.safetyStatus;
                    return keep;
                });
            }
            if (reportType !== 'all') {
                const specificData = reportType === 'obsolescence' ? obsolescenceReportData :
                                     reportType === 'fault_level' ? faultLevelReportData :
                                     reportType === 'safety' ? safetyReportData : tableauxData;
                const filteredSpecificData = specificData.filter(item => {
                    let keep = true;
                    if (reportType === 'selectivity' && filters.statutSelectivite) {
                        keep = item.disjoncteurs.some(d => d.selectivityStatus === filters.statutSelectivite);
                    }
                    if (reportType === 'obsolescence' && filters.statutObsolescence) {
                        keep = item.disjoncteurs.some(d => d.status === filters.statutObsolescence) ||
                               item.autresEquipements.some(e => e.status === filters.statutObsolescence);
                    }
                    if (reportType === 'fault_level' && filters.statutFault) {
                        keep = item.disjoncteurs.some(d => (d.ik && d.icn && (d.ik > d.icn ? 'KO' : 'OK') === filters.statutFault));
                    }
                    if (reportType === 'safety' && filters.safetyStatus) {
                        keep = item.status === filters.safetyStatus;
                    }
                    return keep;
                });
                if (reportType === 'obsolescence') obsolescenceReportData = filteredSpecificData;
                else if (reportType === 'fault_level') faultLevelReportData = filteredSpecificData;
                else if (reportType === 'safety') safetyReportData = filteredSpecificData;
                else tableauxData = filteredSpecificData;
            }
        }
        console.log('[Server] Préparation du PDF');
        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=rapport_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`);
        doc.pipe(res);
        const logoPath = 'logo.png';
        if (fs.existsSync(logoPath)) {
            console.log('[Server] Logo trouvé, ajout au PDF');
            doc.image(logoPath, 450, 30, { width: 100 });
        } else {
            console.warn('[Server] Logo non trouvé à l\'emplacement:', logoPath);
        }
        doc.fontSize(20).text('Rapport Autonomix Elec', 50, 50);
        doc.moveDown(2);
        if (reportType === 'all' || reportType === 'tableaux') {
            console.log('[Server] Génération section Tableaux');
            doc.fontSize(16).text('Rapport des Tableaux', 50, doc.y);
            doc.moveDown();
            doc.fontSize(12);
            doc.text('Tableau | Bâtiment | Disjoncteurs | Autres Équipements', 50, doc.y);
            doc.moveDown(0.5);
            tableauxReportData.forEach(tableau => {
                doc.text(`${tableau.id} | ${tableau.building} | ${tableau.disjoncteurs.length} | ${tableau.autresEquipements.length}`, 50, doc.y);
                doc.moveDown(0.5);
                tableau.autresEquipements.forEach(e => {
                    const typeText = e.equipmentType === 'transformateur' ? 'Transformateur' :
                                     e.equipmentType === 'cellule_mt' ? 'Cellule MT' :
                                     e.equipmentType === 'cable_gaine' ? (e.type_cable === 'cable' ? 'Câble' : 'Gaine à Barre') : 'Inconnu';
                    doc.text(`  - ${e.id} | ${typeText} | ${e.marque || 'N/A'} | ${e.ref || 'N/A'}`, 50, doc.y);
                    doc.moveDown(0.5);
                });
            });
            doc.moveDown();
        }
        if (reportType === 'all' || reportType === 'selectivity') {
            console.log('[Server] Génération section Sélectivité');
            doc.fontSize(16).text('Rapport de Sélectivité', 50, doc.y);
            doc.moveDown();
            doc.fontSize(12);
            doc.text('Tableau | Disjoncteur Principal | Statut', 50, doc.y);
            doc.moveDown(0.5);
            selectivityReportData.forEach(tableau => {
                const principal = tableau.disjoncteurs.find(d => d.isPrincipal || d.isHTAFeeder) || {};
                doc.text(`${tableau.id} | ${principal.id || 'N/A'} | ${principal.selectivityStatus || 'N/A'}`, 50, doc.y);
                doc.moveDown(0.5);
            });
            try {
                console.log('[Server] Capture schéma électrique');
                const schemaImage = await captureChart('http://localhost:3000/selectivity.html', '#network-schema');
                doc.addPage();
                doc.fontSize(16).text('Schéma Électrique', 50, 50);
                doc.image(schemaImage, 50, 100, { width: 500 });
            } catch (error) {
                console.warn('[Server] Erreur capture schéma:', error.message);
            }
        }
        if (reportType === 'all' || reportType === 'obsolescence') {
            console.log('[Server] Génération section Obsolescence');
            doc.fontSize(16).text('Rapport d\'Obsolescence', 50, doc.y);
            doc.moveDown();
            doc.fontSize(12);
            doc.text('Tableau | Équipement | Type | Âge | Statut | Date de remplacement', 50, doc.y);
            doc.moveDown(0.5);
            obsolescenceReportData.forEach(tableau => {
                tableau.disjoncteurs.forEach(d => {
                    doc.text(`${tableau.id} | ${d.id} | Disjoncteur | ${d.age || 'N/A'} | ${d.status} | ${d.replacementDate || 'N/A'}`, 50, doc.y);
                    doc.moveDown(0.5);
                });
                tableau.autresEquipements.forEach(e => {
                    const typeText = e.equipmentType === 'transformateur' ? 'Transformateur' :
                                     e.equipmentType === 'cellule_mt' ? 'Cellule MT' :
                                     e.equipmentType === 'cable_gaine' ? (e.type_cable === 'cable' ? 'Câble' : 'Gaine à Barre') : 'Inconnu';
                    doc.text(`${tableau.id} | ${e.id} | ${typeText} | ${e.age || 'N/A'} | ${e.status} | ${e.replacementDate || 'N/A'}`, 50, doc.y);
                    doc.moveDown(0.5);
                });
            });
            try {
                console.log('[Server] Capture graphique CAPEX');
                const capexImage = await captureChart('http://localhost:3000/obsolescence.html', '#gantt-table');
                doc.addPage();
                doc.fontSize(16).text('Prévision CAPEX', 50, 50);
                doc.image(capexImage, 50, 100, { width: 500 });
            } catch (error) {
                console.warn('[Server] Erreur capture CAPEX:', error.message);
            }
        }
        if (reportType === 'all' || reportType === 'fault_level') {
            console.log('[Server] Génération section Niveau de Défaut');
            doc.fontSize(16).text('Rapport d\'Évaluation du Niveau de Défaut', 50, doc.y);
            doc.moveDown();
            doc.fontSize(12);
            doc.text('Tableau | Disjoncteur | Ik (kA) | Icn (kA) | Statut', 50, doc.y);
            doc.moveDown(0.5);
            faultLevelReportData.forEach(tableau => {
                tableau.disjoncteurs.forEach(d => {
                    const statut = d.ik && d.icn ? (d.ik > d.icn ? 'KO' : 'OK') : 'N/A';
                    doc.text(`${tableau.id} | ${d.id} | ${d.ik || 'N/A'} | ${d.icn || 'N/A'} | ${statut}`, 50, doc.y);
                    doc.moveDown(0.5);
                });
            });
            try {
                console.log('[Server] Capture graphique à bulles');
                const bubbleImage = await captureChart('http://localhost:3000/fault_level_assessment.html', '#bubble-chart');
                doc.addPage();
                doc.fontSize(16).text('Graphique Ik vs Icn', 50, 50);
                doc.image(bubbleImage, 50, 100, { width: 500 });
            } catch (error) {
                console.warn('[Server] Erreur capture graphique à bulles:', error.message);
            }
        }
        if (reportType === 'all' || reportType === 'safety') {
            console.log('[Server] Génération section Sécurité Électrique');
            doc.fontSize(16).text('Rapport de Sécurité Électrique', 50, doc.y);
            doc.moveDown();
            doc.fontSize(12);
            doc.text('Type | Description | Bâtiment | Tableau | Statut', 50, doc.y);
            doc.moveDown(0.5);
            safetyReportData.forEach(action => {
                doc.text(`${action.type} | ${action.description} | ${action.building} | ${action.tableau || 'N/A'} | ${action.status}`, 50, doc.y);
                doc.moveDown(0.5);
            });
            try {
                console.log('[Server] Capture graphique des statuts');
                const statusImage = await captureChart('http://localhost:3000/electrical_safety_program.html', '#status-chart');
                doc.addPage();
                doc.fontSize(16).text('Répartition des Statuts', 50, 50);
                doc.image(statusImage, 50, 100, { width: 500 });
            } catch (error) {
                console.warn('[Server] Erreur capture graphique des statuts:', error.message);
            }
        }
        console.log('[Server] Finalisation du PDF');
        doc.end();
    } catch (error) {
        console.error('[Server] Erreur POST /api/reports:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la génération du rapport: ' + error.message });
    } finally {
        if (client) client.release();
        if (browser) {
            await browser.close();
            browser = null;
            console.log('[Server] Navigateur Puppeteer fermé');
        }
    }
});

// Endpoint pour récupérer l’organigramme de maintenance
app.get('/api/maintenance-org', async (req, res) => {
    console.log('[Server] GET /api/maintenance-org');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query(`
            WITH RECURSIVE org_tree AS (
                SELECT id, label, role, contact, parent_id
                FROM maintenance_org
                WHERE parent_id IS NULL
                UNION ALL
                SELECT m.id, m.label, m.role, m.contact, m.parent_id
                FROM maintenance_org m
                INNER JOIN org_tree t ON m.parent_id = t.id
            )
            SELECT * FROM org_tree
        `);
        const nodes = result.rows.map(row => ({
            id: row.id,
            label: row.label,
            role: row.role,
            contact: row.contact,
            parent: row.parent_id || null
        }));
        const edges = nodes.filter(node => node.parent).map(node => ({ from: node.parent, to: node.id }));
        console.log('[Server] Organigramme chargé:', { nodes: nodes.length, edges: edges.length });
        res.json({ data: { nodes, edges } });
    } catch (error) {
        console.error('[Server] Erreur GET /api/maintenance-org:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération de l’organigramme: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour signaler une panne
app.post('/api/emergency-report', async (req, res) => {
    const { tableauId, disjoncteurId, description } = req.body;
    console.log('[Server] POST /api/emergency-report - Requête reçue:', { tableauId, disjoncteurId, description });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!tableauId || !disjoncteurId || !description) {
            throw new Error('Tableau ID, disjoncteur ID et description sont requis');
        }
        const tableauResult = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableauId]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const disjoncteursResult = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        const disjoncteurs = Array.isArray(disjoncteursResult.rows[0].disjoncteurs) ? disjoncteursResult.rows[0].disjoncteurs : [];
        if (!disjoncteurs.some(d => d.id === disjoncteurId)) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            return res.status(404).json({ error: 'Disjoncteur non trouvé' });
        }
        const result = await client.query(
            'INSERT INTO emergency_reports (tableau_id, disjoncteur_id, description, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [tableauId, disjoncteurId, description, 'En attente']
        );
        console.log('[Server] Panne signalée:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur POST /api/emergency-report:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors du signalement de la panne: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour mettre à jour un disjoncteur
app.put('/api/disjoncteur/:tableauId/:disjoncteurId', async (req, res) => {
    const { tableauId, disjoncteurId } = req.params;
    const updatedData = req.body;
    const newId = updatedData.newId || updatedData.id;
    console.log('[Server] PUT /api/disjoncteur/:tableauId/:disjoncteurId - Requête reçue:', { tableauId, disjoncteurId, newId });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!tableauId || !disjoncteurId) {
            throw new Error('Tableau ID et Disjoncteur ID sont requis');
        }
        const validationErrors = validateDisjoncteurData({ ...updatedData, id: newId });
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        if (updatedData.linkedTableauIds && updatedData.linkedTableauIds.length > 0) {
            const invalidIds = updatedData.linkedTableauIds.filter(lid => lid === tableauId || !/^[\p{L}0-9\s\-_:]+$/u.test(lid));
            if (invalidIds.length > 0) {
                throw new Error(`IDs de tableaux liés invalides pour disjoncteur ${newId}: ${invalidIds.join(', ')}`);
            }
            const linkedTableaux = await client.query('SELECT id FROM tableaux WHERE id = ANY($1)', [updatedData.linkedTableauIds]);
            if (linkedTableaux.rows.length !== updatedData.linkedTableauIds.length) {
                const missingIds = updatedData.linkedTableauIds.filter(lid => !linkedTableaux.rows.some(row => row.id === lid));
                throw new Error(`Tableaux liés non trouvés pour disjoncteur ${newId}: ${missingIds.join(', ')}`);
            }
        }
        const result = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const disjoncteurs = Array.isArray(result.rows[0].disjoncteurs) ? result.rows[0].disjoncteurs : [];
        const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === decodeURIComponent(disjoncteurId));
        if (disjoncteurIndex === -1) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            return res.status(404).json({ error: 'Disjoncteur non trouvé' });
        }
        if (newId && newId !== decodeURIComponent(disjoncteurId)) {
            const idExists = disjoncteurs.some((d, i) => i !== disjoncteurIndex && d.id === newId);
            const equipementIdExists = (await client.query('SELECT equipment_id FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, newId])).rows.length > 0;
            if (idExists || equipementIdExists) {
                console.log('[Server] Erreur: Nouvel ID déjà utilisé:', newId);
                return res.status(400).json({ error: `L'ID "${newId}" est déjà utilisé dans ce tableau.` });
            }
            try {
                await client.query(
                    'UPDATE breaker_checklists SET disjoncteur_id = $1 WHERE tableau_id = $2 AND disjoncteur_id = $3',
                    [newId, tableauId, decodeURIComponent(disjoncteurId)]
                );
            } catch (checklistError) {
                console.warn('[Server] Erreur mise à jour checklist ID:', {
                    message: checklistError.message,
                    code: checklistError.code
                });
            }
        }
        const updatedDisjoncteur = {
            ...disjoncteurs[disjoncteurIndex],
            ...updatedData,
            id: newId || decodeURIComponent(disjoncteurId),
            icn: normalizeIcn(updatedData.icn || disjoncteurs[disjoncteurIndex].icn),
            section: updatedData.section || disjoncteurs[disjoncteurIndex].section || `${getRecommendedSection(updatedData.in || disjoncteurs[disjoncteurIndex].in)} mm²`,
            cableLength: isNaN(parseFloat(updatedData.cableLength)) ? 
                (disjoncteurs[disjoncteurIndex].isPrincipal ? 0 : 20) : parseFloat(updatedData.cableLength),
            humidite: updatedData.humidite || disjoncteurs[disjoncteurIndex].humidite || 50,
            temp_ambiante: updatedData.temp_ambiante || disjoncteurs[disjoncteurIndex].temp_ambiante || 25,
            charge: updatedData.charge || disjoncteurs[disjoncteurIndex].charge || 80,
            linkedTableauIds: Array.isArray(updatedData.linkedTableauIds) ? updatedData.linkedTableauIds : [],
            isPrincipal: !!updatedData.isPrincipal,
            isHTAFeeder: !!updatedData.isHTAFeeder,
            equipmentType: 'disjoncteur'
        };
        disjoncteurs[disjoncteurIndex] = updatedDisjoncteur;
        await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
        console.log('[Server] Disjoncteur mis à jour:', { tableauId, oldId: disjoncteurId, newId: updatedDisjoncteur.id });
        res.json({ success: true, data: updatedDisjoncteur });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/disjoncteur/:tableauId/:disjoncteurId:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour du disjoncteur: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour mettre à jour un équipement non-disjoncteur
app.put('/api/equipement/:tableauId/:equipmentId', async (req, res) => {
    const { tableauId, equipmentId } = req.params;
    const updatedData = req.body;
    const newId = updatedData.newId || updatedData.id;
    console.log('[Server] PUT /api/equipement/:tableauId/:equipmentId - Requête reçue:', { tableauId, equipmentId, newId });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!tableauId || !equipmentId) {
            throw new Error('Tableau ID et Équipement ID sont requis');
        }
        const validationErrors = validateEquipementData({ ...updatedData, id: newId });
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        const result = await client.query('SELECT equipment_id, equipment_type, data FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, equipmentId]);
        if (result.rows.length === 0) {
            console.log('[Server] Équipement non trouvé:', equipmentId);
            return res.status(404).json({ error: 'Équipement non trouvé' });
        }
        if (newId && newId !== decodeURIComponent(equipmentId)) {
            const disjoncteurIdExists = (await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId])).rows[0].disjoncteurs.some(d => d.id === newId);
            const equipementIdExists = (await client.query('SELECT equipment_id FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, newId])).rows.length > 0;
            if (disjoncteurIdExists || equipementIdExists) {
                console.log('[Server] Erreur: Nouvel ID déjà utilisé:', newId);
                return res.status(400).json({ error: `L'ID "${newId}" est déjà utilisé dans ce tableau.` });
            }
        }
        const updatedEquipement = {
            id: newId || decodeURIComponent(equipmentId),
            equipmentType: updatedData.equipmentType,
            ...updatedData
        };
        delete updatedEquipement.newId;
        const data = { ...updatedEquipement };
        delete data.id;
        delete data.equipmentType;
        await client.query(
            'UPDATE equipements SET equipment_id = $1, equipment_type = $2, data = $3::jsonb WHERE tableau_id = $4 AND equipment_id = $5',
            [newId || decodeURIComponent(equipmentId), updatedData.equipmentType, JSON.stringify(data), tableauId, decodeURIComponent(equipmentId)]
        );
        console.log('[Server] Équipement mis à jour:', { tableauId, oldId: equipmentId, newId: newId || equipmentId });
        res.json({ success: true, data: updatedEquipement });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/equipement/:tableauId/:equipmentId:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'équipement: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour supprimer un équipement non-disjoncteur
app.delete('/api/equipement/:tableauId/:equipmentId', async (req, res) => {
    const { tableauId, equipmentId } = req.params;
    console.log('[Server] DELETE /api/equipement/:tableauId/:equipmentId', { tableauId, equipmentId });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query(
            'DELETE FROM equipements WHERE tableau_id = $1 AND equipment_id = $2 RETURNING *',
            [tableauId, decodeURIComponent(equipmentId)]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Équipement non trouvé:', equipmentId);
            return res.status(404).json({ error: 'Équipement non trouvé' });
        }
        console.log('[Server] Équipement supprimé:', equipmentId);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/equipement/:tableauId/:equipmentId:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression de l\'équipement: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour récupérer les données pour l'évaluation du niveau de défaut
app.get('/api/fault-level', async (req, res) => {
    console.log('[Server] GET /api/fault-level');
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('SELECT id, disjoncteurs, issitemain FROM tableaux');
        const tableaux = result.rows.map(row => {
            const disjoncteurs = (Array.isArray(row.disjoncteurs) ? row.disjoncteurs : []).map(d => {
                let ik = null;
                if (d.ue && (d.impedance || d.section)) {
                    const ueMatch = d.ue.match(/[\d.]+/);
                    const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
                    let z;
                    let L = isNaN(parseFloat(d.cableLength)) ? ((d.isPrincipal || d.isHTAFeeder) ? 0 : 20) : parseFloat(d.cableLength);
                    if ((d.isPrincipal || d.isHTAFeeder) && L < 0) L = 0;
                    else if (!d.isPrincipal && !d.isHTAFeeder && L < 20) L = 20;
                    if (d.impedance) {
                        z = parseFloat(d.impedance);
                        if (z < 0.05) z = 0.05;
                    } else {
                        const rho = 0.0175;
                        const sectionMatch = d.section ? d.section.match(/[\d.]+/) : null;
                        const S = sectionMatch ? parseFloat(sectionMatch[0]) : getRecommendedSection(d.in);
                        const Z_cable = (rho * L * 2) / S;
                        const Z_network = 0.01;
                        z = Z_cable + Z_network;
                        if (z < 0.05) z = 0.05;
                    }
                    ik = (ue / (Math.sqrt(3) * z)) / 1000;
                    if (ik > 100) ik = null;
                }
                return {
                    ...d,
                    ik,
                    icn: normalizeIcn(d.icn),
                    tableauId: row.id,
                    linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : []
                };
            });
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                isSiteMain: !!row.issitemain
            };
        });
        console.log('[Server] Données fault-level:', tableaux.length);
        res.json({ data: tableaux });
    } catch (error) {
        console.error('[Server] Erreur GET /api/fault-level:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des données: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour mettre à jour les données pour l'évaluation du niveau de défaut
app.post('/api/fault-level/update', async (req, res) => {
    const { tableauId, disjoncteurId, ue, section, cableLength, impedance } = req.body;
    console.log('[Server] POST /api/fault-level/update - Requête reçue:', { tableauId, disjoncteurId, ue, section, cableLength, impedance });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!tableauId || !disjoncteurId) {
            throw new Error('Tableau ID et Disjoncteur ID sont requis');
        }
        const result = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const disjoncteurs = Array.isArray(result.rows[0].disjoncteurs) ? result.rows[0].disjoncteurs : [];
        const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === disjoncteurId);
        if (disjoncteurIndex === -1) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            return res.status(404).json({ error: 'Disjoncteur non trouvé' });
        }
        const updatedData = {
            ue: ue || disjoncteurs[disjoncteurIndex].ue,
            section: section || disjoncteurs[disjoncteurIndex].section,
            cableLength: cableLength || disjoncteurs[disjoncteurIndex].cableLength,
            impedance: impedance || disjoncteurs[disjoncteurIndex].impedance
        };
        const validationErrors = validateDisjoncteurData(updatedData);
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        disjoncteurs[disjoncteurIndex] = {
            ...disjoncteurs[disjoncteurIndex],
            ...updatedData
        };
        await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
        console.log('[Server] Données fault-level mises à jour:', { tableauId, disjoncteurId });
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/fault-level/update:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour des données: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoints pour gérer les actions de sécurité
app.get('/api/safety-actions', async (req, res) => {
    const { building, tableau } = req.query;
    console.log('[Server] GET /api/safety-actions', { building, tableau });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        let query = 'SELECT * FROM safety_actions';
        const params = [];
        const conditions = [];
        if (building) {
            conditions.push(`building = $${params.length + 1}`);
            params.push(building);
        }
        if (tableau) {
            conditions.push(`tableau_id = $${params.length + 1}`);
            params.push(tableau);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        const result = await client.query(query, params);
        const actions = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            description: row.description,
            building: row.building,
            tableau: row.tableau_id,
            status: row.status,
            date: row.date ? row.date.toISOString().split('T')[0] : null,
            timestamp: row.timestamp
        }));
        console.log('[Server] Actions de sécurité récupérées:', actions.length);
        res.json({ data: actions });
    } catch (error) {
        console.error('[Server] Erreur GET /api/safety-actions:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des actions: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/safety-actions', async (req, res) => {
    const { type, description, building, tableau, status, date } = req.body;
    console.log('[Server] POST /api/safety-actions - Requête reçue:', { type, description, building, tableau, status, date });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!type || !description || !building || !status) {
            throw new Error('Type, description, bâtiment et statut sont requis');
        }
        if (tableau) {
            const tableauResult = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
            if (tableauResult.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableau);
                return res.status(404).json({ error: 'Tableau non trouvé' });
            }
        }
        const result = await client.query(
            'INSERT INTO safety_actions (type, description, building, tableau_id, status, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [type, description, building, tableau || null, status, date || null]
        );
        console.log('[Server] Action de sécurité ajoutée:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur POST /api/safety-actions:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'action: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.put('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    const { type, description, building, tableau, status, date } = req.body;
    console.log('[Server] PUT /api/safety-actions/:id - Requête reçue:', { id, type, description, building, tableau, status, date });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!type || !description || !building || !status) {
            throw new Error('Type, description, bâtiment et statut sont requis');
        }
        if (tableau) {
            const tableauResult = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
            if (tableauResult.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableau);
                return res.status(404).json({ error: 'Tableau non trouvé' });
            }
        }
        const result = await client.query(
            'UPDATE safety_actions SET type = $1, description = $2, building = $3, tableau_id = $4, status = $5, date = $6 WHERE id = $7 RETURNING *',
            [type, description, building, tableau || null, status, date || null, id]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            return res.status(404).json({ error: 'Action non trouvée' });
        }
        console.log('[Server] Action de sécurité mise à jour:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'action: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.delete('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/safety-actions/:id', id);
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('DELETE FROM safety_actions WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            return res.status(404).json({ error: 'Action non trouvée' });
        }
        console.log('[Server] Action de sécurité supprimée:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression de l\'action: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour récupérer une action de sécurité spécifique
app.get('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] GET /api/safety-actions/:id', id);
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('SELECT * FROM safety_actions WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            return res.status(404).json({ error: 'Action non trouvée' });
        }
        const action = {
            id: result.rows[0].id,
            type: result.rows[0].type,
            description: result.rows[0].description,
            building: result.rows[0].building,
            tableau: result.rows[0].tableau_id,
            status: result.rows[0].status,
            date: result.rows[0].date ? result.rows[0].date.toISOString().split('T')[0] : null,
            timestamp: result.rows[0].timestamp
        };
        console.log('[Server] Action récupérée:', action);
        res.json({ data: action });
    } catch (error) {
        console.error('[Server] Erreur GET /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération de l’action: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour gérer les checklists des disjoncteurs
app.get('/api/breaker-checklists', async (req, res) => {
    const { tableauId, disjoncteurId } = req.query;
    console.log('[Server] GET /api/breaker-checklists', { tableauId, disjoncteurId });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        let query = 'SELECT * FROM breaker_checklists';
        const params = [];
        const conditions = [];
        if (tableauId) {
            conditions.push(`tableau_id = $${params.length + 1}`);
            params.push(tableauId);
        }
        if (disjoncteurId) {
            conditions.push(`disjoncteur_id = $${params.length + 1}`);
            params.push(disjoncteurId);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY timestamp DESC';
        const result = await client.query(query, params);
        const checklists = result.rows.map(row => ({
            id: row.id,
            tableau_id: row.tableau_id,
            disjoncteur_id: row.disjoncteur_id,
            status: row.status,
            comment: row.comment,
            photo: row.photo,
            timestamp: row.timestamp
        }));
        console.log('[Server] Checklists récupérées:', checklists.length);
        res.json(checklists);
    } catch (error) {
        console.error('[Server] Erreur GET /api/breaker-checklists:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des checklists: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/breaker-checklists', async (req, res) => {
    const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
    console.log('[Server] POST /api/breaker-checklists - Requête reçue:', { tableau_id, disjoncteur_id, status, comment, photo: photo ? 'présent' : 'absent' });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const validationErrors = validateChecklistData(req.body);
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        const tableauResult = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableau_id);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const disjoncteurs = Array.isArray(tableauResult.rows[0].disjoncteurs) ? tableauResult.rows[0].disjoncteurs : [];
        if (!disjoncteurs.some(d => d.id === disjoncteur_id)) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteur_id);
            return res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
        }
        const result = await client.query(
            'INSERT INTO breaker_checklists (tableau_id, disjoncteur_id, status, comment, photo) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [tableau_id, disjoncteur_id, status, comment, photo || null]
        );
        console.log('[Server] Checklist ajoutée:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur POST /api/breaker-checklists:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la checklist: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.put('/api/breaker-checklists/:id', async (req, res) => {
    const { id } = req.params;
    const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
    console.log('[Server] PUT /api/breaker-checklists/:id - Requête reçue:', { id, tableau_id, disjoncteur_id, status, comment, photo: photo ? 'présent' : 'absent' });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const validationErrors = validateChecklistData(req.body);
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
        }
        const tableauResult = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableau_id);
            return res.status(404).json({ error: 'Tableau non trouvé' });
        }
        const disjoncteurs = Array.isArray(tableauResult.rows[0].disjoncteurs) ? tableauResult.rows[0].disjoncteurs : [];
        if (!disjoncteurs.some(d => d.id === disjoncteur_id)) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteur_id);
            return res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
        }
        const result = await client.query(
            'UPDATE breaker_checklists SET tableau_id = $1, disjoncteur_id = $2, status = $3, comment = $4, photo = $5 WHERE id = $6 RETURNING *',
            [tableau_id, disjoncteur_id, status, comment, photo || null, id]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Checklist non trouvée:', id);
            return res.status(404).json({ error: 'Checklist non trouvée' });
        }
        console.log('[Server] Checklist mise à jour:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/breaker-checklists/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour de la checklist: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.delete('/api/breaker-checklists/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/breaker-checklists/:id', id);
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        const result = await client.query('DELETE FROM breaker_checklists WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Checklist non trouvée:', id);
            return res.status(404).json({ error: 'Checklist non trouvée' });
        }
        console.log('[Server] Checklist supprimée:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/breaker-checklists/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression de la checklist: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// Endpoint pour récupérer les rapports d’urgence
app.get('/api/emergency-reports', async (req, res) => {
    const { tableauId, status } = req.query;
    console.log('[Server] GET /api/emergency-reports', { tableauId, status });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        let query = 'SELECT * FROM emergency_reports';
        const params = [];
        const conditions = [];
        if (tableauId) {
            conditions.push(`tableau_id = $${params.length + 1}`);
            params.push(tableauId);
        }
        if (status) {
            conditions.push(`status = $${params.length + 1}`);
            params.push(status);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY timestamp DESC';
        const result = await client.query(query, params);
        const reports = result.rows.map(row => ({
            id: row.id,
            tableau_id: row.tableau_id,
            disjoncteur_id: row.disjoncteur_id,
            description: row.description,
            status: row.status,
            timestamp: row.timestamp
        }));
        console.log('[Server] Rapports d’urgence récupérés:', reports.length);
        res.json({ data: reports });
    } catch (error) {
        console.error('[Server] Erreur GET /api/emergency-reports:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des rapports: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

app.put('/api/emergency-reports/:id', async (req, res) => {
    const { id } = req.params;
    const { status, description } = req.body;
    console.log('[Server] PUT /api/emergency-reports/:id - Requête reçue:', { id, status, description });
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        if (!status) {
            throw new Error('Statut est requis');
        }
        const result = await client.query(
            'UPDATE emergency_reports SET status = $1, description = $2 WHERE id = $3 RETURNING *',
            [status, description || null, id]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Rapport non trouvé:', id);
            return res.status(404).json({ error: 'Rapport non trouvé' });
        }
        console.log('[Server] Rapport d’urgence mis à jour:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/emergency-reports/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour du rapport: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// GET tous les projets
app.get('/api/projects', async (req, res) => {
    console.log('[Server] GET /api/projects');
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('[Server] Erreur GET /api/projects:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur récupération projets: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// POST créer un projet
app.post('/api/projects', async (req, res) => {
    const data = req.body;
    console.log('[Server] POST /api/projects', data.name);
    let client;
    try {
        client = await pool.connect();
        const errors = validateProjectData(data);
        if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });
        const result = await client.query(
            'INSERT INTO projects (name, description, business_case, pip, wbs_number, gantt_data, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [data.name, data.description || '', data.business_case || '', data.pip || '', data.wbs_number || '', JSON.stringify(data.gantt_data || {}), data.status || 'En cours']
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[Server] Erreur POST /api/projects:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur création projet: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// PUT mise à jour projet (inclut checks étapes, budget auto)
app.put('/api/projects/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    console.log('[Server] PUT /api/projects/:id', id);
    let client;
    try {
        client = await pool.connect();
        const errors = validateProjectData(data);
        if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

        // Calcul budget spent si quotes fourni
        let budget_spent;
        if (Array.isArray(data.quotes)) {
            budget_spent = data.quotes.reduce((sum, q) => sum + (q.status === 'Approuvé' ? parseFloat(q.montant) || 0 : 0), 0);
        }

        // Construire requête UPDATE dynamique
        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        if ('name' in data) {
            setClauses.push(`name = $${paramIndex++}`);
            values.push(data.name);
        }
        if ('description' in data) {
            setClauses.push(`description = $${paramIndex++}`);
            values.push(data.description);
        }
        if ('business_case' in data) {
            setClauses.push(`business_case = $${paramIndex++}`);
            values.push(data.business_case);
        }
        if ('business_case_approved' in data) {
            setClauses.push(`business_case_approved = $${paramIndex++}`);
            values.push(!!data.business_case_approved);
        }
        if ('pip' in data) {
            setClauses.push(`pip = $${paramIndex++}`);
            values.push(data.pip);
        }
        if ('pip_approved' in data) {
            setClauses.push(`pip_approved = $${paramIndex++}`);
            values.push(!!data.pip_approved);
        }
        if ('wbs_created' in data) {
            setClauses.push(`wbs_created = $${paramIndex++}`);
            values.push(!!data.wbs_created);
        }
        if ('wbs_number' in data) {
            setClauses.push(`wbs_number = $${paramIndex++}`);
            values.push(data.wbs_number);
        }
        if ('po_requests' in data) {
            setClauses.push(`po_requests = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(data.po_requests || []));
        }
        if ('quotes' in data) {
            setClauses.push(`quotes = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(data.quotes || []));
        }
        if ('attachments' in data) {
            setClauses.push(`attachments = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(data.attachments || []));
        }
        if ('gantt_data' in data) {
            setClauses.push(`gantt_data = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(data.gantt_data || {}));
        }
        if ('budget_total' in data) {
            setClauses.push(`budget_total = $${paramIndex++}`);
            values.push(parseFloat(data.budget_total) || 0);
        }
        if (budget_spent !== undefined) {
            setClauses.push(`budget_spent = $${paramIndex++}`);
            values.push(budget_spent);
        }
        if ('status' in data) {
            setClauses.push(`status = $${paramIndex++}`);
            values.push(data.status);
        }
        if ('po_launched' in data) {
            setClauses.push(`po_launched = $${paramIndex++}`);
            values.push(!!data.po_launched);
        }
        if ('project_phase_completed' in data) {
            setClauses.push(`project_phase_completed = $${paramIndex++}`);
            values.push(!!data.project_phase_completed);
        }
        if ('reception_completed' in data) {
            setClauses.push(`reception_completed = $${paramIndex++}`);
            values.push(!!data.reception_completed);
        }
        if ('closure_completed' in data) {
            setClauses.push(`closure_completed = $${paramIndex++}`);
            values.push(!!data.closure_completed);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
        }

        const query = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        values.push(id);

        const result = await client.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Projet non trouvé' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[Server] Erreur PUT /api/projects/:id:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur mise à jour projet: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// DELETE projet
app.delete('/api/projects/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/projects/:id', id);
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Projet non trouvé' });
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/projects/:id:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur suppression projet: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// POST upload attachment (fichier en base64)
app.post('/api/projects/:id/attachment', upload.single('file'), async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    console.log('[Server] POST /api/projects/:id/attachment', id);
    let client;
    try {
        client = await pool.connect();
        if (!file) return res.status(400).json({ error: 'Fichier requis' });

        const base64 = file.buffer.toString('base64');
        const attachment = { filename: file.originalname, data: `data:${file.mimetype};base64,${base64}`, type: file.mimetype };

        const projectResult = await client.query('SELECT attachments FROM projects WHERE id = $1', [id]);
        if (projectResult.rows.length === 0) return res.status(404).json({ error: 'Projet non trouvé' });

        const attachments = [...(projectResult.rows[0].attachments || []), attachment];
        await client.query('UPDATE projects SET attachments = $1::jsonb WHERE id = $2', [JSON.stringify(attachments), id]);

        res.json({ success: true, attachment });
    } catch (error) {
        console.error('[Server] Erreur upload attachment:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur upload: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// GET stats graphiques (pour front dynamique)
app.get('/api/project-stats', async (req, res) => {
    console.log('[Server] GET /api/project-stats');
    let client;
    try {
        client = await pool.connect();
        const projectsResult = await client.query('SELECT * FROM projects');
        const stats = {
            totalProjects: projectsResult.rows.length,
            approvedBusinessCases: projectsResult.rows.filter(p => p.business_case_approved).length,
            totalBudget: projectsResult.rows.reduce((sum, p) => sum + (parseFloat(p.budget_total) || 0), 0),
            spentBudget: projectsResult.rows.reduce((sum, p) => sum + (parseFloat(p.budget_spent) || 0), 0),
            statusDistribution: projectsResult.rows.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {}),
        };
        res.json(stats);
    } catch (error) {
        console.error('[Server] Erreur GET /api/project-stats:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur stats: ' + error.message });
    } finally {
        if (client) client.release();
    }
});

// POST pour analyser un projet avec AI (avis, risques, score)
app.post('/api/project-analyze', async (req, res) => {
    const { projectData } = req.body;
    console.log('[Server] POST /api/project-analyze', projectData.name);
    try {
        const prompt = `Analyse ce projet en date du July 10, 2025: Nom: ${projectData.name}. Description: ${projectData.description}. Business Case: ${projectData.business_case}. PIP: ${projectData.pip}. WBS: ${projectData.wbs_number}. Budget: ${projectData.budget_total} (spent: ${projectData.budget_spent}). Gantt: ${JSON.stringify(projectData.gantt_data)}. Donne un avis détaillé, risques potentiels, score /100, suggestions pour amélioration. Format JSON: {avis: string, risques: array, score: number, suggestions: array}`;
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });
        const analysis = JSON.parse(response.choices[0].message.content);
        res.json(analysis);
    } catch (error) {
        console.error('[Server] Erreur POST /api/project-analyze:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erreur analyse AI: ' + error.message });
    }
});

// Middleware pour gérer les erreurs globales
app.use((err, req, res, next) => {
    console.error('[Server] Erreur non gérée:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
    });
    res.status(500).json({ error: 'Erreur serveur: ' + err.message });
});

// Configuration DeepL
// const deepl = require('deepl-node');
// const translator = new deepl.Translator(process.env.DEEPL_API_KEY);

// Endpoint pour traduire le contenu
app.post('/api/translate', async (req, res) => {
    const { text, targetLang } = req.body;
    console.log('[Server] POST /api/translate - Requête reçue:', { text, targetLang });
    try {
        if (!text || !targetLang) {
            throw new Error('Texte et langue cible sont requis');
        }
        const result = await translator.translateText(text, null, targetLang);
        console.log('[Server] Traduction réussie:', result.text);
        res.json({ translatedText: result.text });
    } catch (error) {
        console.error('[Server] Erreur POST /api/translate:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Erreur lors de la traduction: ' + error.message });
    }
});

//// Routes pour gérer les trades et l'analyse crypto
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

app.get('/trades', async (req, res) => {
    console.log('[Server] GET /trades');
    let client;
    try {
        client = await pool.connect();
        const result = await pool.query('SELECT * FROM trades ORDER BY trade_date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[Server] Erreur GET /trades:', {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des trades: ' + err.message });
    } finally {
        if (client) client.release();
    }
});

app.post('/trades', async (req, res) => {
    const { trade_date, investment, profit_loss, current_capital, notes } = req.body;
    console.log('[Server] POST /trades - Requête reçue:', { trade_date, investment, profit_loss, current_capital, notes });
    let client;
    try {
        client = await pool.connect();
        if (!trade_date || isNaN(investment) || isNaN(profit_loss) || isNaN(current_capital)) {
            throw new Error('Date, investissement, gain/perte et capital actuel sont requis et doivent être valides');
        }
        const result = await pool.query(
            'INSERT INTO trades (trade_date, investment, profit_loss, current_capital, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [trade_date, investment, profit_loss, current_capital, notes || null]
        );
        console.log('[Server] Trade ajouté:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[Server] Erreur POST /trades:', {
            message: err.message,
            stack: err.stack
        });
        res.status(400).json({ error: 'Erreur lors de l\'ajout du trade: ' + err.message });
    } finally {
        if (client) client.release();
    }
});

app.delete('/trades/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /trades/:id', id);
    let client;
    try {
        client = await pool.connect();
        const result = await pool.query('DELETE FROM trades WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Trade non trouvé:', id);
            return res.status(404).json({ error: 'Trade non trouvé' });
        }
        console.log('[Server] Trade supprimé:', id);
        res.json({ message: 'Trade supprimé' });
    } catch (err) {
        console.error('[Server] Erreur DELETE /trades/:id:', {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ error: 'Erreur lors de la suppression du trade: ' + err.message });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/crypto-analysis', async (req, res) => {
    console.log('[Server] GET /api/crypto-analysis');
    try {
        const { stdout, stderr } = await execPromise('python3 crypto_trading_dashboard.py');
        if (stderr) {
            console.error(`[Server] Logs/Erreurs du script Python: ${stderr}`);  // Log mais ne bloque pas
        }
        let result;
        try {
            result = JSON.parse(stdout.trim());  // Trim pour enlever espaces/newlines
        } catch (parseError) {
            console.error(`[Server] Erreur parsing JSON de stdout: ${parseError.message}`);
            return res.status(500).json({ error: 'Erreur parsing sortie Python: ' + parseError.message });
        }
        if (result.type === 'error') {
            console.error('[Server] Erreur dans le script Python:', result.message);
            return res.status(500).json({ error: result.message });
        }
        if (result.type !== 'best_signal') {
            console.error('[Server] Type de réponse inattendu:', result.type);
            return res.status(500).json({ error: 'Type de réponse inattendu du script Python' });
        }
        console.log('[Server] Signal de trading:', result.result);
        res.json(result.result);
    } catch (error) {
        console.error('[Server] Erreur GET /api/crypto-analysis:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Erreur lors de l\'analyse crypto: ' + error.message });
    }
});

app.post('/api/analyze-trade', async (req, res) => {
    const { pair, entry_price, signal_type } = req.body;
    console.log('[Server] POST /api/analyze-trade - Requête reçue:', { pair, entry_price, signal_type });
    try {
        if (!pair || !entry_price || !signal_type) {
            throw new Error('Paire, prix d\'entrée et type de signal (ACHAT/VENTE) sont requis');
        }
        const { stdout, stderr } = await execPromise(`python3 crypto_trading_dashboard.py "${pair}" ${entry_price} ${signal_type}`);
        if (stderr) {
            console.error('[Server] Erreur exécution script Python:', stderr);
            return res.status(500).json({ error: 'Erreur lors de l\'analyse: ' + stderr });
        }
        const result = JSON.parse(stdout);
        if (result.type === 'error') {
            console.error('[Server] Erreur dans le script Python:', result.message);
            return res.status(500).json({ error: result.message });
        }
        if (result.type !== 'trade_analysis') {
            console.error('[Server] Type de réponse inattendu:', result.type);
            return res.status(500).json({ error: 'Type de réponse inattendu du script Python' });
        }
        console.log('[Server] Analyse de trade:', result.result);
        res.json(result.result);
    } catch (error) {
        console.error('[Server] Erreur POST /api/analyze-trade:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Erreur lors de l\'analyse du trade: ' + error.message });
    }
});

// GET tous les équipements ATEX
app.get('/api/atex-equipments', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM atex_equipments');
        res.json(result.rows);
    } catch (error) {
        console.error('[Server] Erreur GET /api/atex-equipments:', error);
        res.status(500).json({ error: 'Erreur récupération équipements ATEX' });
    } finally {
        if (client) client.release();
    }
});

// POST ajouter équipement ATEX
app.post('/api/atex-equipments', async (req, res) => {
    const data = req.body;
    let client;
    try {
        client = await pool.connect();
        // Calcul auto catégorie min
        function calculateMinCategory(zoneExt = '', zoneInt = '') {
            const zone = zoneExt || zoneInt || '22';
            let cat = '';
            if (zone.startsWith('0')) cat = 'II 1G';
            else if (zone.startsWith('1')) cat = 'II 2G';
            else if (zone.startsWith('2')) cat = 'II 3G';
            else if (zone.startsWith('20')) cat = 'II 1D';
            else if (zone.startsWith('21')) cat = 'II 2D';
            else cat = 'II 3D';
            return cat + ' IIIB T135°C'; // Default group/temp, adjust as needed
        }
        data.categorie_minimum = data.categorie_minimum || calculateMinCategory(data.exterieur, data.interieur);

        // Calcul auto conformité
        function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
            if (!marquage || !categorieMin) return 'Non Conforme';
            const marquageParts = marquage.match(/II (\d)[GD] (II[A-C]|III[A-C])? T(\d+)/) || [];
            const minParts = categorieMin.match(/II (\d)[GD] (III[A-C])? T(\d+)/) || [];
            const catMarq = parseInt(marquageParts[1] || 3);
            const catMin = parseInt(minParts[1] || 3);
            const zone = zoneExt || zoneInt || '22';
            const requiredCat = zone.startsWith('0') || zone.startsWith('20') ? 1 : (zone.startsWith('1') || zone.startsWith('21') ? 2 : 3);
            if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';
            const tMarq = parseInt(marquageParts[4] || 6);
            const tMin = parseInt(minParts[4] || 135);
            if (tMarq < tMin) return 'Non Conforme';
            return 'Conforme';
        }
        data.conformite = checkAtexConformity(data.marquage_atex, data.categorie_minimum, data.exterieur, data.interieur);

        // Calcul auto risque (0-5)
        function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
            const zone = zoneExt || zoneInt || '22';
            let zoneScore = zone.startsWith('0') || zone.startsWith('20') ? 5 : (zone.startsWith('1') || zone.startsWith('21') ? 3 : 1);
            const confScore = conformity !== 'Conforme' ? 2 : 0;
            return Math.min(Math.max(zoneScore + confScore, 0), 5);
        }
        data.risque = calculateRisk(data.exterieur, data.interieur, data.conformite);

        const result = await client.query(
            'INSERT INTO atex_equipments (risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments, grade, frequence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *',
            [data.risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur, data.type, data.identifiant, data.interieur, data.exterieur, data.categorie_minimum, data.marquage_atex, data.photo, data.conformite, data.comments, data.grade || 'V', data.frequence || 3]
        );
        // Calcul auto next_inspection
        const nextDate = new Date();
        nextDate.setFullYear(nextDate.getFullYear() + (data.frequence || 3));
        await client.query('UPDATE atex_equipments SET next_inspection_date = $1 WHERE id = $2', [nextDate.toISOString().split('T')[0], result.rows[0].id]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[Server] Erreur POST /api/atex-equipments:', error);
        res.status(500).json({ error: 'Erreur ajout équipement ATEX' });
    } finally {
        if (client) client.release();
    }
});

// PUT updater équipement ATEX
app.put('/api/atex-equipments/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    let client;
    try {
        client = await pool.connect();
        // Recalcul autos (risque, catégorie, conformité)
        function calculateMinCategory(zoneExt = '', zoneInt = '') {
            const zone = zoneExt || zoneInt || '22';
            let cat = '';
            if (zone.startsWith('0')) cat = 'II 1G';
            else if (zone.startsWith('1')) cat = 'II 2G';
            else if (zone.startsWith('2')) cat = 'II 3G';
            else if (zone.startsWith('20')) cat = 'II 1D';
            else if (zone.startsWith('21')) cat = 'II 2D';
            else cat = 'II 3D';
            return cat + ' IIIB T135°C';
        }
        data.categorie_minimum = data.categorie_minimum || calculateMinCategory(data.exterieur, data.interieur);

        function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
            if (!marquage || !categorieMin) return 'Non Conforme';
            const marquageParts = marquage.match(/II (\d)[GD] (II[A-C]|III[A-C])? T(\d+)/) || [];
            const minParts = categorieMin.match(/II (\d)[GD] (III[A-C])? T(\d+)/) || [];
            const catMarq = parseInt(marquageParts[1] || 3);
            const catMin = parseInt(minParts[1] || 3);
            const zone = zoneExt || zoneInt || '22';
            const requiredCat = zone.startsWith('0') || zone.startsWith('20') ? 1 : (zone.startsWith('1') || zone.startsWith('21') ? 2 : 3);
            if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';
            const tMarq = parseInt(marquageParts[4] || 6);
            const tMin = parseInt(minParts[4] || 135);
            if (tMarq < tMin) return 'Non Conforme';
            return 'Conforme';
        }
        data.conformite = checkAtexConformity(data.marquage_atex, data.categorie_minimum, data.exterieur, data.interieur);

        function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
            const zone = zoneExt || zoneInt || '22';
            let zoneScore = zone.startsWith('0') || zone.startsWith('20') ? 5 : (zone.startsWith('1') || zone.startsWith('21') ? 3 : 1);
            const confScore = conformity !== 'Conforme' ? 2 : 0;
            return Math.min(Math.max(zoneScore + confScore, 0), 5);
        }
        data.risque = calculateRisk(data.exterieur, data.interieur, data.conformite);

        const result = await client.query(
            'UPDATE atex_equipments SET risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7, identifiant=$8, interieur=$9, exterieur=$10, categorie_minimum=$11, marquage_atex=$12, photo=$13, conformite=$14, comments=$15, grade=$16, frequence=$17 WHERE id=$18 RETURNING *',
            [data.risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur, data.type, data.identifiant, data.interieur, data.exterieur, data.categorie_minimum, data.marquage_atex, data.photo, data.conformite, data.comments, data.grade || 'V', data.frequence || 3, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Équipement non trouvé' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[Server] Erreur PUT /api/atex-equipments/:id:', error);
        res.status(500).json({ error: 'Erreur update équipement ATEX' });
    } finally {
        if (client) client.release();
    }
});

// DELETE équipement ATEX
app.delete('/api/atex-equipments/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('DELETE FROM atex_equipments WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Équipement non trouvé' });
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/atex-equipments/:id:', error);
        res.status(500).json({ error: 'Erreur suppression équipement ATEX' });
    } finally {
        if (client) client.release();
    }
});

// POST inspection (avec photo, update dates)
app.post('/api/atex-inspect', async (req, res) => {
    const { equipment_id, status, comment, photo, inspection_date } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query(
            'INSERT INTO atex_inspections (equipment_id, status, comment, photo, inspection_date) VALUES ($1, $2, $3, $4, $5)',
            [equipment_id, status, comment, photo, inspection_date]
        );
        // Update last/next
        const nextDate = new Date(inspection_date);
        nextDate.setFullYear(nextDate.getFullYear() + 3); // Ex. 3 ans
        await client.query('UPDATE atex_equipments SET last_inspection_date = $1, next_inspection_date = $2 WHERE id = $3', [inspection_date, nextDate.toISOString().split('T')[0], equipment_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/atex-inspect:', error);
        res.status(500).json({ error: 'Erreur enregistrement inspection' });
    } finally {
        if (client) client.release();
    }
});

// POST import Excel
app.post('/api/atex-import-excel', upload.single('excel'), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(1); // Skip header

        function calculateMinCategory(zoneExt = '', zoneInt = '') {
            const zone = zoneExt || zoneInt || '22';
            let cat = '';
            if (zone.startsWith('0')) cat = 'II 1G';
            else if (zone.startsWith('1')) cat = 'II 2G';
            else if (zone.startsWith('2')) cat = 'II 3G';
            else if (zone.startsWith('20')) cat = 'II 1D';
            else if (zone.startsWith('21')) cat = 'II 2D';
            else cat = 'II 3D';
            return cat + ' IIIB T135°C';
        }

        function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
            if (!marquage || !categorieMin) return 'Non Conforme';
            const marquageParts = marquage.match(/II (\d)[GD] (II[A-C]|III[A-C])? T(\d+)/) || [];
            const minParts = categorieMin.match(/II (\d)[GD] (III[A-C])? T(\d+)/) || [];
            const catMarq = parseInt(marquageParts[1] || 3);
            const catMin = parseInt(minParts[1] || 3);
            const zone = zoneExt || zoneInt || '22';
            const requiredCat = zone.startsWith('0') || zone.startsWith('20') ? 1 : (zone.startsWith('1') || zone.startsWith('21') ? 2 : 3);
            if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';
            const tMarq = parseInt(marquageParts[4] || 6);
            const tMin = parseInt(minParts[4] || 135);
            if (tMarq < tMin) return 'Non Conforme';
            return 'Conforme';
        }

        function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
            const zone = zoneExt || zoneInt || '22';
            let zoneScore = zone.startsWith('0') || zone.startsWith('20') ? 5 : (zone.startsWith('1') || zone.startsWith('21') ? 3 : 1);
            const confScore = conformity !== 'Conforme' ? 2 : 0;
            return Math.min(Math.max(zoneScore + confScore, 0), 5);
        }

        for (const row of rows) {
            if (row.length < 15) continue; // Skip incomplete
            let [risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, , conformite, comments] = row;
            categorie_minimum = categorie_minimum || calculateMinCategory(exterieur, interieur);
            conformite = checkAtexConformity(marquage_atex, categorie_minimum, exterieur, interieur);
            risque = calculateRisk(exterieur, interieur, conformite);
            await client.query(
                'INSERT INTO atex_equipments (risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, conformite, comments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (identifiant) DO UPDATE SET risque=EXCLUDED.risque, secteur=EXCLUDED.secteur, batiment=EXCLUDED.batiment, local=EXCLUDED.local, composant=EXCLUDED.composant, fournisseur=EXCLUDED.fournisseur, type=EXCLUDED.type, interieur=EXCLUDED.interieur, exterieur=EXCLUDED.exterieur, categorie_minimum=EXCLUDED.categorie_minimum, marquage_atex=EXCLUDED.marquage_atex, conformite=EXCLUDED.conformite, comments=EXCLUDED.comments',
                [risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, conformite, comments]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/atex-import-excel:', error);
        res.status(500).json({ error: 'Erreur import Excel' });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/atex-secteurs', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT name FROM atex_secteurs');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erreur secteurs' });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/atex-analysis', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM atex_equipments');
        const alerts = [];
        const nonConforme = result.rows.filter(r => r.conformite !== 'Conforme').length;
        if (nonConforme > 0) alerts.push({ text: `⚠️ ${nonConforme} équipements non conformes.` });
        const overdue = result.rows.filter(r => new Date(r.next_inspection_date) < new Date()).length;
        if (overdue > 0) alerts.push({ text: `⚠️ ${overdue} inspections en retard.` });
        // Add more analysis...
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: 'Erreur analysis' });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/atex-chat', async (req, res) => {
    const { question } = req.body;
    try {
        const prompt = `Réponds à cette question sur ATEX/équipements : ${question}. Sois clair, pour novice.`;
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }]
        });
        res.json({ response: response.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: 'Erreur chat' });
    }
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] Serveur démarré sur le port ${PORT}`);
});

// Gestion de la fermeture propre
process.on('SIGTERM', async () => {
    console.log('[Server] Réception de SIGTERM, fermeture propre');
    if (browser) {
        await browser.close();
        console.log('[Server] Navigateur Puppeteer fermé');
    }
    await pool.end();
    console.log('[Server] Connexion à la base de données fermée');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[Server] Réception de SIGINT, fermeture propre');
    if (browser) {
        await browser.close();
        console.log('[Server] Navigateur Puppeteer fermé');
    }
    await pool.end();
    console.log('[Server] Connexion à la base de données fermée');
    process.exit(0);
});
