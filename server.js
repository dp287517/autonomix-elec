const express = require('express');
const { Pool } = require('pg');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// Middleware pour loguer chaque requête et réponse
app.use((req, res, next) => {
    const start = Date.now();
    const requestId = Math.random().toString(36).substring(2, 9);
    console.log(`[${new Date().toISOString()}] [Request ${requestId}] ${req.method} ${req.url}`);
    console.log(`[Request ${requestId}] Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[Request ${requestId}] Body:`, JSON.stringify(req.body, null, 2));

    const oldSend = res.send;
    res.send = function(data) {
        console.log(`[${new Date().toISOString()}] [Response ${requestId}] ${req.method} ${req.url} - Status: ${res.statusCode}, Duration: ${Date.now() - start}ms`);
        console.log(`[Response ${requestId}] Data:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        oldSend.apply(res, arguments);
    };

    next();
});

const pool = new Pool({
    connectionString: 'postgresql://autonomix_owner:npg_rDMoOyZ8a3Xk@ep-mute-brook-a23892dj-pooler.eu-central-1.aws.neon.tech/autonomix?sslmode=require',
    ssl: { rejectUnauthorized: false },
    max: 10, // Limite maximale de connexions
    idleTimeoutMillis: 30000, // Déconnexion après 30s d'inactivité
    connectionTimeoutMillis: 5000 // Timeout de connexion
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gestion fichier replacementDates.json
const REPLACEMENT_FILE = 'replacementDates.json';
let replacementDates = {};
if (fs.existsSync(REPLACEMENT_FILE)) {
    const raw = fs.readFileSync(REPLACEMENT_FILE);
    replacementDates = JSON.parse(raw);
}

// Tableau des sections de câbles et gaines à barres selon le courant assigné (cuivre, monophasé)
const cableSections = [
    { in: 2, section: 1.5 },
    { in: 10, section: 1.5 },
    { in: 16, section: 2.5 },
    { in: 20, section: 2.5 },
    { in: 25, section: 4 },
    { in: 32, section: 6 },
    { in: 40, section: 10 },
    { in: 50, section: 16 },
    { in: 63, section: 25 },
    { in: 80, section: 35 },
    { in: 100, section: 50 },
    { in: 125, section: 70 },
    { in: 160, section: 95 },
    { in: 200, section: 120 },
    { in: 250, section: 150 },
    { in: 315, section: 185 },
    { in: 400, section: 240 },
    { in: 500, section: 300 },
    { in: 630, section: 400 },
    { in: 800, section: 500 },
    { in: 1000, section: 630 },
    { in: 1250, section: 800 },
    { in: 1600, section: 1000 },
    { in: 2000, section: 1200 },
    { in: 2500, section: 1600 }
];

// Fonction pour obtenir la section recommandée selon In
function getRecommendedSection(inValue) {
    const inNum = parseFloat(inValue?.match(/[\d.]+/)?.[0]) || 0;
    for (let i = 0; i < cableSections.length; i++) {
        if (inNum <= cableSections[i].in) {
            return cableSections[i].section;
        }
    }
    return 1600;
}

// Validation des données
function validateDisjoncteurData(data) {
    const errors = [];
    if (data.ip && !['IP20', 'IP40', 'IP54', 'IP65'].includes(data.ip)) {
        errors.push('Indice de protection invalide. Valeurs acceptées : IP20, IP40, IP54, IP65.');
    }
    if (data.temp && (isNaN(parseFloat(data.temp)) || data.temp < 0)) {
        errors.push('La température doit être une valeur numérique positive (ex. 70).');
    }
    if (data.ue && (isNaN(parseFloat(data.ue)) || data.ue < 0)) {
        errors.push('La tension nominale doit être une valeur numérique positive (ex. 400).');
    }
    if (data.section && (isNaN(parseFloat(data.section)) || data.section < 0)) {
        errors.push('La section du câble doit être une valeur numérique positive (ex. 2.5).');
    }
    if (data.humidite && (isNaN(parseFloat(data.humidite)) || data.humidite < 0 || data.humidite > 100)) {
        errors.push('L’humidité doit être une valeur numérique entre 0 et 100 (ex. 60).');
    }
    if (data.temp_ambiante && (isNaN(parseFloat(data.temp_ambiante)) || data.temp_ambiante < -20 || data.temp_ambiante > 60)) {
        errors.push('La température ambiante doit être une valeur numérique entre -20 et 60 (ex. 25).');
    }
    if (data.charge && (isNaN(parseFloat(data.charge)) || data.charge < 0 || data.charge > 100)) {
        errors.push('La charge doit être une valeur numérique entre 0 et 100 (ex. 80).');
    }
    if (data.id && !/^[\p{L}0-9\s\-_:]+$/u.test(data.id)) {
        errors.push('L\'ID du disjoncteur contient des caractères non autorisés. Utilisez lettres (y compris accentuées), chiffres, espaces, tirets, underscores ou deux-points.');
    }
    if (data.newId && !/^[\p{L}0-9\s\-_:]+$/u.test(data.newId)) {
        errors.push('Le nouvel ID du disjoncteur contient des caractères non autorisés. Utilisez lettres (y compris accentuées), chiffres, espaces, tirets, underscores ou deux-points.');
    }
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

// Initialisation de la base de données
async function initDb() {
    console.log('[Server] Initialisation de la base de données');
    try {
        // Vérifier la connexion à la base de données
        await pool.query('SELECT 1');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tableaux (
                id VARCHAR(50) PRIMARY KEY,
                disjoncteurs JSONB,
                isSiteMain BOOLEAN DEFAULT FALSE
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS emergency_reports (
                id SERIAL PRIMARY KEY,
                tableau_id VARCHAR(50) REFERENCES tableaux(id),
                disjoncteur_id VARCHAR(50),
                description TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'En attente'
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS maintenance_org (
                id SERIAL PRIMARY KEY,
                label VARCHAR(100),
                role TEXT,
                contact VARCHAR(100),
                parent_id INTEGER REFERENCES maintenance_org(id)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS safety_actions (
                id SERIAL PRIMARY KEY,
                type VARCHAR(20),
                description TEXT,
                building VARCHAR(50),
                tableau_id VARCHAR(50) REFERENCES tableaux(id),
                status VARCHAR(20),
                date DATE,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS obsolescence_factors (
                id SERIAL PRIMARY KEY,
                disjoncteur_type VARCHAR(50),
                humidity_factor FLOAT DEFAULT 1.0,
                temperature_factor FLOAT DEFAULT 1.0,
                load_factor FLOAT DEFAULT 1.0
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS breaker_checklists (
                id SERIAL PRIMARY KEY,
                tableau_id VARCHAR(50) REFERENCES tableaux(id),
                disjoncteur_id VARCHAR(50),
                status VARCHAR(20) NOT NULL,
                comment TEXT NOT NULL,
                photo TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const orgCount = await pool.query('SELECT COUNT(*) FROM maintenance_org');
        if (parseInt(orgCount.rows[0].count) === 0) {
            console.log('[Server] Insertion des données par défaut pour maintenance_org');
            await pool.query(`
                INSERT INTO maintenance_org (label, role, contact, parent_id) VALUES
                ('Directeur Maintenance', 'Supervision générale', 'dir@autonomix.fr', NULL),
                ('Chef d’Équipe Électrique', 'Gestion des techniciens', 'chef@autonomix.fr', 1),
                ('Technicien Principal', 'Maintenance des tableaux', 'tech1@autonomix.fr', 2),
                ('Technicien Secondaire', 'Support technique', 'tech2@autonomix.fr', 2),
                ('Responsable Sécurité', 'Évaluation des risques', 'secu@autonomix.fr', 1)
            `);
        }
        const result = await pool.query('SELECT id, disjoncteurs FROM tableaux');
        for (const row of result.rows) {
            const disjoncteurs = row.disjoncteurs.map(d => ({
                ...d,
                cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength),
                impedance: d.impedance || null,
                ue: d.ue || null,
                section: d.section || `${getRecommendedSection(d.in)} mm²`,
                icn: normalizeIcn(d.icn),
                replacementDate: d.replacementDate || null,
                humidite: d.humidite || 50,
                temp_ambiante: d.temp_ambiante || 25,
                charge: d.charge || 80
            }));
            await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), row.id]);
        }
        console.log('[Server] Base de données initialisée avec succès');
    } catch (error) {
        console.error('[Server] Erreur lors de l\'initialisation de la DB:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
    }
}
initDb();

// Fonction pour normaliser icn
function normalizeIcn(icn) {
    if (icn === null || icn === undefined) return null;
    if (typeof icn === 'number' && !isNaN(icn)) {
        console.log('[Server] Normalisation icn:', { original: icn, normalized: icn });
        return icn;
    }
    if (typeof icn === 'string') {
        const match = icn.match(/[\d.]+/);
        const value = match ? parseFloat(match[0]) : null;
        console.log('[Server] Normalisation icn:', { original: icn, normalized: value });
        return value;
    }
    console.log('[Server] Normalisation icn: type non géré', { original: icn, normalized: null });
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
        if (!element) {
            throw new Error(`Sélecteur ${selector} non trouvé sur ${url}`);
        }
        const screenshot = await element.screenshot({ type: 'png' });
        console.log(`[Server] Capture réussie pour ${selector}`);
        await page.close();
        return screenshot;
    } catch (error) {
        console.error(`[Server] Erreur capture graphique (${selector} sur ${url}):`, {
            message: error.message,
            stack: error.stack
        });
        await page.close();
        throw error;
    }
}

// Route pour rechercher les caractéristiques d'un disjoncteur
app.post('/api/disjoncteur', async (req, res) => {
    const { marque, ref } = req.body;
    console.log('[Server] POST /api/disjoncteur - Requête reçue', { marque, ref });
    try {
        if (!marque || !ref) {
            throw new Error('Marque et référence sont requis');
        }
        const prompt = `Fournis les caractéristiques techniques du disjoncteur de marque "${marque}" et référence "${ref}". Retourne un JSON avec les champs suivants : id (laisser vide), type, poles, montage, ue, ui, uimp, frequence, in, ir, courbe, triptime, icn, ics, ip, temp, dimensions, section, date, tension, selectivite, lifespan (durée de vie en années, ex. 30), cableLength (laisser vide), impedance (laisser vide), humidite (en %, ex. 50), temp_ambiante (en °C, ex. 25), charge (en %, ex. 80). Si une information est manquante, utilise des valeurs par défaut plausibles ou laisse le champ vide.`;
        console.log('[Server] Prompt envoyé à OpenAI:', prompt);
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });
        const data = JSON.parse(response.choices[0].message.content);
        console.log('[Server] Réponse OpenAI:', JSON.stringify(data, null, 2));
        if (Object.keys(data).length === 0) {
            console.log('[Server] Aucune donnée retournée par OpenAI');
            res.status(404).json({ error: 'Aucune donnée trouvée pour ce disjoncteur' });
        } else {
            const validationErrors = validateDisjoncteurData(data);
            if (validationErrors.length > 0) {
                console.log('[Server] Erreurs de validation:', validationErrors);
                res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
                return;
            }
            data.icn = normalizeIcn(data.icn);
            data.section = data.section || `${getRecommendedSection(data.in)} mm²`;
            data.humidite = data.humidite || 50;
            data.temp_ambiante = data.temp_ambiante || 25;
            data.charge = data.charge || 80;
            res.json(data);
        }
    } catch (error) {
        console.error('[Server] Erreur POST /api/disjoncteur:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la recherche: ' + error.message });
    }
});

// Route pour récupérer les disjoncteurs existants
app.get('/api/disjoncteurs', async (req, res) => {
    console.log('[Server] GET /api/disjoncteurs');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT disjoncteurs FROM tableaux');
        console.log('[Server] Résultat requête SQL:', result.rows.map(row => `${row.disjoncteurs.length} disjoncteurs`));
        const allDisjoncteurs = result.rows.flatMap(row => row.disjoncteurs);
        const uniqueDisjoncteurs = Array.from(new Map(allDisjoncteurs.map(d => [`${d.marque}-${d.ref}`, d])).values());
        console.log('[Server] Disjoncteurs uniques:', uniqueDisjoncteurs.length);
        res.json(uniqueDisjoncteurs);
    } catch (error) {
        console.error('[Server] Erreur GET /api/disjoncteurs:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    }
});

// Route pour lister les identifiants des tableaux
app.get('/api/tableaux/ids', async (req, res) => {
    console.log('[Server] GET /api/tableaux/ids');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id FROM tableaux');
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
    }
});

// Route pour récupérer un tableau spécifique
app.get('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] GET /api/tableaux/', id);
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau trouvé:', { id, disjoncteurs: result.rows[0].disjoncteurs.length, isSiteMain: result.rows[0].isSiteMain });
            res.json(result.rows[0]);
        }
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    }
});

// Route pour récupérer tous les tableaux
app.get('/api/tableaux', async (req, res) => {
    console.log('[Server] GET /api/tableaux');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        console.log('[Server] Tableaux:', result.rows.length);
        res.json(result.rows);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des tableaux: ' + error.message });
    }
});

// Route pour /api/selectivity
app.get('/api/selectivity', async (req, res) => {
    console.log('[Server] GET /api/selectivity');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        const tableaux = result.rows.map(row => ({
            id: row.id,
            disjoncteurs: row.disjoncteurs,
            building: row.id.split('-')[0] || 'Inconnu',
            isSiteMain: row.isSiteMain || false
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
    }
});

// Route pour créer un nouveau tableau
app.post('/api/tableaux', async (req, res) => {
    const { id, disjoncteurs, isSiteMain } = req.body;
    console.log('[Server] POST /api/tableaux - Requête reçue:', { id, disjoncteurs: disjoncteurs?.length, isSiteMain });
    try {
        await pool.query('SELECT 1');
        if (!id) {
            throw new Error('L’ID du tableau est requis');
        }
        if (!Array.isArray(disjoncteurs)) {
            throw new Error('Les disjoncteurs doivent être un tableau');
        }
        const checkResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [id]);
        if (checkResult.rows.length > 0) {
            console.log('[Server] Erreur: ID tableau déjà utilisé:', id);
            res.status(400).json({ error: 'Cet identifiant de tableau existe déjà' });
            return;
        }
        // Validation des disjoncteurs
        const disjoncteurIds = disjoncteurs.map(d => d.id).filter(id => id);
        const uniqueIds = new Set(disjoncteurIds);
        if (uniqueIds.size !== disjoncteurIds.length) {
            console.log('[Server] Erreur: IDs de disjoncteurs non uniques:', disjoncteurIds);
            const duplicateIds = disjoncteurIds.filter((id, index) => disjoncteurIds.indexOf(id) !== index);
            throw new Error(`Les IDs suivants sont dupliqués dans le tableau : ${duplicateIds.join(', ')}`);
        }
        const normalizedDisjoncteurs = disjoncteurs.map(d => {
            const validationErrors = validateDisjoncteurData(d);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour disjoncteur ${d.id}: ${validationErrors.join('; ')}`);
            }
            return {
                ...d,
                icn: normalizeIcn(d.icn),
                cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength),
                section: d.section || `${getRecommendedSection(d.in)} mm²`,
                humidite: d.humidite || 50,
                temp_ambiante: d.temp_ambiante || 25,
                charge: d.charge || 80
            };
        });
        await pool.query(
            'INSERT INTO tableaux (id, disjoncteurs, isSiteMain) VALUES ($1, $2::jsonb, $3)',
            [id, JSON.stringify(normalizedDisjoncteurs), isSiteMain || false]
        );
        // Ajouter une checklist par défaut pour chaque disjoncteur
        for (const d of normalizedDisjoncteurs) {
            try {
                await pool.query(
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
    }
});

