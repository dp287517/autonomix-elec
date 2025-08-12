/** routes/atex.js
 * Routeur ATEX — Express
 * Compatible avec ton front (atex-control.html) et tes endpoints existants.
 * - /api/atex-secteurs
 * - /api/atex-equipments, /api/atex-equipments/:id
 * - /api/atex-inspect
 * - /api/atex-import-columns, /api/atex-import-template, /api/atex-import-template.xlsx, /api/atex-import-excel
 * - /api/atex-help/:id, /api/atex-chat
 * - /api/atex-photo/:id
 */
const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer(); // pour XLSX + photos multipart
const XLSX = require('xlsx');

const { pool } = require('../config/db');
let openai = null;
try {
  // optionnel si pas d'OpenAI
  ({ openai } = require('../config/openai'));
} catch { /* no-op */ }

/* ----------------------- Helpers DB ----------------------- */
async function q(sql, params = []) {
  const c = await pool.connect();
  try {
    const r = await c.query(sql, params);
    return r;
  } finally {
    c.release();
  }
}
async function rows(sql, params = []) {
  try {
    const r = await q(sql, params);
    return r.rows;
  } catch (e) {
    // table absente → retourne vide (évite de crasher au boot initial)
    if (e && (e.code === '42P01' || /relation .* does not exist/i.test(e.message))) return [];
    throw e;
  }
}

/* ----------------------- Helpers ATEX ----------------------- */
// Normalisation zones côté back (compatibilité avec ton front)
function pickZones(exterieur, interieur) {
  const zg = (interieur !== null && interieur !== undefined) ? String(interieur) : null; // Gaz: 0/1/2
  const zd = (exterieur !== null && exterieur !== undefined) ? String(exterieur) : null; // Poussières: 20/21/22
  const zgOk = ['0','1','2'].includes(zg || '');
  const zdOk = ['20','21','22'].includes(zd || '');
  return { zg: zgOk ? zg : null, zd: zdOk ? zd : null };
}
function worstZone(zg, zd) {
  // Renvoie la zone la plus sévère pour un indicateur unique si besoin
  if (zg === '0' || zd === '20') return '0/20';
  if (zg === '1' || zd === '21') return '1/21';
  if (zg === '2' || zd === '22') return '2/22';
  return '';
}
function calculateMinCategory(zg, zd) {
  // Catégorie minimale “large” – on croise G/D en restant conservateur
  // (on laisse IIIB/T135°C pour simplifier comme ta version précédente)
  if (zg === '0' || zd === '20') return 'II 1GD IIIB T135°C';
  if (zg === '1' || zd === '21') return 'II 2GD IIIB T135°C';
  return 'II 3GD IIIB T135°C';
}
function checkDualConformity(marquage, zg, zd) {
  // Vérifie marquage globalement (présence G/D, catégorie, classe T)
  if (!marquage || (!zg && !zd)) return 'Non Conforme';

  // Catégorie par défaut (3), ajustée si Ga/Gb/Gc détecté
  let catMarq = 3;
  if (marquage.includes('Ga')) catMarq = 1;
  else if (marquage.includes('Gb')) catMarq = 2;
  else if (marquage.includes('Gc')) catMarq = 3;

  // Classe T
  let tMarq = 135;
  if (marquage.includes('T1')) tMarq = 450;
  else if (marquage.includes('T2')) tMarq = 300;
  else if (marquage.includes('T3')) tMarq = 200;
  else if (marquage.includes('T4')) tMarq = 135;
  else if (marquage.includes('T5')) tMarq = 100;
  else if (marquage.includes('T6')) tMarq = 85;

  // Catégorie requise en fonction des zones présentes
  const need1 = (zg === '0') || (zd === '20');
  const need2 = (zg === '1') || (zd === '21');
  const requiredCat = need1 ? 1 : (need2 ? 2 : 3);

  if (catMarq > requiredCat) return 'Non Conforme';

  // T° mini (on prend 135°C si absent)
  const tMin = 135;
  if (tMarq < tMin) return 'Non Conforme';

  // Vérification “GD” si libellé 2GD/3GD présent
  // (optionnel ici — de nombreuses variantes existent)
  return 'Conforme';
}
function riskFromDual(zg, zd, conformite) {
  let score = 1;
  if (zg === '0' || zd === '20') score = 5;
  else if (zg === '1' || zd === '21') score = 3;
  else score = 1;
  if (conformite !== 'Conforme') score += 2;
  if (score > 5) score = 5;
  return score;
}
function addYearsISO(isoDate, years) {
  const d = isoDate ? new Date(isoDate) : new Date();
  if (Number.isNaN(d)) return null;
  d.setFullYear(d.getFullYear() + (years || 3));
  return d.toISOString().split('T')[0];
}

