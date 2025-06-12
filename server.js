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
    ssl: { rejectUnauthorized: false }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gestion fichier replacementDates.json
const REPLACEMENT_FILE = 'replacementDates.json';
let replacementDates = {};
if (fs.existsSync(REPLACEMENT_FILE)) {
    const raw = fs.readFileSync(REPLACEMENT_FILE);
    replacementDates = JSON.parse(raw);
}

// Tableau des sections de câbles selon le courant assigné (cuivre, monophasé)
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
    { in: 630, section: 400 }
];

// Fonction pour obtenir la section recommandée selon In
function getRecommendedSection(inValue) {
    const inNum = parseFloat(inValue?.match(/[\d.]+/)?.[0]) || 0;
    for (let i = 0; i < cableSections.length; i++) {
        if (inNum <= cableSections[i].in) {
            return cableSections[i].section;
        }
    }
    return 240; // Par défaut pour In > 630 A
}

// Initialisation de la base de données
async function initDb() {
    console.log('[Server] Initialisation de la base de données');
    try {
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
                replacementDate: d.replacementDate || null
            }));
            await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), row.id]);
        }
        console.log('[Server] Base de données initialisée avec succès');
    } catch (error) {
        console.error('[Server] Erreur lors de l\'initialisation de la DB:', error.message, error.stack);
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
        console.error(`[Server] Erreur capture graphique (${selector} sur ${url}):`, error.message);
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
        const prompt = `Fournis les caractéristiques techniques du disjoncteur de marque "${marque}" et référence "${ref}". Retourne un JSON avec les champs suivants : id (laisser vide), type, poles, montage, ue, ui, uimp, frequence, in, ir, courbe, triptime, icn, ics, ip, temp, dimensions, section, date, tension, selectivite, lifespan (durée de vie en années, ex. 30), cableLength (laisser vide), impedance (laisser vide). Si une information est manquante, laisse le champ vide.`;
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
            data.icn = normalizeIcn(data.icn);
            data.section = data.section || `${getRecommendedSection(data.in)} mm²`;
            res.json(data);
        }
    } catch (error) {
        console.error('[Server] Erreur POST /api/disjoncteur:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la recherche: ' + error.message });
    }
});

// Route pour récupérer les disjoncteurs existants
app.get('/api/disjoncteurs', async (req, res) => {
    console.log('[Server] GET /api/disjoncteurs');
    try {
        const result = await pool.query('SELECT disjoncteurs FROM tableaux');
        console.log('[Server] Résultat requête SQL:', result.rows.map(row => `${row.disjoncteurs.length} disjoncteurs`));
        const allDisjoncteurs = result.rows.flatMap(row => row.disjoncteurs);
        const uniqueDisjoncteurs = Array.from(new Map(allDisjoncteurs.map(d => [`${d.marque}-${d.ref}`, d])).values());
        console.log('[Server] Disjoncteurs uniques:', uniqueDisjoncteurs.length);
        res.json(uniqueDisjoncteurs);
    } catch (error) {
        console.error('[Server] Erreur GET /api/disjoncteurs:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    }
});

// Route pour lister les identifiants des tableaux
app.get('/api/tableaux/ids', async (req, res) => {
    console.log('[Server] GET /api/tableaux/ids');
    try {
        const result = await pool.query('SELECT id FROM tableaux');
        const ids = result.rows.map(row => row.id);
        console.log('[Server] IDs tableaux:', ids);
        res.json(ids);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux/ids:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération des IDs: ' + error.message });
    }
});

// Route pour récupérer un tableau spécifique
app.get('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] GET /api/tableaux/', id);
    try {
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau trouvé:', { id, disjoncteurs: result.rows[0].disjoncteurs.length, isSiteMain: result.rows[0].isSiteMain });
            res.json(result.rows[0]);
        }
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux/:id:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    }
});

// Route pour récupérer tous les tableaux
app.get('/api/tableaux', async (req, res) => {
    console.log('[Server] GET /api/tableaux');
    try {
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        console.log('[Server] Tableaux:', result.rows.length);
        res.json(result.rows);
    } catch (error) {
        console.error('[Server] Erreur GET /api/tableaux:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération: ' + error.message });
    }
});