// Route pour mettre à jour un tableau
app.put('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    const { disjoncteurs, isSiteMain } = req.body;
    console.log('[Server] PUT /api/tableaux/', id, { disjoncteurs: disjoncteurs?.length, isSiteMain });
    try {
        await pool.query('SELECT 1');
        if (!id || !Array.isArray(disjoncteurs)) {
            throw new Error('ID et disjoncteurs (tableau) sont requis');
        }
        // Validation des disjoncteurs
        const disjoncteurIds = disjoncteurs.map(d => d.id).filter(id => id);
        const uniqueIds = new Set(disjoncteurIds);
        if (uniqueIds.size !== disjoncteurIds.length) {
            console.log('[Server] Erreur: IDs de disjoncteurs non uniques:', disjoncteurIds);
            const duplicateIds = disjoncteurIds.filter((id, index) => disjoncteurIds.indexOf(id) !== index);
            throw new Error(`Les IDs suivants sont dupliqués dans le tableau : ${duplicateIds.join(', ')}`);
        }
        const normalizedDisjoncteurs = disjoncteurs.map(d => {
            const validationErrors = validateDisjoncteurData(d);
            if (validationErrors.length > 0) {
                throw new Error(`Données invalides pour disjoncteur ${d.id}: ${validationErrors.join('; ')}`);
            }
            return {
                ...d,
                icn: normalizeIcn(d.icn),
                cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength),
                section: d.section || `${getRecommendedSection(d.in)} mm²`,
                humidite: d.humidite || 50,
                temp_ambiante: d.temp_ambiante || 25,
                charge: d.charge || 80
            };
        });
        const result = await pool.query(
            'UPDATE tableaux SET disjoncteurs = $1::jsonb, isSiteMain = $2 WHERE id = $3 RETURNING id, disjoncteurs, isSiteMain',
            [JSON.stringify(normalizedDisjoncteurs), isSiteMain || false, id]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau modifié:', {
                id,
                disjoncteurs: normalizedDisjoncteurs.length,
                isSiteMain: result.rows[0].isSiteMain
            });
            res.json({
                success: true,
                data: {
                    id: result.rows[0].id,
                    disjoncteurs: result.rows[0].disjoncteurs,
                    isSiteMain: result.rows[0].isSiteMain
                }
            });
        }
    } catch (error) {
        console.error('[Server] Erreur PUT /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
    }
});