/* ----------------------- SECTEURS ----------------------- */
router.get('/atex-secteurs', async (_req, res) => {
  try {
    const r = await rows('SELECT id, name FROM atex_secteurs ORDER BY name ASC');
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Erreur ATEX secteurs: ' + e.message });
  }
});

/* ----------------------- EQUIPEMENTS ----------------------- */
router.get('/atex-equipments', async (_req, res) => {
  try {
    const r = await rows('SELECT * FROM atex_equipments ORDER BY id DESC');
    // Fallback soft : calcule next_inspection_date si absente mais last_inspection_date présente
    for (const it of r) {
      if (!it.next_inspection_date && it.last_inspection_date) {
        const next = addYearsISO(it.last_inspection_date, it.frequence || 3);
        it.next_inspection_date = next;
      }
      // zone_type (affichage) = pire zone
      const z = pickZones(it.exterieur, it.interieur);
      it.zone_type = worstZone(z.zg, z.zd);
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération équipements: ' + e.message });
  }
});

router.get('/atex-equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await rows('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    const it = r[0];
    if (!it.next_inspection_date && it.last_inspection_date) {
      it.next_inspection_date = addYearsISO(it.last_inspection_date, it.frequence || 3);
    }
    const z = pickZones(it.exterieur, it.interieur);
    it.zone_type = worstZone(z.zg, z.zd);
    res.json(it);
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération équipement: ' + e.message });
  }
});

router.post('/atex-equipments', async (req, res) => {
  try {
    const d = req.body || {};
    const z = pickZones(d.exterieur, d.interieur);
    const catMin = calculateMinCategory(z.zg, z.zd);
    const conf = checkDualConformity(d.marquage_atex, z.zg, z.zd);
    const risk = riskFromDual(z.zg, z.zd, conf);

    const r = await q(
      'INSERT INTO atex_equipments ' +
      '(risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments, last_inspection_date, next_inspection_date, grade, frequence) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *',
      [
        risk, d.secteur, d.batiment, d.local, d.composant, d.fournisseur, d.type, d.identifiant,
        d.interieur, d.exterieur, catMin, d.marquage_atex, d.photo || null, conf, d.comments || null,
        d.last_inspection_date || null,
        d.next_inspection_date || addYearsISO(d.last_inspection_date, d.frequence || 3),
        d.grade || 'V', d.frequence || 3
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur ajout équipement: ' + e.message });
  }
});

router.put('/atex-equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const d = req.body || {};
    const z = pickZones(d.exterieur, d.interieur);
    const catMin = calculateMinCategory(z.zg, z.zd);
    const conf = checkDualConformity(d.marquage_atex, z.zg, z.zd);
    const risk = riskFromDual(z.zg, z.zd, conf);

    const r = await q(
      'UPDATE atex_equipments SET ' +
      'risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7, identifiant=$8, ' +
      'interieur=$9, exterieur=$10, categorie_minimum=$11, marquage_atex=$12, photo=$13, conformite=$14, comments=$15, ' +
      'last_inspection_date=$16, next_inspection_date=$17, grade=$18, frequence=$19 ' +
      'WHERE id=$20 RETURNING *',
      [
        risk, d.secteur, d.batiment, d.local, d.composant, d.fournisseur, d.type, d.identifiant,
        d.interieur, d.exterieur, catMin, d.marquage_atex, d.photo || null, conf, d.comments || null,
        d.last_inspection_date || null,
        (d.next_inspection_date || null), // ne pas forcer au PUT pour éviter d’écraser si géré côté front
        d.grade || 'V', d.frequence || 3,
        id
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur update équipement: ' + e.message });
  }
});

router.delete('/atex-equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await q('DELETE FROM atex_equipments WHERE id=$1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression équipement: ' + e.message });
  }
});

