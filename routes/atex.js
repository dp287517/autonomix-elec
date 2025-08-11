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

// POST /api/atex-secteurs  { name }
router.post('/atex-secteurs', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom de secteur requis' });
  try {
    const r = await query(
      `INSERT INTO atex_secteurs (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur création secteur: ' + e.message });
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

function calculateMinCategory(zoneExt = '', zoneInt = '') {
  const zone = String(zoneExt || zoneInt || '22');
  if (zone.startsWith('0'))  return 'II 1G IIIB T135°C';
  if (zone.startsWith('1'))  return 'II 2G IIIB T135°C';
  if (zone.startsWith('2'))  return 'II 3G IIIB T135°C';
  if (zone.startsWith('20')) return 'II 1D IIIB T135°C';
  if (zone.startsWith('21')) return 'II 2D IIIB T135°C';
  return 'II 3D IIIB T135°C';
}
function parseTClass(marquage) {
  // Retourne la T max autorisée du marquage (ex: T4 => 135)
  const m = /T([1-6])/i.exec(marquage || '');
  const map = { '1': 450, '2': 300, '3': 200, '4': 135, '5': 100, '6': 85 };
  return m ? (map[m[1]] || 135) : 135;
}
function parseCat(marquage) {
  // Ga/Gb/Gc -> 1/2/3
  const s = String(marquage || '');
  if (/Ga\b/.test(s)) return 1;
  if (/Gb\b/.test(s)) return 2;
  return 3; // Gc ou inconnu
}
function checkAtexConformity(marquage, categorieMin, zoneExt = '', zoneInt = '') {
  if (!marquage || !categorieMin) return 'Non Conforme';
  const catMarq = parseCat(marquage);
  const tMarq  = parseTClass(marquage);

  const m = /II\s+(\d)/i.exec(categorieMin || '');
  const catMin = m ? parseInt(m[1], 10) : 3;

  const zone = String(zoneExt || zoneInt || '22');
  const requiredCat = (zone.startsWith('0') || zone.startsWith('20')) ? 1 :
                      ((zone.startsWith('1') || zone.startsWith('21')) ? 2 : 3);

  if (catMarq > requiredCat || catMarq > catMin) return 'Non Conforme';

  const tMinMatch = /T(\d+)/i.exec(categorieMin || '');
  const tMin = tMinMatch ? parseInt(tMinMatch[1], 10) : 135;
  if (tMarq < tMin) return 'Non Conforme';

  return 'Conforme';
}
function calculateRisk(zoneExt = '', zoneInt = '', conformity) {
  const zone = String(zoneExt || zoneInt || '22');
  const zoneScore = (zone.startsWith('0') || zone.startsWith('20')) ? 5 :
                    ((zone.startsWith('1') || zone.startsWith('21')) ? 3 : 1);
  const confScore = conformity !== 'Conforme' ? 2 : 0;
  return Math.min(Math.max(zoneScore + confScore, 0), 5);
}

// POST /api/atex-equipments
router.post('/atex-equipments', async (req, res) => {
  const data = req.body || {};
  try {
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

/* ----------------------- Chat IA (robuste) ----------------------- */
// POST /api/atex-chat  { question?, equipment?, history? }
router.post('/atex-chat', async (req, res) => {
  const { question, equipment, history = [] } = req.body || {};
  try {
    let messages = Array.isArray(history)
      ? history.map(m => ({ role: m.role || 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
      : [];

    let prompt = question || '';
    let wantsJSON = false;

    if (equipment) {
      wantsJSON = true;
      prompt = `Analyse équipement ATEX:
- composant: ${equipment.composant}
- risque: ${equipment.risque}
- prochaine_inspection: ${equipment.next_inspection_date || 'n/a'}

Retourne un JSON strict avec les clés exactement:
{
  "analysis": string,
  "corrections": string[],
  "links": string[],
  "cost_estimate": string
}`;
    }

    if (!prompt) return res.status(400).json({ error: 'question ou equipment requis' });

    messages.push({ role: 'user', content: prompt });

    // Sécurité si pas de clé => réponse de secours
    if (!process.env.OPENAI_API_KEY) {
      const fallback = wantsJSON
        ? {
            analysis: "Mode secours (clé OpenAI absente). Vérifiez la configuration serveur.",
            corrections: ["Vérifier le marquage ATEX sur la plaque signalétique", "Planifier une inspection de conformité"],
            links: [],
            cost_estimate: "N/A"
          }
        : "Mode secours (clé OpenAI absente). Vérifiez la configuration serveur.";
      return res.json({
        response: wantsJSON ? JSON.stringify(fallback, null, 2) : String(fallback),
        answer: wantsJSON ? "Analyse structurée (secours) générée." : String(fallback),
        raw: wantsJSON ? fallback : { message: String(fallback) }
      });
    }

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      // si on veut garantir du JSON pour le mode "equipment"
      ...(wantsJSON ? { response_format: { type: 'json_object' } } : {})
    });

    const content = resp?.choices?.[0]?.message?.content ?? '';
    let responseString = content;
    let answerString = content;
    let rawObj = null;

    if (wantsJSON) {
      try {
        rawObj = JSON.parse(content);
        // on renvoie une string utilisable directement par l’UI
        responseString = JSON.stringify(rawObj, null, 2);
        // et une version courte lisible
        answerString =
          `Analyse: ${rawObj.analysis || '—'}\n` +
          (Array.isArray(rawObj.corrections) && rawObj.corrections.length
            ? `Corrections:\n- ${rawObj.corrections.join('\n- ')}\n` : '') +
          (Array.isArray(rawObj.links) && rawObj.links.length
            ? `Liens:\n- ${rawObj.links.join('\n- ')}\n` : '') +
          (rawObj.cost_estimate ? `Coût estimé: ${rawObj.cost_estimate}` : '');
      } catch {
        // si ce n’est pas un JSON valide, on renvoie brut
        rawObj = { error: 'Réponse non JSON', content };
      }
    }

    res.json({
      response: responseString,  // toujours une STRING exploitable par innerHTML/textContent
      answer: answerString,      // version lisible courte
      raw: rawObj ?? { content } // pour debug côté front si besoin
    });
  } catch (e) {
    console.error('[ATEX-CHAT] error:', e);
    // On renvoie 200 avec une réponse “secours” pour éviter le popup 500 côté front
    return res.json({
      response: 'Impossible de répondre pour le moment. Détail serveur: ' + (e?.message || e),
      answer: 'Erreur côté serveur (voir logs).',
      raw: { error: String(e?.stack || e) }
    });
  }
});

module.exports = router;