// Route pour supprimer un tableau
app.delete('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/tableaux/:id', id);
    try {
        await pool.query('SELECT 1');
        // Supprimer les dépendances dans safety_actions
        await pool.query('DELETE FROM safety_actions WHERE tableau_id = $1', [id]);
        console.log('[Server] Actions de sécurité supprimées pour tableau:', id);

        // Supprimer les dépendances dans emergency_reports
        await pool.query('DELETE FROM emergency_reports WHERE tableau_id = $1', [id]);
        console.log('[Server] Rapports d’urgence supprimés pour tableau:', id);

        // Supprimer les checklists associées
        try {
            await pool.query('DELETE FROM breaker_checklists WHERE tableau_id = $1', [id]);
            console.log('[Server] Checklists supprimées pour tableau:', id);
        } catch (checklistError) {
            console.warn('[Server] Erreur suppression checklists pour tableau:', id, {
                message: checklistError.message,
                code: checklistError.code
            });
        }

        // Supprimer le tableau
        const result = await pool.query('DELETE FROM tableaux WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau supprimé:', id);
            res.json({ success: true });
        }
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/tableaux/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression: ' + error.message });
    }
});

// Calcul de l'obsolescence avec facteurs environnementaux
function calculateAdjustedLifespan(disjoncteur) {
    const lifespan = parseInt(disjoncteur.lifespan) || 30;
    let humidityFactor = 1.0;
    let temperatureFactor = 1.0;
    let loadFactor = 1.0;
    let criticalReason = [];

    // Facteur humidité
    const humidite = parseFloat(disjoncteur.humidite) || 50;
    if (humidite > 70) {
        const excess = (humidite - 70) / 10;
        humidityFactor = Math.max(0.5, 1.0 - (0.1 * excess));
        criticalReason.push(`Humidité élevée (${humidite}%)`);
    }

    // Facteur température
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

    // Facteur charge
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
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        const tableaux = result.rows.map(row => {
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
            const validYears = disjoncteurs
                .map(d => d.manufactureYear)
                .filter(year => typeof year === 'number' && !isNaN(year));
            const avgManufactureYear = validYears.length
                ? Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length)
                : 2000;
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                avgManufactureYear,
                isSiteMain: row.isSiteMain || false
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
    }
});

