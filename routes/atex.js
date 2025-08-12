// routes/atex.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const multer = require('multer');
const upload = multer();
const XLSX = require('xlsx');
const { openai } = require('../config/openai');

const JSON_LIMIT_ERR = 'Charge utile trop volumineuse. Utilisez une image redimensionnée.';

/* ----------------------- Helpers DB sûrs ----------------------- */
async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}
async function rowsOrEmpty(sql, params = []) {
  try { const r = await query(sql, params); return r.rows; }
  catch (e) {
    if (e && (e.code === '42P01' || /relation .* does not exist/i.test(e.message))) return [];
    throw e;
  }
}

/* ----------------------- Utilitaires métier ----------------------- */
const REQUIRED_FIELDS = ['composant', 'type', 'marquage_atex'];

function mapAliases(payload = {}) {
  // Compat : “fabricant” -> fournisseur ; “zone_type” remplace exterieur/interieur
  if (payload.fabricant && !payload.fournisseur) payload.fournisseur = payload.fabricant;
  if (payload.zone_type) { payload.exterieur = payload.zone_type; payload.interieur = null; }
  return payload;
}
function missingFields(data) {
  const miss = [];
  for (const f of REQUIRED_FIELDS) if (!data[f]) miss.push(f);
  if (!data.identifiant) miss.push('identifiant (vivement recommandé)');
  if (!data.fournisseur) miss.push('fabricant');
  return miss;
}
function parseDateFlexible(v) {
  if (!v) return null;
  const s = String(v).trim();
  let d = null;
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
    const [jj, mm, aa] = s.replace(/\//g, '-').split('-').map(Number);
    d = new Date(aa, mm - 1, jj);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(s);
  } else {
    const t = Date.parse(s);
    if (!isNaN(t)) d = new Date(t);
  }
  return d ? d.toISOString().split('T')[0] : null;
}
function isoOrNull(d) { if (!d) return null; try { return new Date(d).toISOString().split('T')[0]; } catch { return null; } }

function nextFrom(lastISO, freqYears = 3) {
  const base = parseDateFlexible(lastISO) || new Date().toISOString().split('T')[0];
  const d = new Date(base);
  d.setFullYear(d.getFullYear() + (parseInt(freqYears, 10) || 3));
  return d.toISOString().split('T')[0];
}

function calculateMinCategoryFromZone(zone = '22') {
  zone = String(zone);
  if (zone.startsWith('0')) return 'II 1G T135°C';
  if (zone.startsWith('1')) return 'II 2G T135°C';
  if (zone.startsWith('2')) return 'II 3G T135°C';
  if (zone.startsWith('20')) return 'II 1D T135°C';
  if (zone.startsWith('21')) return 'II 2D T135°C';
  return 'II 3D T135°C';
}
function tempClassToMaxC(marquage = '') {
  const m = marquage.match(/T([1-6])/i);
  if (!m) return 135; // défaut
  return { '1':450,'2':300,'3':200,'4':135,'5':100,'6':85 }[m[1]];
}
function catFromMarquage(marquage = '') {
  if (/G[a]/.test(marquage) || /D[a]/.test(marquage)) return 1;
  if (/G[b]/.test(marquage) || /D[b]/.test(marquage)) return 2;
  return 3;
}
function requiredCatFromZone(zone = '22') {
  zone = String(zone);
  if (zone.startsWith('0') || zone.startsWith('20')) return 1;
  if (zone.startsWith('1') || zone.startsWith('21')) return 2;
  return 3;
}
function checkAtexConformity(marquage, categorieMin, zone = '22') {
  if (!marquage || !categorieMin) return 'Non Conforme';
  const catMarq = catFromMarquage(marquage);
  const catMin = parseInt((categorieMin.match(/II (\d)/i) || [])[1] || '3', 10);
  const reqCat = requiredCatFromZone(zone);
  if (catMarq > reqCat || catMarq > catMin) return 'Non Conforme';
  const tMin = parseInt((categorieMin.match(/T(\d+)/i) || [])[1] || '135', 10);
  const tMarq = tempClassToMaxC(marquage);
  if (tMarq < tMin) return 'Non Conforme';
  return 'Conforme';
}
function calculateRisk(zone = '22', conformity = 'Conforme') {
  const z = String(zone);
  const zoneScore = (z.startsWith('0') || z.startsWith('20')) ? 5 : ((z.startsWith('1') || z.startsWith('21')) ? 3 : 1);
  const confScore = conformity !== 'Conforme' ? 2 : 0;
  return Math.min(Math.max(zoneScore + confScore, 0), 5);
}