// Route pour /api/selectivity
app.get('/api/selectivity', async (req, res) => {
    console.log('[Server] GET /api/selectivity');
    try {
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
        console.error('[Server] Erreur GET /api/selectivity:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération des données de sélectivité: ' + error.message });
    }
});

// Route pour créer un nouveau tableau
app.post('/api/tableaux', async (req, res) => {
    const { id, disjoncteurs, isSiteMain } = req.body;
    console.log('[Server] POST /api/tableaux - Requête reçue:', { id, disjoncteurs: disjoncteurs?.length, isSiteMain });
    try {
        if (!id || !disjoncteurs || !Array.isArray(disjoncteurs)) {
            throw new Error('ID et disjoncteurs sont requis');
        }
        // Vérifier si l'ID existe déjà
        const checkResult = await pool.query('SELECT id FROM tableaux WHERE id = $1', [id]);
        if (checkResult.rows.length > 0) {
            console.log('[Server] Erreur: ID tableau déjà utilisé:', id);
            res.status(400).json({ error: 'Cet identifiant de tableau existe déjà' });
            return;
        }
        const normalizedDisjoncteurs = disjoncteurs.map(d => ({
            ...d,
            icn: normalizeIcn(d.icn),
            cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength),
            section: d.section || `${getRecommendedSection(d.in)} mm²`
        }));
        await pool.query('INSERT INTO tableaux (id, disjoncteurs, isSiteMain) VALUES ($1, $2::jsonb, $3)', [id, JSON.stringify(normalizedDisjoncteurs), isSiteMain || false]);
        console.log('[Server] Tableau créé:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/tableaux:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la création: ' + error.message });
    }
});

// Route pour mettre à jour un tableau
app.put('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    const { disjoncteurs, isSiteMain } = req.body;
    console.log('[Server] PUT /api/tableaux/', id);
    try {
        if (!id || !disjoncteurs || !Array.isArray(disjoncteurs)) {
            throw new Error('ID et disjoncteurs sont requis');
        }
        const normalizedDisjoncteurs = disjoncteurs.map(d => ({
            ...d,
            icn: normalizeIcn(d.icn),
            cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength),
            section: d.section || `${getRecommendedSection(d.in)} mm²`
        }));
        const result = await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb, isSiteMain = $2 WHERE id = $3 RETURNING *', [JSON.stringify(normalizedDisjoncteurs), isSiteMain || false, id]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau modifié:', { id, disjoncteurs: normalizedDisjoncteurs.length, isSiteMain });
            res.json({ success: true });
        }
    } catch (error) {
        console.error('[Server] Erreur PUT /api/tableaux/:id:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
    }
});

// Route pour supprimer un tableau
app.delete('/api/tableaux/:id', async (req, res) => {
    const { id } = req.params;
    console.log('[Server] DELETE /api/tableaux/', id);
    try {
        const result = await pool.query('DELETE FROM tableaux WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            console.log('[Server] Tableau non trouvé:', id);
            res.status(404).json({ error: 'Tableau non trouvé' });
        } else {
            console.log('[Server] Tableau supprimé:', id);
            res.json({ success: true });
        }
    } catch (error) {
        console.error('[Server] Erreur DELETE /api/tableaux/:id:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la suppression: ' + error.message });
    }
});

// Route pour analyser l'obsolescence
app.get('/api/obsolescence', async (req, res) => {
    console.log('[Server] GET /api/obsolescence');
    try {
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        const tableaux = result.rows.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                const date = d.date ? new Date(d.date) : null;
                const manufactureYear = date ? date.getFullYear() : null;
                const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                const lifespan = parseInt(d.lifespan) || 30;
                const status = age !== null && age >= lifespan ? 'Obsolète' : 'OK';
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
                    replacementDate
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
        console.error('[Server] Erreur GET /api/obsolescence:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de l\'analyse: ' + error.message });
    }
});