// Route pour mettre à jour la date de remplacement
app.post('/api/obsolescence/update', async (req, res) => {
    const { tableauId, disjoncteurId, replacementDate } = req.body;
    console.log('[Server] POST /api/obsolescence/update - Requête reçue:', { tableauId, disjoncteurId, replacementDate });
    try {
        await pool.query('SELECT 1');
        if (!tableauId || !disjoncteurId || !replacementDate) {
            throw new Error('Tableau ID, Disjoncteur ID et date de remplacement sont requis');
        }
        const result = await pool.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const disjoncteurs = result.rows[0].disjoncteurs;
        const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === disjoncteurId);
        if (disjoncteurIndex === -1) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            res.status(404).json({ error: 'Disjoncteur non trouvé' });
            return;
        }
        disjoncteurs[disjoncteurIndex].replacementDate = replacementDate;
        await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
        console.log('[Server] Date de remplacement mise à jour dans la DB:', { tableauId, disjoncteurId, replacementDate });
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/obsolescence/update:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
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
    try {
        await pool.query('SELECT 1');
        console.log('[Server] Récupération des données de la base');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        let tableauxData = result.rows;
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
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                isSiteMain: row.isSiteMain || false
            };
        });
        let faultLevelReportData = tableauxData.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                let ik = null;
                if (d.ue && (d.impedance || d.section)) {
                    const ueMatch = d.ue.match(/[\d.]+/);
                    const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
                    let z;
                    let L = isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength);
                    if (d.isPrincipal && L < 5) L = 5;
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
                isSiteMain: row.isSiteMain || false
            };
        });
        let safetyReportData = [];
        if (reportType === 'all' || reportType === 'safety') {
            const safetyResult = await pool.query('SELECT * FROM safety_actions');
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
                if (filters.dateFabrication) {
                    keep = tableau.disjoncteurs.some(d => d.date === filters.dateFabrication);
                }
                if (filters.courantNominal) {
                    keep = tableau.disjoncteurs.some(d => d.in === filters.courantNominal);
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
                        keep = item.disjoncteurs.some(d => d.status === filters.statutObsolescence);
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
            doc.text('Tableau | Bâtiment | Disjoncteurs', 50, doc.y);
            doc.moveDown(0.5);
            tableauxReportData.forEach(tableau => {
                doc.text(`${tableau.id} | ${tableau.building} | ${tableau.disjoncteurs.length}`, 50, doc.y);
                doc.moveDown(0.5);
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
                const principal = tableau.disjoncteurs.find(d => d.isPrincipal) || {};
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
            doc.text('Tableau | Disjoncteur | Âge | Statut | Durée de vie ajustée | Raison criticité', 50, doc.y);
            doc.moveDown(0.5);
            obsolescenceReportData.forEach(tableau => {
                tableau.disjoncteurs.forEach(d => {
                    doc.text(`${tableau.id} | ${d.id} | ${d.age || 'N/A'} | ${d.status} | ${d.adjustedLifespan} ans | ${d.criticalReason || 'N/A'}`, 50, doc.y);
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
        if (browser) {
            await browser.close();
            browser = null;
            console.log('[Server] Navigateur Puppeteer fermé');
        }
    } catch (error) {
        console.error('[Server] Erreur POST /api/reports:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        if (browser) {
            await browser.close();
            browser = null;
        }
        res.status(500).json({ error: 'Erreur lors de la génération du rapport: ' + error.message });
    }
});

// Endpoint pour récupérer l’organigramme de maintenance
app.get('/api/maintenance-org', async (req, res) => {
    console.log('[Server] GET /api/maintenance-org');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query(`
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
        const edges = nodes
            .filter(node => node.parent)
            .map(node => ({ from: node.parent, to: node.id }));
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
    }
});

// Endpoint pour signaler une panne
app.post('/api/emergency-report', async (req, res) => {
    const { tableauId, disjoncteurId, description } = req.body;
    console.log('[Server] POST /api/emergency-report - Requête reçue:', { tableauId, disjoncteurId, description });
    try {
        await pool.query('SELECT 1');
        if (!tableauId || !disjoncteurId || !description) {
            throw new Error('Tableau ID, disjoncteur ID et description sont requis');
        }
        const tableauResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [tableauId]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const result = await pool.query(
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
    }
});

// Endpoint pour mettre à jour un disjoncteur
app.put('/api/disjoncteur/:tableauId/:disjoncteurId', async (req, res) => {
    const { tableauId, disjoncteurId } = req.params;
    const updatedData = req.body;
    const newId = updatedData.newId || updatedData.id;
    console.log('[Server] PUT /api/disjoncteur/:tableauId/:disjoncteurId - Requête reçue:', { tableauId, disjoncteurId, newId, updatedData });
    try {
        await pool.query('SELECT 1');
        if (!tableauId || !disjoncteurId) {
            throw new Error('Tableau ID et Disjoncteur ID sont requis');
        }
        const validationErrors = validateDisjoncteurData({ ...updatedData, id: newId });
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
            return;
        }
        const result = await pool.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const disjoncteurs = result.rows[0].disjoncteurs;
        const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === decodeURIComponent(disjoncteurId));
        if (disjoncteurIndex === -1) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            res.status(404).json({ error: 'Disjoncteur non trouvé' });
            return;
        }
        // Vérifier si le nouvel ID est unique dans le tableau
        if (newId && newId !== decodeURIComponent(disjoncteurId)) {
            const idExists = disjoncteurs.some((d, i) => i !== disjoncteurIndex && d.id === newId);
            if (idExists) {
                console.log('[Server] Erreur: Nouvel ID déjà utilisé:', newId);
                res.status(400).json({ error: `L'ID "${newId}" est déjà utilisé dans ce tableau.` });
                return;
            }
            // Mettre à jour l'ID dans les checklists
            try {
                await pool.query(
                    'UPDATE breaker_checklists SET disjoncteur_id = $1 WHERE tableau_id = $2 AND disjoncteur_id = $3',
                    [newId, tableauId, decodeURIComponent(disjoncteurId)]
                );
            } catch (checklistError) {
                console.warn('[Server] Erreur mise à jour ID checklist pour disjoncteur:', disjoncteurId, {
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
                (disjoncteurs[disjoncteurIndex].isPrincipal ? 5 : 20) : parseFloat(updatedData.cableLength),
            humidite: updatedData.humidite || disjoncteurs[disjoncteurIndex].humidite || 50,
            temp_ambiante: updatedData.temp_ambiante || disjoncteurs[disjoncteurIndex].temp_ambiante || 25,
            charge: updatedData.charge || disjoncteurs[disjoncteurIndex].charge || 80
        };
        disjoncteurs[disjoncteurIndex] = updatedDisjoncteur;
        await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
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
    }
});

// Endpoint pour récupérer les données pour l'évaluation du niveau de défaut
app.get('/api/fault-level', async (req, res) => {
    console.log('[Server] GET /api/fault-level');
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        const tableaux = result.rows.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                let ik = null;
                if (d.ue && (d.impedance || d.section)) {
                    const ueMatch = d.ue.match(/[\d.]+/);
                    const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
                    let z;
                    let L = isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength);
                    if (d.isPrincipal && L < 5) L = 5;
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
                return {
                    ...d,
                    ik,
                    icn: normalizeIcn(d.icn),
                    tableauId: row.id
                };
            });
            return {
                id: row.id,
                building: row.id.split('-')[0] || 'Inconnu',
                disjoncteurs,
                isSiteMain: row.isSiteMain || false
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
    }
});

// Endpoint pour mettre à jour les données pour l'évaluation du niveau de défaut
app.post('/api/fault-level/update', async (req, res) => {
    const { tableauId, disjoncteurId, ue, section, cableLength, impedance } = req.body;
    console.log('[Server] POST /api/fault-level/update - Requête reçue:', { tableauId, disjoncteurId, ue, section, cableLength, impedance });
    try {
        await pool.query('SELECT 1');
        if (!tableauId || !disjoncteurId) {
            throw new Error('Tableau ID et Disjoncteur ID sont requis');
        }
        const result = await pool.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableauId);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const disjoncteurs = result.rows[0].disjoncteurs;
        const disjoncteurIndex = disjoncteurs.findIndex(d => d.id === disjoncteurId);
        if (disjoncteurIndex === -1) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteurId);
            res.status(404).json({ error: 'Disjoncteur non trouvé' });
            return;
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
            res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
            return;
        }
        disjoncteurs[disjoncteurIndex] = {
            ...disjoncteurs[disjoncteurIndex],
            ...updatedData
        };
        await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
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
    }
});

// Endpoints pour gérer les actions de sécurité
app.get('/api/safety-actions', async (req, res) => {
    const { building, tableau } = req.query;
    console.log('[Server] GET /api/safety-actions', { building, tableau });
    try {
        await pool.query('SELECT 1');
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
        const result = await pool.query(query, params);
        const actions = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            description: row.description,
            building: row.building,
            tableau: row.tableau_id,
            status: row.status,
            date: row.date ? row.date.toISOString().split('T')[0] : null
        }));
        console.log('[Server] Actions récupérées:', actions.length);
        res.json(actions);
    } catch (error) {
        console.error('[Server] Erreur GET /api/safety-actions:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des actions: ' + error.message });
    }
});

