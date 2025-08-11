// routes/atex.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const multer = require('multer');
const upload = multer();
const XLSX = require('xlsx');
const { openai } = require('../config/openai');

/* ----------------------- Helpers DB sûrs ----------------------- */
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(sql, params);
    return r;
  } finally {
    client.release();
  }
}
async function rowsOrEmpty(sql, params = []) {
  try {
    const r = await query(sql, params);
    return r.rows;
  } catch (e) {
    // si la table n'existe pas (42P01), on renvoie un tableau vide pour ne pas casser le front
    if (e && (e.code === '42P01' || /relation .* does not exist/i.test(e.message))) return [];
    throw e;
  }
}

/* ----------------------- Secteurs ----------------------- */
// GET /api/atex-secteurs
router.get('/atex-secteurs', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(
      `SELECT id, name FROM atex_secteurs ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur ATEX secteurs: ' + e.message });
  }
});

/* ----------------------- Équipements ----------------------- */
// GET /api/atex-equipments
router.get('/atex-equipments', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(`SELECT * FROM atex_equipments ORDER BY id DESC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération équipements ATEX: ' + e.message });
  }
});

// GET /api/atex-equipments/:id
router.get('/atex-equipments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await rowsOrEmpty(`SELECT * FROM atex_equipments WHERE id = $1`, [id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json(r[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération équipement: ' + e.message });
  }
});