/* ----------------------- Secteurs ----------------------- */
// GET /api/atex-secteurs
router.get('/atex-secteurs', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(`SELECT id, name FROM atex_secteurs ORDER BY name ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur ATEX secteurs: ' + e.message }); }
});
// POST /api/atex-secteurs  { name }
router.post('/atex-secteurs', async (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom de secteur requis' });
    const r = await query(`INSERT INTO atex_secteurs(name) VALUES ($1) ON CONFLICT(name) DO NOTHING RETURNING *`, [name]);
    res.json(r.rows[0] || { name, created: false });
  } catch (e) { res.status(500).json({ error: 'Erreur création secteur: ' + e.message }); }
});

/* ----------------------- Équipements ----------------------- */
// GET /api/atex-equipments (avec fallback next_inspection_date si null)
router.get('/atex-equipments', async (_req, res) => {
  try {
    let rows = await rowsOrEmpty(`SELECT * FROM atex_equipments ORDER BY id DESC`);
    // Fallback calculé si next_inspection_date est nul mais last_inspection_date présent
    rows = rows.map(r => {
      if (!r.next_inspection_date && r.last_inspection_date) {
        const next = nextFrom(r.last_inspection_date, r.frequence || 3);
        return { ...r, next_inspection_date: next };
      }
      return r;
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur récupération équipements ATEX: ' + e.message }); }
});
// GET /api/atex-equipments/:id
router.get('/atex-equipments/:id', async (req, res) => {
  try {
    const r = await rowsOrEmpty(`SELECT * FROM atex_equipments WHERE id = $1`, [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    const row = r[0];
    if (!row.next_inspection_date && row.last_inspection_date) {
      row.next_inspection_date = nextFrom(row.last_inspection_date, row.frequence || 3);
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Erreur récupération équipement: ' + e.message }); }
});
// GET /api/atex-equipments/:id/photo (base64)
router.get('/atex-equipments/:id/photo', async (req, res) => {
  try {
    const r = await rowsOrEmpty(`SELECT photo FROM atex_equipments WHERE id = $1`, [req.params.id]);
    if (!r.length || !r[0].photo) return res.status(404).json({ error: 'Photo absente' });
    res.json({ photo: r[0].photo });
  } catch (e) { res.status(500).json({ error: 'Erreur récupération photo: ' + e.message }); }
});

// POST /api/atex-photo/:id  (upload multipart -> base64 stocké en DB)
router.post('/atex-photo/:id', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    await query(`UPDATE atex_equipments SET photo=$1 WHERE id=$2`, [b64, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur upload photo: ' + e.message }); }
});

// POST /api/atex-equipments
router.post('/atex-equipments', async (req, res) => {
  try {
    let data = mapAliases(req.body || {});
    const miss = missingFields(data);
    if (miss.length) return res.status(400).json({ error: `Champs obligatoires manquants: ${miss.join(', ')}` });

    const zone = data.zone_type || data.exterieur || data.interieur || '22';
    const categorie_minimum = data.categorie_minimum || calculateMinCategoryFromZone(zone);
    const conformite = checkAtexConformity(data.marquage_atex, categorie_minimum, zone);
    const risque = calculateRisk(zone, conformite);

    const lastInspection = parseDateFlexible(data.last_inspection_date);
    const frequence = parseInt(data.frequence || 3, 10);
    const next = nextFrom(lastInspection, frequence);

    const r = await query(
      `INSERT INTO atex_equipments
       (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, zone_type, categorie_minimum, marquage_atex, photo, conformite,
        comments, grade, frequence, last_inspection_date, next_inspection_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur,
        data.type, data.identifiant, data.interieur || null, data.exterieur || null, zone,
        categorie_minimum, data.marquage_atex, data.photo || null, conformite,
        data.comments || null, data.grade || 'V', frequence, lastInspection, isoOrNull(next)
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.message || '').match(/too large/i)) return res.status(413).json({ error: JSON_LIMIT_ERR });
    res.status(500).json({ error: 'Erreur ajout équipement ATEX: ' + e.message });
  }
});