// Route pour mettre à jour la date de remplacement
app.post('/api/obsolescence/update', async (req, res) => {
    const { tableauId, disjoncteurId, replacementDate } = req.body;
    console.log('[Server] POST /api/obsolescence/update - Requête reçue:', { tableauId, disjoncteurId, replacementDate });
    try {
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
        console.error('[Server] Erreur POST /api/obsolescence/update:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
    }
});

// Route pour récupérer les données de niveau de défaut
app.get('/api/fault-level', async (req, res) => {
    console.log('[Server] GET /api/fault-level');
    try {
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        const tableaux = result.rows.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                let ik = null;
                let sectionWarning = null;
                if (d.ue && (d.impedance || d.section)) {
                    const ueMatch = d.ue.match(/[\d.]+/);
                    const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
                    let z;
                    let L = isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 5 : 20) : parseFloat(d.cableLength);
                    let S = null;
                    if (d.isPrincipal && L < 5) {
                        console.log('[Server] Longueur de câble principal ajustée à 5 m:', { id: d.id, cableLength: L });
                        L = 5;
                    } else if (!d.isPrincipal && L < 20) {
                        console.log('[Server] Longueur de câble non principal ajustée à 20 m:', { id: d.id, cableLength: L });
                        L = 20;
                    }
                    if (d.impedance) {
                        z = parseFloat(d.impedance);
                        if (z < 0.05) {
                            console.log('[Server] Impédance z trop faible, ajustée à 0.05:', { id: d.id, impedance: z });
                            z = 0.05;
                        }
                    } else {
                        const rho = 0.0175;
                        const sectionMatch = d.section ? d.section.match(/[\d.]+/) : null;
                        S = sectionMatch ? parseFloat(sectionMatch[0]) : getRecommendedSection(d.in);
                        const recommendedS = getRecommendedSection(d.in);
                        if (S < recommendedS) {
                            sectionWarning = `Section ${S} mm² incohérente pour In=${d.in} (recommandé: ${recommendedS} mm²)`;
                            console.warn('[Server] Section incohérente:', { id: d.id, section: S, recommended: recommendedS });
                            S = recommendedS;
                        }
                        if (S < 0.5) {
                            console.log('[Server] Section trop faible, ajustée à 0.5 mm²:', { id: d.id, section: d.section, adjusted: S });
                            S = 0.5;
                        }
                        const Z_cable = (rho * L * 2) / S;
                        const Z_network = 0.01;
                        z = Z_cable + Z_network;
                        if (z < 0.05) {
                            console.log('[Server] Impédance calculée trop faible, ajustée à 0.05:', { id: d.id, z, L, S });
                            z = 0.05;
                        }
                    }
                    ik = (ue / (Math.sqrt(3) * z)) / 1000;
                    if (ik > 100) {
                        console.warn('[Server] Ik trop élevé, défini à null:', { id: d.id, ik, ue, z, L, S });
                        ik = null;
                    }
                    console.log('[Server] Calcul Ik:', { id: d.id, ue, z, L, S: S || 'N/A', ik });
                } else {
                    console.log('[Server] Données insuffisantes pour Ik:', { id: d.id, ue: d.ue, cableLength: d.cableLength, section: d.section });
                }
                return {
                    ...d,
                    ik,
                    icn: normalizeIcn(d.icn),
                    sectionWarning,
                    tableauId: row.id
                };
            });
            const building = row.id.split('-')[0] || 'Inconnu';
            return { id: row.id, building, disjoncteurs, isSiteMain: row.isSiteMain || false };
        });
        console.log('[Server] Données FLA:', tableaux.length);
        res.json({ data: tableaux });
    } catch (error) {
        console.error('[Server] Erreur GET /api/fault-level:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération des données: ' + error.message });
    }
});