app.get('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] GET /api/safety-actions/', id);
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('SELECT * FROM safety_actions WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            res.status(404).json({ error: 'Action non trouvée' });
        } else {
            const action = {
                id: result.rows[0].id,
                type: result.rows[0].type,
                description: result.rows[0].description,
                building: result.rows[0].building,
                tableau: result.rows[0].tableau_id,
                status: result.rows[0].status,
                date: result.rows[0].date ? result.rows[0].date.toISOString().split('T')[0] : null
            };
            console.log('[Server] Action trouvée:', action);
            res.json(action);
        }
    } catch (error) {
        console.error('[Server] Erreur GET /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération de l’action: ' + error.message });
    }
});

app.post('/api/safety-actions', async (req, res) => {
    const { type, description, building, tableau, status, date } = req.body;
    console.log('[Server] POST /api/safety-actions - Requête reçue:', { type, description, building, tableau, status, date });
    try {
        await pool.query('SELECT 1');
        if (!type || !description || !building || !status) {
            throw new Error('Type, description, bâtiment et statut sont requis');
        }
        if (tableau) {
            const tableauResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
            if (tableauResult.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableau);
                res.status(404).json({ error: 'Tableau non trouvé' });
                return;
            }
        }
        const result = await pool.query(
            'INSERT INTO safety_actions (type, description, building, tableau_id, status, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [type, description, building, tableau || null, status, date || null]
        );
        console.log('[Server] Action créée:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur POST /api/safety-actions:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la création de l’action: ' + error.message });
    }
});