/* ----------------------- INSPECTION ----------------------- */
router.post('/atex-inspect', async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.equipment_id;
    const date = b.inspection_date || new Date().toISOString().split('T')[0];
    await q(
      'INSERT INTO atex_inspections (equipment_id, status, comment, photo, inspection_date) VALUES ($1,$2,$3,$4,$5)',
      [id, b.status || 'done', b.comment || null, b.photo || null, date]
    );
    // met à jour l’équipement (+ frequence)
    const r = await rows('SELECT frequence FROM atex_equipments WHERE id=$1', [id]);
    const freq = r.length ? (r[0].frequence || 3) : 3;
    const next = addYearsISO(date, freq);
    await q('UPDATE atex_equipments SET last_inspection_date=$1, next_inspection_date=$2 WHERE id=$3', [date, next, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur inspection: ' + e.message });
  }
});

/* ----------------------- IMPORT / EXPORT ----------------------- */
router.get('/atex-import-columns', (_req, res) => {
  res.json({
    required: [
      'secteur','batiment','local','composant','fournisseur','type','identifiant',
      'zone_gaz','zone_poussieres','marquage_atex'
    ],
    optional: ['comments','last_inspection_date','frequence','photo']
  });
});

router.get('/atex-import-template', (_req, res) => {
  const lines = [
    ['secteur','batiment','local','composant','fournisseur','type','identifiant','zone_gaz','zone_poussieres','marquage_atex','comments','last_inspection_date'],
    ['Maintenance','B02','800','Clapet','Siemens','wer45t','12343','2','21','II 2GD T135°C','Exemple','2025-08-01']
  ];
  const csv = lines.map(a => a.map(x => (x == null ? '' : String(x).replace(/"/g,'""'))).map(x => `"${x}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.csv"');
  res.send(csv);
});

router.get('/atex-import-template.xlsx', (_req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const data = [
      ['secteur','batiment','local','composant','fournisseur','type','identifiant','zone_gaz','zone_poussieres','marquage_atex','comments','last_inspection_date'],
      ['Maintenance','B02','800','Clapet','Siemens','wer45t','12343','2','21','II 2GD T135°C','Exemple','2025-08-01']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'import');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.xlsx"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'xlsx generation failed', detail: e.message });
  }
});

router.post('/atex-import-excel', upload.single('excel'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Fichier manquant' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const rowsA = arr.slice(1); // on saute l’entête

    for (const r of rowsA) {
      if (!r || !r.length) continue;
      const secteur = r[0] || null;
      const batiment = r[1] || null;
      const local = r[2] || null;
      const composant = r[3] || null;
      const fournisseur = r[4] || null;
      const type = r[5] || null;
      const identifiant = r[6] || null;
      const zg = r[7] != null ? String(r[7]) : null;
      const zd = r[8] != null ? String(r[8]) : null;
      const marquage = r[9] || null;
      const comments = r[10] || null;
      const last = r[11] || null;

      const cat = calculateMinCategory(zg, zd);
      const conf = checkDualConformity(marquage, zg, zd);
      const risk = riskFromDual(zg, zd, conf);
      const next = last ? addYearsISO(last, 3) : null;

      await q(
        'INSERT INTO atex_equipments ' +
        '(risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments, last_inspection_date, next_inspection_date, grade, frequence) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ' +
        'ON CONFLICT (identifiant) DO UPDATE SET ' +
        'risque=EXCLUDED.risque, secteur=EXCLUDED.secteur, batiment=EXCLUDED.batiment, local=EXCLUDED.local, ' +
        'composant=EXCLUDED.composant, fournisseur=EXCLUDED.fournisseur, type=EXCLUDED.type, ' +
        'interieur=EXCLUDED.interieur, exterieur=EXCLUDED.exterieur, categorie_minimum=EXCLUDED.categorie_minimum, ' +
        'marquage_atex=EXCLUDED.marquage_atex, photo=EXCLUDED.photo, conformite=EXCLUDED.conformite, ' +
        'comments=EXCLUDED.comments, last_inspection_date=EXCLUDED.last_inspection_date, next_inspection_date=EXCLUDED.next_inspection_date',
        [
          risk, secteur, batiment, local, composant, fournisseur, type, identifiant,
          zg, zd, cat, marquage, null, conf, comments, last, next, 'V', 3
        ]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur import Excel: ' + e.message });
  }
});

/* ----------------------- IA / Aide ----------------------- */
router.get('/atex-help/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await rows('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    const eq = r[0];
    const z = pickZones(eq.exterieur, eq.interieur);

    const userPrompt =
      'Corriger une non-conformité ATEX.\n' +
      'Données: composant=' + (eq.composant || '') +
      ', marquage=' + (eq.marquage_atex || '') +
      ', zones: G=' + (z.zg || '-') + ' / D=' + (z.zd || '-') +
      ', conformité=' + (eq.conformite || 'N/A') + '.\n' +
      'Donne 3 étapes terrain, 3 contrôles, et une suggestion de marquage/type compatible (en HTML 150-220 mots).';

    if (!openai || !process.env.OPENAI_API_KEY) {
      return res.json({
        response: '<p><strong>AutonomiX IA</strong> — Moteur IA indisponible. ' +
                  'Vérifier couverture G/D, catégorie (1/2/3) et classe T ≥ 135°C ; ' +
                  'proposer remplacement compatible et plan d’inspection.</p>'
      });
    }
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Tu es AutonomiX IA. Réponds en HTML concis en français.' },
        { role: 'user', content: userPrompt }
      ]
    });
    const html = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content
      ? resp.choices[0].message.content
      : '';
    res.json({ response: html });
  } catch (e) {
    res.status(500).json({ error: 'Erreur aide conformité: ' + e.message });
  }
});