// Route pour mettre à jour les données de câble
app.post('/api/fault-level/update', async (req, res) => {
    const { tableauId, disjoncteurId, ue, section, cableLength, impedance } = req.body;
    console.log('[Server] POST /api/fault-level/update - Requête reçue:', { tableauId, disjoncteurId, ue, section, cableLength, impedance });
    try {
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
        const updatedDisjoncteur = {
            ...disjoncteurs[disjoncteurIndex],
            ue: ue || disjoncteurs[disjoncteurIndex].ue,
            section: section || disjoncteurs[disjoncteurIndex].section || `${getRecommendedSection(disjoncteurs[disjoncteurIndex].in)} mm²`,
            cableLength: isNaN(parseFloat(cableLength)) ? (disjoncteurs[disjoncteurIndex].isPrincipal ? 5 : 20) : parseFloat(cableLength),
            impedance: impedance ? parseFloat(impedance) : null
        };
        const inNum = parseFloat(updatedDisjoncteur.in?.match(/[\d.]+/)?.[0]) || 0;
        const sectionNum = parseFloat(updatedDisjoncteur.section?.match(/[\d.]+/)?.[0]) || 0;
        const recommendedS = getRecommendedSection(updatedDisjoncteur.in);
        if (sectionNum < recommendedS) {
            console.warn('[Server] Section incohérente lors de la mise à jour:', { id: disjoncteurId, section: sectionNum, recommended: recommendedS });
            updatedDisjoncteur.sectionWarning = `Section ${sectionNum} mm² incohérente pour In=${updatedDisjoncteur.in} (recommandé: ${recommendedS} mm²)`;
        }
        disjoncteurs[disjoncteurIndex] = updatedDisjoncteur;
        console.log('[Server] Disjoncteur mis à jour:', { id: disjoncteurId, updated: updatedDisjoncteur });
        await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
        console.log('[Server] SQL exécuté pour tableau:', tableauId);
        res.json({ success: true });
    } catch (error) {
        console.error('[Server] Erreur POST /api/fault-level/update:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + error.message });
    }
});

// Route POST pour sauvegarder la date de remplacement manuellement (pour Gantt)
app.post('/api/obsolescence/replacement', (req, res) => {
    const { tableauId, replacementYear } = req.body;
    if (!tableauId || !replacementYear) {
        return res.status(400).json({ error: 'Champs manquants' });
    }
    replacementDates[tableauId] = replacementYear;
    fs.writeFile(REPLACEMENT_FILE, JSON.stringify(replacementDates, null, 2), err => {
        if (err) {
            console.error('[Server] Erreur écriture replacementDates:', err);
            return res.status(500).json({ error: 'Erreur enregistrement' });
        }
        console.log(`[Server] Replacement date mise à jour: ${tableauId} => ${replacementYear}`);
        res.json({ success: true });
    });
});

// Route pour générer les rapports PDF
app.post('/api/reports', async (req, res) => {
    const { reportType, filters } = req.body;
    console.log('[Server] POST /api/reports - Début de la génération:', { reportType, filters });
    try {
        console.log('[Server] Récupération des données de la base');
        const result = await pool.query('SELECT id, disjoncteurs, isSiteMain FROM tableaux');
        let tableauxData = result.rows;
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
        }
        console.log('[Server] Filtrage terminé, tableaux restants:', tableauxData.length);
        let tableauxReportData = tableauxData;
        let selectivityReportData = tableauxData;
        let obsolescenceReportData = tableauxData.map(row => {
            const disjoncteurs = row.disjoncteurs.map(d => {
                const date = d.date ? new Date(d.date) : null;
                const manufactureYear = date ? date.getFullYear() : null;
                const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
                const lifespan = parseInt(d.lifespan) || 30;
                const status = age !== null && age >= lifespan ? 'Obsolète' : 'OK';
                let replacementDate = d.replacementDate || replacementDates[`${row.id}-${d.id}`] || null;
                if (!replacementDate) {
                    if (status === 'Obsolète') {
                        replacementDate = `${new Date().getFullYear() + 1}-01-01`;
                    } else if (!manufactureYear) {
                        replacementDate = `${new Date().getFullYear() + 2}-01-01`;
                    }
                }
                return { ...d, manufactureYear, age, status, replacementDate };
            });
            return { id: row.id, building: row.id.split('-')[0] || 'Inconnu', disjoncteurs, isSiteMain: row.isSiteMain || false };
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
            return { id: row.id, building: row.id.split('-')[0] || 'Inconnu', disjoncteurs, isSiteMain: row.isSiteMain || false };
        });
        if (filters && reportType !== 'all') {
            const specificData = reportType === 'obsolescence' ? obsolescenceReportData : reportType === 'fault_level' ? faultLevelReportData : tableauxData;
            specificData = specificData.filter(tableau => {
                let keep = true;
                if (filters.statutSelectivite && reportType === 'selectivity') {
                    keep = tableau.disjoncteurs.some(d => d.selectivityStatus === filters.statutSelectivite);
                }
                if (filters.statutObsolescence && reportType === 'obsolescence') {
                    keep = tableau.disjoncteurs.some(d => d.status === filters.statutObsolescence);
                }
                if (filters.statutFault && reportType === 'fault_level') {
                    keep = tableau.disjoncteurs.some(d => (d.ik && d.icn && (d.ik > d.icn ? 'KO' : 'OK') === filters.statutFault));
                }
                return keep;
            });
            if (reportType === 'obsolescence') obsolescenceReportData = specificData;
            else if (reportType === 'fault_level') faultLevelReportData = specificData;
            else tableauxData = specificData;
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
            doc.text('Tableau | Disjoncteur | Âge | Statut', 50, doc.y);
            doc.moveDown(0.5);
            obsolescenceReportData.forEach(tableau => {
                tableau.disjoncteurs.forEach(d => {
                    doc.text(`${tableau.id} | ${d.id} | ${d.age || 'N/A'} | ${d.status}`, 50, doc.y);
                    doc.moveDown(0.5);
                });
            });
            try {
                console.log('[Server] Capture graphique CAPEX');
                const capexImage = await captureChart('http://localhost:3000/obsolescence.html', '#capex-chart');
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
        console.log('[Server] Finalisation du PDF');
        doc.end();
        if (browser) {
            await browser.close();
            browser = null;
            console.log('[Server] Navigateur Puppeteer fermé');
        }
    } catch (error) {
        console.error('[Server] Erreur POST /api/reports:', error.message, error.stack);
        if (browser) {
            await browser.close();
            browser = null;
        }
        res.status(500).json({ error: 'Erreur lors de la génération du rapport: ' + error.message });
    }
});

// Nouveau endpoint pour récupérer l’organigramme de maintenance
app.get('/api/maintenance-org', async (req, res) => {
    console.log('[Server] GET /api/maintenance-org');
    try {
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
        console.error('[Server] Erreur GET /api/maintenance-org:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la récupération de l’organigramme: ' + error.message });
    }
});

// Nouveau endpoint pour signaler une panne
app.post('/api/emergency-report', async (req, res) => {
    const { tableauId, disjoncteurId, description } = req.body;
    console.log('[Server] POST /api/emergency-report - Requête reçue:', { tableauId, disjoncteurId, description });
    try {
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
        console.error('[Server] Erreur POST /api/emergency-report:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors du signalement de la panne: ' + error.message });
    }
});