app.put('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    const { type, description, building, tableau, status, date } = req.body;
    console.log('[Server] PUT /api/safety-actions/', id, { type, description, building, tableau, status, date });
    try {
        await pool.query('SELECT 1');
        if (!type || !description || !building || !status) {
            throw new Error('Type, description, bâtiment et statut sont requis');
        }
        const result = await pool.query('SELECT * FROM safety_actions WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            res.status(404).json({ error: 'Action non trouvée' });
            return;
        }
        if (tableau) {
            const tableauResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
            if (tableauResult.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableau);
                res.status(404).json({ error: 'Tableau non trouvé' });
                return;
            }
        }
        const updatedResult = await pool.query(
            'UPDATE safety_actions SET type = $1, description = $2, building = $3, tableau_id = $4, status = $5, date = $6 WHERE id = $7 RETURNING *',
            [type, description, building, tableau || null, status, date || null, id]
        );
        console.log('[Server] Action mise à jour:', updatedResult.rows[0]);
        res.json({ success: true, data: updatedResult.rows[0] });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour de l’action: ' + error.message });
    }
});

app.delete('/api/safety-actions/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/safety-actions/', id);
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('DELETE FROM safety_actions WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Action non trouvée:', id);
            res.status(404).json({ error: 'Action non trouvée' });
        } else {
            console.log('[Server] Action supprimée:', id);
            res.json({ success: true });
        }
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/safety-actions/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la suppression de l’action: ' + error.message });
    }
});