// POST /api/atex-equipments
router.post('/atex-equipments', async (req, res) => {
  const data = req.body || {};
  try {
    function calculateMinCategory(zoneExt = '', zoneInt = '') {
      const zone = zoneExt || zoneInt || '22';
      if (zone.startsWith('0')) return 'II 1G IIIB T135°C';
      if (zone.startsWith('1')) return 'II 2G IIIB T135°C';
      if (zone.startsWith('2')) return 'II 3G IIIB T135°C';
      if (zone.startsWith('20')) return 'II 1D IIIB T135°C';
      if (zone.startsWith('21')) return 'II 2D IIIB T135°C';
      return 'II 3D IIIB T135°C';
    }
    function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
      if (!marquage || !categorieMin) return 'Non Conforme';
      let catMarq = 3, tMarq = 135;
      const m = marquage.match(/T(\d)/i);
      if (m) {
        const tMap = { '1': 450, '2': 300, '3': 200, '4': 135, '5': 100, '6': 85 };
        tMarq = tMap[m[1]] || 135;
      }
      if (marquage.includes('Ga')) catMarq = 1;
      else if (marquage.includes('Gb')) catMarq = 2;
      else if (marquage.includes('Gc')) catMarq = 3;
      const minM = categorieMin.match(/II (\d)/i);
      const catMin = minM ? parseInt(minM[1]) : 3;

      const zone = zoneExt || zoneInt || '22';
      const requiredCat = (zone.startsWith('0') || zone.startsWith('20')) ? 1 :
                          ((zone.startsWith('1') || zone.startsWith('21')) ? 2 : 3);

      if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';
      const minT = (categorieMin.match(/T(\d+)/i) || [])[1];
      const tMin = minT ? parseInt(minT) : 135;
      if (tMarq < tMin) return 'Non Conforme';
      return 'Conforme';
    }
    function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
      const zone = zoneExt || zoneInt || '22';
      const zoneScore = (zone.startsWith('0') || zone.startsWith('20')) ? 5 :
                        ((zone.startsWith('1') || zone.startsWith('21')) ? 3 : 1);
      const confScore = conformity !== 'Conforme' ? 2 : 0;
      return Math.min(Math.max(zoneScore + confScore, 0), 5);
    }

    data.categorie_minimum = data.categorie_minimum || calculateMinCategory(data.exterieur, data.interieur);
    data.conformite = checkAtexConformity(data.marquage_atex, data.categorie_minimum, data.exterieur, data.interieur);
    data.risque = calculateRisk(data.exterieur, data.interieur, data.conformite);

    const r = await query(
      `INSERT INTO atex_equipments
       (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite,
        comments, grade, frequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        data.risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur,
        data.type, data.identifiant, data.interieur, data.exterieur, data.categorie_minimum,
        data.marquage_atex, data.photo, data.conformite, data.comments, data.grade || 'V',
        data.frequence || 3
      ]
    );

    // calcule next_inspection_date
    const next = new Date();
    next.setFullYear(next.getFullYear() + (data.frequence || 3));
    await query(
      `UPDATE atex_equipments SET next_inspection_date = $1 WHERE id = $2`,
      [next.toISOString().split('T')[0], r.rows[0].id]
    );

    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur ajout équipement ATEX: ' + e.message });
  }
});

// PUT /api/atex-equipments/:id
router.put('/atex-equipments/:id', async (req, res) => {
  const { id } = req.params;
  const data = req.body || {};
  try {
    function calculateMinCategory(zoneExt = '', zoneInt = '') {
      const zone = zoneExt || zoneInt || '22';
      if (zone.startsWith('0')) return 'II 1G IIIB T135°C';
      if (zone.startsWith('1')) return 'II 2G IIIB T135°C';
      if (zone.startsWith('2')) return 'II 3G IIIB T135°C';
      if (zone.startsWith('20')) return 'II 1D IIIB T135°C';
      if (zone.startsWith('21')) return 'II 2D IIIB T135°C';
      return 'II 3D IIIB T135°C';
    }
    function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
      if (!marquage || !categorieMin) return 'Non Conforme';
      let catMarq = 3, tMarq = 135;
      if (marquage.includes('Ga')) catMarq = 1;
      else if (marquage.includes('Gb')) catMarq = 2;
      else if (marquage.includes('Gc')) catMarq = 3;
      if (marquage.includes('T1')) tMarq = 450;
      else if (marquage.includes('T2')) tMarq = 300;
      else if (marquage.includes('T3')) tMarq = 200;
      else if (marquage.includes('T4')) tMarq = 135;
      else if (marquage.includes('T5')) tMarq = 100;
      else if (marquage.includes('T6')) tMarq = 85;

      const minM = categorieMin.match(/II (\d)/i);
      const catMin = minM ? parseInt(minM[1]) : 3;
      const zone = zoneExt || zoneInt || '22';
      const requiredCat = (zone.startsWith('0') || zone.startsWith('20')) ? 1 :
                          ((zone.startsWith('1') || zone.startsWith('21')) ? 2 : 3);
      if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';

      const tMin = parseInt((categorieMin.match(/T(\d+)/i) || [])[1] || 135);
      if (tMarq < tMin) return 'Non Conforme';
      return 'Conforme';
    }
    function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
      const zone = zoneExt || zoneInt || '22';
      const zoneScore = (zone.startsWith('0') || zone.startsWith('20')) ? 5 :
                        ((zone.startsWith('1') || zone.startsWith('21')) ? 3 : 1);
      const confScore = conformity !== 'Conforme' ? 2 : 0;
      return Math.min(Math.max(zoneScore + confScore, 0), 5);
    }

    data.categorie_minimum = data.categorie_minimum || calculateMinCategory(data.exterieur, data.interieur);
    data.conformite = checkAtexConformity(data.marquage_atex, data.categorie_minimum, data.exterieur, data.interieur);
    data.risque = calculateRisk(data.exterieur, data.interieur, data.conformite);

    const r = await query(
      `UPDATE atex_equipments SET
        risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7,
        identifiant=$8, interieur=$9, exterieur=$10, categorie_minimum=$11, marquage_atex=$12,
        photo=$13, conformite=$14, comments=$15, grade=$16, frequence=$17
       WHERE id=$18 RETURNING *`,
      [
        data.risque, data.secteur, data.batiment, data.local, data.composant, data.fournisseur,
        data.type, data.identifiant, data.interieur, data.exterieur, data.categorie_minimum,
        data.marquage_atex, data.photo, data.conformite, data.comments, data.grade || 'V',
        data.frequence || 3, id
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur update équipement ATEX: ' + e.message });
  }
});

// DELETE /api/atex-equipments/:id
router.delete('/atex-equipments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await query(`DELETE FROM atex_equipments WHERE id = $1 RETURNING *`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression équipement ATEX: ' + e.message });
  }
});

/* ----------------------- Inspections ----------------------- */
// POST /api/atex-inspect
router.post('/atex-inspect', async (req, res) => {
  const { equipment_id, status, comment, photo, inspection_date } = req.body || {};
  try {
    await query(
      `INSERT INTO atex_inspections (equipment_id, status, comment, photo, inspection_date)
       VALUES ($1,$2,$3,$4,$5)`,
      [equipment_id, status, comment, photo, inspection_date]
    );
    const next = inspection_date ? new Date(inspection_date) : new Date();
    next.setFullYear(next.getFullYear() + 3);
    await query(
      `UPDATE atex_equipments
       SET last_inspection_date=$1, next_inspection_date=$2
       WHERE id = $3`,
      [
        inspection_date || new Date().toISOString().split('T')[0],
        next.toISOString().split('T')[0],
        equipment_id
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur enregistrement inspection: ' + e.message });
  }
});

/* ----------------------- Import Excel ----------------------- */
// POST /api/atex-import-excel (form-data: excel=<file>)
router.post('/atex-import-excel', upload.single('excel'), async (req, res) => {
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(1);

    function calculateMinCategory(zoneExt = '', zoneInt = '') {
      const zone = zoneExt || zoneInt || '22';
      if (zone.startsWith('0')) return 'II 1G IIIB T135°C';
      if (zone.startsWith('1')) return 'II 2G IIIB T135°C';
      if (zone.startsWith('2')) return 'II 3G IIIB T135°C';
      if (zone.startsWith('20')) return 'II 1D IIIB T135°C';
      if (zone.startsWith('21')) return 'II 2D IIIB T135°C';
      return 'II 3D IIIB T135°C';
    }
    function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
      if (!marquage || !categorieMin) return 'Non Conforme';
      let catMarq = 3, tMarq = 135;
      if (marquage.includes('Ga')) catMarq = 1;
      else if (marquage.includes('Gb')) catMarq = 2;
      else if (marquage.includes('Gc')) catMarq = 3;
      if (marquage.includes('T1')) tMarq = 450;
      else if (marquage.includes('T2')) tMarq = 300;
      else if (marquage.includes('T3')) tMarq = 200;
      else if (marquage.includes('T4')) tMarq = 135;
      else if (marquage.includes('T5')) tMarq = 100;
      else if (marquage.includes('T6')) tMarq = 85;

      const minM = categorieMin.match(/II (\d)/i);
      const catMin = minM ? parseInt(minM[1]) : 3;
      const zone = zoneExt || zoneInt || '22';
      const requiredCat = (zone.startsWith('0') || zone.startsWith('20')) ? 1 :
                          ((zone.startsWith('1') || zone.startsWith('21')) ? 2 : 3);
      if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';

      const tMin = parseInt((categorieMin.match(/T(\d+)/i) || [])[1] || 135);
      if (tMarq < tMin) return 'Non Conforme';
      return 'Conforme';
    }
    function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
      const zone = zoneExt || zoneInt || '22';
      const zoneScore = (zone.startsWith('0') || zone.startsWith('20')) ? 5 :
                        ((zone.startsWith('1') || zone.startsWith('21')) ? 3 : 1);
      const confScore = conformity !== 'Conforme' ? 2 : 0;
      return Math.min(Math.max(zoneScore + confScore, 0), 5);
    }

    for (const row of rows) {
      if (row.length < 15) continue;
      let [
        risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, , conformite, comments
      ] = row;
      let last_inspection_date = row.length > 15 ? row[15] : null;

      categorie_minimum = categorie_minimum || calculateMinCategory(exterieur, interieur);
      conformite = checkAtexConformity(marquage_atex, categorie_minimum, exterieur, interieur);
      risque = calculateRisk(exterieur, interieur, conformite);

      await query(
        `INSERT INTO atex_equipments
        (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
         interieur, exterieur, categorie_minimum, marquage_atex, conformite, comments, last_inspection_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (identifiant) DO UPDATE SET
           risque=EXCLUDED.risque, secteur=EXCLUDED.secteur, batiment=EXCLUDED.batiment,
           local=EXCLUDED.local, composant=EXCLUDED.composant, fournisseur=EXCLUDED.fournisseur,
           type=EXCLUDED.type, interieur=EXCLUDED.interieur, exterieur=EXCLUDED.exterieur,
           categorie_minimum=EXCLUDED.categorie_minimum, marquage_atex=EXCLUDED.marquage_atex,
           conformite=EXCLUDED.conformite, comments=EXCLUDED.comments, last_inspection_date=EXCLUDED.last_inspection_date`,
        [
          risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
          interieur, exterieur, categorie_minimum, marquage_atex, conformite, comments, last_inspection_date
        ]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur import Excel: ' + e.message });
  }
});

/* ----------------------- Analyses / Risques ----------------------- */
// GET /api/atex-risk-global
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
  } catch (e) {
    res.status(500).json({ error: 'Erreur données globales ATEX: ' + e.message });
  }
});

// GET /api/atex-analysis (format léger pour ta page)
router.get('/atex-analysis', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(
      `SELECT id, composant, risque, conformite, next_inspection_date
       FROM atex_equipments
       ORDER BY risque DESC NULLS LAST`
    );
    const alerts = rows.slice(0, 10).map(r => ({
      text: `Équipement ${r.composant || r.id} — ${r.conformite || 'N/A'} — prochain contrôle ${r.next_inspection_date || 'n/a'}`
    }));
    res.json(alerts);
  } catch (e) {
    res.status(500).json({ error: 'Erreur analyse ATEX: ' + e.message });
  }
});

// POST /api/atex-analysis (optionnel, version JSON détaillée)
router.post('/atex-analysis', async (req, res) => {
  const { secteurId, equipmentIds } = req.body || {};
  try {
    let equipements = [];
    if (Array.isArray(equipmentIds) && equipmentIds.length) {
      const placeholders = equipmentIds.map((_, i) => `$${i + 1}`).join(',');
      equipements = await rowsOrEmpty(
        `SELECT id, composant, risque, conformite, next_inspection_date
         FROM atex_equipments WHERE id IN (${placeholders})`,
        equipmentIds
      );
    }
    const alerts = equipements.map(e => ({
      text: `Analyse ${e.composant || e.id} — ${e.conformite || 'n/a'}`
    }));
    res.json({ summary: { secteurId: secteurId || null, count: equipements.length }, alerts, equipements });
  } catch (e) {
    res.status(500).json({ error: 'Erreur analyse ATEX: ' + e.message });
  }
});

/* ----------------------- Chat IA ----------------------- */
// POST /api/atex-chat  { question?, equipment?, history? }
router.post('/atex-chat', async (req, res) => {
  const { question, equipment, history = [] } = req.body || {};
  try {
    const messages = history.map(m => ({ role: m.role, content: m.content }));
    let prompt = question || '';
    if (equipment) {
      prompt = `Analyse équipement ATEX: composant=${equipment.composant}, risque=${equipment.risque}, prochaine_inspection=${equipment.next_inspection_date || 'n/a'}
Retourne un JSON: {analysis: string, corrections: string[], links: string[], cost_estimate: string}`;
    }
    if (!prompt) return res.status(400).json({ error: 'question ou equipment requis' });
    messages.push({ role: 'user', content: prompt });

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: { type: 'json_object' }
    });
    const data = JSON.parse(resp.choices[0].message.content);
    res.json({ response: data });
  } catch (e) {
    res.status(500).json({ error: 'Erreur chat IA: ' + e.message });
  }
});

module.exports = router;