router.post('/atex-chat', async (req, res) => {
  try {
    const b = req.body || {};
    const question = b.question || '';
    const equipment = b.equipment || null;
    const history = Array.isArray(b.history) ? b.history : [];

    const messages = [{ role: 'system', content: 'Tu es AutonomiX IA. Tu réponds en HTML concis en français.' }];
    for (const m of history) {
      if (m && m.role && m.content) messages.push({ role: m.role, content: m.content });
    }
    let userPrompt = question;
    if (equipment) {
      const z = pickZones(equipment.exterieur, equipment.interieur);
      userPrompt =
        'Analyse l\'équipement ATEX suivant et propose des corrections concrètes :\n' +
        'Composant: ' + (equipment.composant || '') + '\n' +
        'Risque: ' + (equipment.risque != null ? equipment.risque : 'N/A') + '\n' +
        'Zones: G=' + (z.zg || '-') + ' / D=' + (z.zd || '-') + '\n' +
        'Prochaine inspection: ' + (equipment.next_inspection_date || 'n/a') + '\n' +
        'Réponds en HTML concis (titres + liste).';
    }
    if (!userPrompt) return res.status(400).json({ error: 'question ou equipment requis' });

    if (!openai || !process.env.OPENAI_API_KEY) {
      const html = '<p><strong>AutonomiX IA (local)</strong> — Moteur IA indisponible.</p>';
      return res.json({ response: html, offline: true });
    }
    messages.push({ role: 'user', content: userPrompt });
    const resp = await openai.chat.completions.create({ model: 'gpt-4o', messages });
    const html = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content
      ? resp.choices[0].message.content
      : 'Réponse indisponible.';
    res.json({ response: html });
  } catch (e) {
    res.status(500).json({ error: 'Erreur chat IA: ' + e.message });
  }
});

/* ----------------------- Photo upload (optionnel) ----------------------- */
// multipart: champ "file" OU "photo". Stockage base64 (colonne photo)
router.post('/atex-photo/:id', upload.single('file'), async (req, res) => {
  try {
    const id = req.params.id;
    let dataUrl = null;

    if (req.file && req.file.buffer) {
      const mime = req.file.mimetype || 'image/jpeg';
      const b64 = req.file.buffer.toString('base64');
      dataUrl = 'data:' + mime + ';base64,' + b64;
    } else if (req.body && req.body.photo) {
      dataUrl = String(req.body.photo);
    }

    if (!dataUrl) return res.status(400).json({ error: 'Aucune image' });

    // Petit garde-fou taille en base64 (~10 Mo)
    if (dataUrl.length > 14 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image trop volumineuse' });
    }

    await q('UPDATE atex_equipments SET photo=$1 WHERE id=$2', [dataUrl, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur upload photo: ' + e.message });
  }
});

module.exports = router;