// Endpoints pour gérer les checklists des disjoncteurs
app.get('/api/breaker-checklists', async (req, res) => {
    const { tableau_id, disjoncteur_id } = req.query;
    console.log('[Server] GET /api/breaker-checklists', { tableau_id, disjoncteur_id });
    try {
        // Vérifier la connexion à la base de données
        await pool.query('SELECT 1');
        // Vérifier si le tableau existe
        if (tableau_id) {
            const tableauResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [tableau_id]);
            if (tableauResult.rows.length === 0) {
                console.log('[Server] Tableau non trouvé:', tableau_id);
                return res.status(404).json({ error: 'Tableau non trouvé' });
            }
        }
        // Vérifier si la table breaker_checklists existe
        const tableCheck = await pool.query("SELECT to_regclass('public.breaker_checklists') AS table_exists");
        if (!tableCheck.rows[0].table_exists) {
            console.log('[Server] Table breaker_checklists non trouvée');
            return res.status(500).json({ error: 'Table breaker_checklists non trouvée dans la base de données' });
        }
        let query = 'SELECT * FROM breaker_checklists';
        const params = [];
        const conditions = [];
        if (tableau_id) {
            conditions.push(`tableau_id = $${params.length + 1}`);
            params.push(tableau_id);
        }
        if (disjoncteur_id) {
            conditions.push(`disjoncteur_id = $${params.length + 1}`);
            params.push(disjoncteur_id);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY timestamp DESC';
        const result = await pool.query(query, params);
        const checklists = result.rows.map(row => ({
            id: row.id,
            tableau_id: row.tableau_id,
            disjoncteur_id: row.disjoncteur_id,
            status: row.status,
            comment: row.comment,
            photo: row.photo || null,
            timestamp: row.timestamp.toISOString()
        }));
        console.log('[Server] Checklists récupérées:', checklists.length);
        res.json(checklists);
    } catch (error) {
        console.error('[Server] Erreur GET /api/breaker-checklists:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail,
            query: req.query
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des checklists: ' + error.message });
    }
});

app.post('/api/breaker-checklists', async (req, res) => {
    const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
    console.log('[Server] POST /api/breaker-checklists - Requête reçue:', { tableau_id, disjoncteur_id, status, comment, photo: photo ? 'Présente' : 'Absente' });
    try {
        await pool.query('SELECT 1');
        const validationErrors = validateChecklistData({ tableau_id, disjoncteur_id, status, comment, photo });
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
            return;
        }
        const tableauResult = await pool.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableau_id);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const disjoncteurs = tableauResult.rows[0].disjoncteurs;
        if (!disjoncteurs.some(d => d.id === disjoncteur_id)) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteur_id);
            res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
            return;
        }
        const result = await pool.query(
            'INSERT INTO breaker_checklists (tableau_id, disjoncteur_id, status, comment, photo) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [tableau_id, disjoncteur_id, status, comment, photo || null]
        );
        const checklist = {
            id: result.rows[0].id,
            tableau_id: result.rows[0].tableau_id,
            disjoncteur_id: result.rows[0].disjoncteur_id,
            status: result.rows[0].status,
            comment: result.rows[0].comment,
            photo: result.rows[0].photo || null,
            timestamp: result.rows[0].timestamp.toISOString()
        };
        console.log('[Server] Checklist créée:', checklist);
        res.json({ success: true, data: checklist });
    } catch (error) {
        console.error('[Server] Erreur POST /api/breaker-checklists:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la création de la checklist: ' + error.message });
    }
});

app.put('/api/breaker-checklists/:id', async (req, res) => {
    const { id } = req.params;
    const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
    console.log('[Server] PUT /api/breaker-checklists/', id, { tableau_id, disjoncteur_id, status, comment, photo: photo ? 'Présente' : 'Absente' });
    try {
        await pool.query('SELECT 1');
        const validationErrors = validateChecklistData({ tableau_id, disjoncteur_id, status, comment, photo });
        if (validationErrors.length > 0) {
            console.log('[Server] Erreurs de validation:', validationErrors);
            res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
            return;
        }
        const tableauResult = await pool.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
        if (tableauResult.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', tableau_id);
            res.status(404).json({ error: 'Tableau non trouvé' });
            return;
        }
        const disjoncteurs = tableauResult.rows[0].disjoncteurs;
        if (!disjoncteurs.some(d => d.id === disjoncteur_id)) {
            console.log('[Server] Disjoncteur non trouvé:', disjoncteur_id);
            res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
            return;
        }
        const result = await pool.query(
            'UPDATE breaker_checklists SET tableau_id = $1, disjoncteur_id = $2, status = $3, comment = $4, photo = $5 WHERE id = $6 RETURNING *',
            [tableau_id, disjoncteur_id, status, comment, photo || null, id]
        );
        if (result.rows.length === 0) {
            console.log('[Server] Checklist non trouvée:', id);
            res.status(404).json({ error: 'Checklist non trouvée' });
            return;
        }
        const checklist = {
            id: result.rows[0].id,
            tableau_id: result.rows[0].tableau_id,
            disjoncteur_id: result.rows[0].disjoncteur_id,
            status: result.rows[0].status,
            comment: result.rows[0].comment,
            photo: result.rows[0].photo || null,
            timestamp: result.rows[0].timestamp.toISOString()
        };
        console.log('[Server] Checklist mise à jour:', checklist);
        res.json({ success: true, data: checklist });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/breaker-checklists/:id:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la mise à jour de la checklist: ' + error.message });
    }
});