// Nouveau endpoint pour mettre à jour un disjoncteur
app.put('/api/disjoncteur/:tableauId/:disjoncteurId', async (req, res) => {
    const { tableauId, disjoncteurId } = req.params;
    const updatedData = req.body;
    console.log('[Server] PUT /api/disjoncteur/:tableauId/:disjoncteurId - Requête reçue:', { tableauId, disjoncteurId, updatedData });
    try {
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
        const updatedDisjoncteur = {
            ...disjoncteurs[disjoncteurIndex],
            ...updatedData,
            icn: normalizeIcn(updatedData.icn || disjoncteurs[disjoncteurIndex].icn),
            section: updatedData.section || disjoncteurs[disjoncteurIndex].section || `${getRecommendedSection(updatedData.in || disjoncteurs[disjoncteurIndex].in)} mm²`,
            cableLength: isNaN(parseFloat(updatedData.cableLength)) ? 
                (disjoncteurs[disjoncteurIndex].isPrincipal ? 5 : 20) : 
                parseFloat(updatedData.cableLength)
        };
        disjoncteurs[disjoncteurIndex] = updatedDisjoncteur;
        await pool.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
        console.log('[Server] Disjoncteur mis à jour:', { tableauId, disjoncteurId });
        res.json({ success: true, data: updatedDisjoncteur });
    } catch (error) {
        console.error('[Server] Erreur PUT /api/disjoncteur/:tableauId/:disjoncteurId:', error.message, error.stack);
        res.status(500).json({ error: 'Erreur lors de la mise à jour du disjoncteur: ' + error.message });
    }
});

const path = require('path');

// Servir les fichiers HTML pour toutes les routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
    console.log('[Server] Serveur démarré sur http://localhost:3000');
});