// PUT /api/atex-equipments/:id
router.put('/atex-equipments/:id', async (req, res) => {
  try {
    let data = mapAliases(req.body || {});
    const miss = missingFields(data).filter(x => x !== 'identifiant (vivement recommandé)');
    if (miss.length) return res.status(400).json({ error: `Champs obligatoires manquants: ${miss.join(', ')}` });

    const zone = data.zone_type || data.exterieur || data.interieur || '22';
    const categorie_minimum = data.categorie_minimum || calculateMinCategoryFromZone(zone);
    const conformite = checkAtexConformity(data.marquage_atex, categorie_minimum, zone);
    const risque = calculateRisk(zone, conformite);

    const lastInspection = parseDateFlexible(data.last_inspection_date);
    const frequence = parseInt(data.frequence || 3, 10);
    const next = nextFrom(lastInspection, frequence);

    const r = await query(
      `UPDATE atex_equipments SET
        risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7,
        identifiant=$8, interieur=$9, exterieur=$10, zone_type=$11, categorie_minimum=$12,
        marquage_atex=$13, photo=$14, conformite=$15, comments=$16, grade=$17, frequence=$18,
        last_inspection_date=$19, next_inspection_date=$20
       WHERE id=$21 RETURNING *`,
      [
        risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur,
        data.type, data.identifiant, data.interieur || null, data.exterieur || null, zone,
        categorie_minimum, data.marquage_atex, data.photo || null, conformite, data.comments || null,
        data.grade || 'V', frequence, lastInspection, isoOrNull(next), req.params.id
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erreur update équipement ATEX: ' + e.message }); }
});

// DELETE /api/atex-equipments/:id
router.delete('/atex-equipments/:id', async (req, res) => {
  try {
    const r = await query(`DELETE FROM atex_equipments WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression équipement ATEX: ' + e.message }); }
});

/* ----------------------- Inspections ----------------------- */
// POST /api/atex-inspect  { equipment_id, status, comment, photo?, inspection_date? }
router.post('/atex-inspect', async (req, res) => {
  try {
    const { equipment_id, status, comment, photo, inspection_date } = req.body || {};
    if (!equipment_id || !status) return res.status(400).json({ error: 'equipment_id et status requis' });

    const dateISO = parseDateFlexible(inspection_date) || new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO atex_inspections (equipment_id, status, comment, photo, inspection_date)
       VALUES ($1,$2,$3,$4,$5)`,
      [equipment_id, status, comment || null, photo || null, dateISO]
    );
    // maj prochaine inspection selon frequence actuelle
    const eq = (await rowsOrEmpty(`SELECT frequence FROM atex_equipments WHERE id=$1`, [equipment_id]))[0];
    const next = nextFrom(dateISO, eq?.frequence || 3);
    await query(
      `UPDATE atex_equipments SET last_inspection_date=$1, next_inspection_date=$2 WHERE id=$3`,
      [dateISO, next, equipment_id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur enregistrement inspection: ' + e.message }); }
});

/* ----------------------- Import / Modèles ----------------------- */
// GET /api/atex-import-columns
router.get('/atex-import-columns', (_req, res) => {
  res.json({
    required: ['secteur','batiment','local','composant','fabricant','type','identifiant','zone_type','marquage_atex'],
    optional: ['comments','last_inspection_date'],
    note: 'zone_type attendu : 0,1,2,20,21,22 (ou texte équivalent), last_inspection_date au format JJ-MM-AAAA ou AAAA-MM-JJ'
  });
});
// GET /api/atex-import-template (CSV)
router.get('/atex-import-template', (_req, res) => {
  const csv =
`secteur,batiment,local,composant,fabricant,type,identifiant,zone_type,marquage_atex,comments,last_inspection_date
Métro,BâtA,L-01,Capteur pression,ACME,REF-123,CPT-0001,21,II 2D T135°C,Premier lot,01-06-2025
`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.csv"');
  res.send(csv);
});
// GET /api/atex-import-template.xlsx (XLSX)
router.get('/atex-import-template.xlsx', (_req, res) => {
  try{
    const wb = XLSX.utils.book_new();
    const data = [
      ['secteur','batiment','local','composant','fabricant','type','identifiant','zone_type','marquage_atex','comments','last_inspection_date'],
      ['Métro','BâtA','L-01','Capteur pression','ACME','REF-123','CPT-0001','21','II 2D T135°C','Premier lot','01-06-2025']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'import');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.xlsx"');
    res.send(buf);
  }catch(e){ res.status(500).json({ error: 'xlsx generation failed', detail: e.message }); }
});

// POST /api/atex-import-excel (form-data: excel=<file>)
router.post('/atex-import-excel', upload.single('excel'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier Excel requis' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const get = (row, keys) => { for (const k of keys) if (row[k] !== undefined) return String(row[k]).trim(); return ''; };

    for (const row of rows) {
      // mapping souple des en-têtes
      let data = {
        secteur:                get(row, ['secteur','Secteur']),
        batiment:               get(row, ['batiment','Bâtiment','Batiment']),
        local:                  get(row, ['local','Local']),
        composant:              get(row, ['composant','Composant']),
        fabricant:              get(row, ['fabricant','Fournisseur']),
        type:                   get(row, ['type','Type']),
        identifiant:            get(row, ['identifiant','Identifiant','ID']),
        zone_type:              get(row, ['zone_type','Type de zone','zone','Zone']),
        marquage_atex:          get(row, ['marquage_atex','Marquage atex','Marquage ATEX']),
        comments:               get(row, ['comments','Commentaires']),
        last_inspection_date:   get(row, ['last_inspection_date','Date dernière inspection','Date de dernière inspection'])
      };
      data = mapAliases(data);

      // Vérif obligatoires pour import (identifiant conseillé, pas bloquant)
      const miss = missingFields(data);
      if (miss.includes('identifiant (vivement recommandé)')) miss.splice(miss.indexOf('identifiant (vivement recommandé)'), 1);
      if (miss.length) continue; // ligne trop incomplète -> on saute

      const zone = data.zone_type || data.exterieur || data.interieur || '22';
      const categorie_minimum = calculateMinCategoryFromZone(zone);
      const conformite = checkAtexConformity(data.marquage_atex, categorie_minimum, zone);
      const risque = calculateRisk(zone, conformite);
      const lastISO = parseDateFlexible(data.last_inspection_date);
      const frequence = 3; // défaut à l’import
      const nextISO = lastISO ? nextFrom(lastISO, frequence) : null;

      await query(
        `INSERT INTO atex_equipments
         (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
          interieur, exterieur, zone_type, categorie_minimum, marquage_atex, conformite, comments,
          last_inspection_date, next_inspection_date, frequence, grade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (identifiant) DO UPDATE SET
           risque=EXCLUDED.risque, secteur=EXCLUDED.secteur, batiment=EXCLUDED.batiment,
           local=EXCLUDED.local, composant=EXCLUDED.composant, fournisseur=EXCLUDED.fournisseur,
           type=EXCLUDED.type, interieur=EXCLUDED.interieur, exterieur=EXCLUDED.exterieur, zone_type=EXCLUDED.zone_type,
           categorie_minimum=EXCLUDED.categorie_minimum, marquage_atex=EXCLUDED.marquage_atex,
           conformite=EXCLUDED.conformite, comments=EXCLUDED.comments, last_inspection_date=EXCLUDED.last_inspection_date,
           next_inspection_date=EXCLUDED.next_inspection_date, frequence=EXCLUDED.frequence`,
        [
          risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur,
          data.type, data.identifiant, null, zone, zone, categorie_minimum, data.marquage_atex,
          conformite, data.comments || null, lastISO, nextISO, frequence, 'V'
        ]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur import Excel: ' + e.message }); }
});

/* ----------------------- Analyses / Risques ----------------------- */
router.get('/atex-risk-global', async (_req, res) => {
  try {
    const stats = (await rowsOrEmpty(
      `SELECT 
         COUNT(*)::int as total_equipements,
         SUM(CASE WHEN conformite = 'Conforme' THEN 1 ELSE 0 END)::int as conformes,
         SUM(CASE WHEN conformite != 'Conforme' THEN 1 ELSE 0 END)::int as non_conformes,
         ROUND(AVG(risque)::numeric, 1) as risque_moyen
       FROM atex_equipments`
    ))[0] || { total_equipements: 0, conformes: 0, non_conformes: 0, risque_moyen: 0 };

    const currentDate = new Date().toISOString().split('T')[0];
    const highRisk = await rowsOrEmpty(
      `SELECT id, composant, risque, next_inspection_date
       FROM atex_equipments
       WHERE risque >= 4 OR (next_inspection_date IS NOT NULL AND next_inspection_date < $1)
       ORDER BY risque DESC NULLS LAST, next_inspection_date ASC NULLS LAST`,
      [currentDate]
    );

    res.json({ stats, highRisk });
  } catch (e) { res.status(500).json({ error: 'Erreur données globales ATEX: ' + e.message }); }
});

router.get('/atex-analysis', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(
      `SELECT id, composant, risque, conformite, next_inspection_date
       FROM atex_equipments ORDER BY risque DESC NULLS LAST`
    );
    const alerts = rows.slice(0, 10).map(r => ({
      text: `Équipement ${r.composant || r.id} — ${r.conformite || 'N/A'} — prochain contrôle ${r.next_inspection_date || 'n/a'}`
    }));
    res.json(alerts);
  } catch (e) { res.status(500).json({ error: 'Erreur analyse ATEX: ' + e.message }); }
});

/* ----------------------- Chat IA & Aide conformité ----------------------- */
router.post('/atex-chat', async (req, res) => {
  try {
    const { question, equipment, history = [] } = req.body || {};
    const sys = { role: 'system', content: 'Tu es **AutonomiX IA**. Tu réponds en français clair et concret. Jamais “développé par OpenAI”.' };

    let userPrompt = question || '';
    if (equipment) {
      userPrompt = `Analyse l'équipement ATEX suivant et propose des corrections concrètes :
Composant: ${equipment.composant}
Risque: ${equipment.risque}
Prochaine inspection: ${equipment.next_inspection_date || 'n/a'}
Réponds en HTML concis (titres + liste).`;
    }
    if (!userPrompt) return res.status(400).json({ error: 'question ou equipment requis' });

    if (!process.env.OPENAI_API_KEY) {
      const html = `<p><strong>Salut, je suis AutonomiX IA.</strong><br>Pas d'accès au moteur IA sur ce déploiement (clé manquante). 
      Donne quand même des détails et je t’indiquerai la démarche côté terrain.</p>`;
      return res.json({ response: html, offline: true });
    }

    const messages = [sys, ...history, { role: 'user', content: userPrompt }];
    const resp = await openai.chat.completions.create({ model: 'gpt-4o', messages });
    const html = resp.choices?.[0]?.message?.content || 'Réponse indisponible pour le moment.';
    res.json({ response: html });
  } catch (e) { res.status(500).json({ error: 'Erreur chat IA: ' + e.message }); }
});

router.get('/atex-help/:id', async (req, res) => {
  try {
    const eq = (await rowsOrEmpty(`SELECT * FROM atex_equipments WHERE id=$1`, [req.params.id]))[0];
    if (!eq) return res.status(404).json({ error: 'Équipement non trouvé' });

    const question = `Un utilisateur demande de corriger une non-conformité ATEX.
Données: composant=${eq.composant}, marquage=${eq.marquage_atex}, zone=${eq.zone_type || eq.exterieur || eq.interieur || '22'}, conformité=${eq.conformite}.
Donne 3 étapes terrain, 3 contrôles à faire, et une suggestion de marquage/type compatible.
Réponds en HTML, 150-220 mots max.`;

    if (!process.env.OPENAI_API_KEY) {
      return res.json({ response: `<p><strong>AutonomiX IA</strong> — Sans moteur IA ici. Vérifier le marquage vs zone (${eq.zone_type || '22'}), 
      contrôler la classe T et la catégorie (1/2/3). Si “Non Conforme”, remplacer par un appareil certifié (p.ex. II 2G T4 pour zone 1 gaz).</p>` });
    }

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Tu es AutonomiX IA. Réponds en HTML concis.' },
        { role: 'user', content: question }
      ]
    });
    res.json({ response: resp.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ error: 'Erreur aide conformité: ' + e.message }); }
});

module.exports = router;