app.delete('/api/breaker-checklists/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/breaker-checklists/', id);
    try {
        await pool.query('SELECT 1');
        const result = await pool.query('DELETE FROM breaker_checklists WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Checklist non trouvée:', id);
            res.status(404).json({ error: 'Checklist non trouvée' });
            return;
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
    }
});

app.get('/api/breaker-checklists/stats', async (req, res) => {
    const { building, tableau, disjoncteur } = req.query;
    console.log('[Server] GET /api/breaker-checklists/stats', { building, tableau, disjoncteur });
    try {
        await pool.query('SELECT 1');
        const tableauxResult = await pool.query('SELECT id, disjoncteurs FROM tableaux');
        const checklistsResult = await pool.query('SELECT * FROM breaker_checklists');
        const tableaux = tableauxResult.rows.map(row => ({
            id: row.id,
            building: row.id.split('-')[0] || 'Inconnu',
            disjoncteurs: row.disjoncteurs
        }));
        const checklists = checklistsResult.rows.map(row => ({
            id: row.id,
            tableau_id: row.tableau_id,
            disjoncteur_id: row.disjoncteur_id,
            status: row.status,
            comment: row.comment,
            photo: row.photo || null,
            timestamp: row.timestamp.toISOString()
        }));

        let stats = {
            byBuilding: {},
            byTableau: {},
            byDisjoncteur: {},
            tableauCompliance: {}
        };

        // Agrégation par bâtiment
        const buildings = [...new Set(tableaux.map(t => t.building))];
        buildings.forEach(b => {
            if (!building || b === building) {
                const buildingChecklists = checklists.filter(c => tableaux.find(t => t.building === b && t.id === c.tableau_id));
                stats.byBuilding[b] = {
                    Conforme: buildingChecklists.filter(c => c.status === 'Conforme').length,
                    'Non conforme': buildingChecklists.filter(c => c.status === 'Non conforme').length,
                    'Non applicable': buildingChecklists.filter(c => c.status === 'Non applicable').length
                };
            }
        });

        // Agrégation par tableau et conformité
        tableaux.forEach(t => {
            if (!building || t.building === building) {
                if (!tableau || t.id === tableau) {
                    const tableauChecklists = checklists.filter(c => c.tableau_id === t.id);
                    stats.byTableau[t.id] = {
                        Conforme: tableauChecklists.filter(c => c.status === 'Conforme').length,
                        'Non conforme': tableauChecklists.filter(c => c.status === 'Non conforme').length,
                        'Non applicable': tableauChecklists.filter(c => c.status === 'Non applicable').length
                    };

                    // Calculer la conformité du tableau
                    const disjoncteurIds = t.disjoncteurs.map(d => d.id);
                    const controlledDisjoncteurs = [...new Set(tableauChecklists.map(c => c.disjoncteur_id))];
                    const allControlled = disjoncteurIds.every(id => controlledDisjoncteurs.includes(id));
                    const allConforme = allControlled && tableauChecklists.every(c => c.status === 'Conforme');
                    stats.tableauCompliance[t.id] = {
                        isCompliant: allConforme,
                        nonControlledDisjoncteurs: disjoncteurIds.filter(id => !controlledDisjoncteurs.includes(id))
                    };
                }
            }
        });

        // Agrégation par disjoncteur
        tableaux.forEach(t => {
            if (!building || t.building === building) {
                if (!tableau || t.id === tableau) {
                    t.disjoncteurs.forEach(d => {
                        if (!disjoncteur || d.id === disjoncteur) {
                            const disjoncteurChecklists = checklists.filter(c => c.tableau_id === t.id && c.disjoncteur_id === d.id);
                            stats.byDisjoncteur[`${t.id}-${d.id}`] = {
                                Conforme: disjoncteurChecklists.filter(c => c.status === 'Conforme').length,
                                'Non conforme': disjoncteurChecklists.filter(c => c.status === 'Non conforme').length,
                                'Non applicable': disjoncteurChecklists.filter(c => c.status === 'Non applicable').length
                            };
                        }
                    });
                }
            }
        });

        console.log('[Server] Statistiques des checklists générées:', stats);
        res.json(stats);
    } catch (error) {
        console.error('[Server] Erreur GET /api/breaker-checklists/stats:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques: ' + error.message });
    }
});

// Servir les fichiers HTML pour toutes les routes
const path = require('path');
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
    console.log('[Server] Serveur démarré sur http://localhost:3000');
});