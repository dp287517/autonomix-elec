/** routes/atex.js — ATEX API (Gaz + Poussières + Historique IA)
 * Endpoints:
 *  - GET  /atex-secteurs
 *  - CRUD /atex-equipments
 *  - POST /atex-inspect
 *  - GET  /atex-import-columns
 *  - GET  /atex-import-template        (CSV)
 *  - GET  /atex-import-template.xlsx   (XLSX)
 *  - POST /atex-import-excel
 *  - GET  /atex-help/:id
 *  - POST /atex-chat                   (stocke historique IA si equipment_id)
 *  - GET  /atex-ia-history/:id
 *  - POST /atex-photo/:id
 */
const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer(); // multipart (excel / photo)
const XLSX = require('xlsx');

const { pool } = require('../config/db');
let openai = null;
try { ({ openai } = require('../config/openai')); } catch { /* optionnel */ }

// --- Helpers DB ---
async function q(sql, params = []) {
  const c = await pool.connect();
  try { return await c.query(sql, params); }
  finally { c.release(); }
}
async function rows(sql, params = []) {
  try { return (await q(sql, params)).rows; }
  catch (e) {
    if (e && (e.code === '42P01' || /relation .* does not exist/i.test(e.message))) return []; // table absente
    throw e;
  }
}

// --- Helpers ATEX ---
function normZoneG(v) { const s = v == null ? null : String(v); return ['0','1','2'].includes(s) ? s : null; }
function normZoneD(v) { const s = v == null ? null : String(v); return ['20','21','22'].includes(s) ? s : null; }

function worstZone(zg, zd) {
  if (zg === '0' || zd === '20') return '0/20';
  if (zg === '1' || zd === '21') return '1/21';
  if (zg === '2' || zd === '22') return '2/22';
  return '';
}

function calculateMinCategory(zg, zd) {
  // Catégorie minimale conservatrice
  if (zg === '0' || zd === '20') return 'II 1GD IIIB T135°C';
  if (zg === '1' || zd === '21') return 'II 2GD IIIB T135°C';
  return 'II 3GD IIIB T135°C';
}

function checkDualConformity(marquage, zg, zd) {
  if (!marquage || (!zg && !zd)) return 'Non Conforme';

  // Catégorie marquage (Ga/Gb/Gc → 1/2/3 si présent)
  let catMarq = 3;
  if (/Ga\b/.test(marquage)) catMarq = 1;
  else if (/Gb\b/.test(marquage)) catMarq = 2;
  else if (/Gc\b/.test(marquage)) catMarq = 3;

  // Classe T (min requis 135°C par défaut pour G)
  let tMarq = 135;
  if (/T1\b/.test(marquage)) tMarq = 450;
  else if (/T2\b/.test(marquage)) tMarq = 300;
  else if (/T3\b/.test(marquage)) tMarq = 200;
  else if (/T4\b/.test(marquage)) tMarq = 135;
  else if (/T5\b/.test(marquage)) tMarq = 100;
  else if (/T6\b/.test(marquage)) tMarq = 85;

  const need1 = (zg === '0') || (zd === '20');
  const need2 = (zg === '1') || (zd === '21');
  const requiredCat = need1 ? 1 : (need2 ? 2 : 3);

  if (catMarq > requiredCat) return 'Non Conforme';
  if (tMarq < 135) return 'Non Conforme'; // garde‑fou

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

// --- SEC TEURS ---
router.get('/atex-secteurs', async (_req, res) => {
  try { res.json(await rows('SELECT id, name FROM atex_secteurs ORDER BY name ASC')); }
  catch (e) { res.status(500).json({ error: 'Erreur ATEX secteurs: ' + e.message }); }
});

// --- EQUIPEMENTS ---
router.get('/atex-equipments', async (_req, res) => {
  try {
    const list = await rows('SELECT * FROM atex_equipments ORDER BY id DESC');
    for (const it of list) {
      // compat: si anciens champs existent
      it.zone_gaz       = normZoneG(it.zone_gaz ?? it.exterieur);
      it.zone_poussiere = normZoneD(it.zone_poussiere ?? it.interieur);

      if (!it.next_inspection_date && it.last_inspection_date) {
        it.next_inspection_date = addYearsISO(it.last_inspection_date, it.frequence || 3);
      }
      it.zone_type = worstZone(it.zone_gaz, it.zone_poussiere); // affichage global compact
    }
    res.json(list);
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
    it.zone_gaz       = normZoneG(it.zone_gaz ?? it.exterieur);
    it.zone_poussiere = normZoneD(it.zone_poussiere ?? it.interieur);
    if (!it.next_inspection_date && it.last_inspection_date) {
      it.next_inspection_date = addYearsISO(it.last_inspection_date, it.frequence || 3);
    }
    it.zone_type = worstZone(it.zone_gaz, it.zone_poussiere);
    res.json(it);
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération équipement: ' + e.message });
  }
});

router.post('/atex-equipments', async (req, res) => {
  try {
    const d  = req.body || {};
    const zg = normZoneG(d.zone_gaz ?? d.exterieur);      // accepte l’un ou l’autre depuis le front
    const zd = normZoneD(d.zone_poussiere ?? d.interieur);

    const cat = calculateMinCategory(zg, zd);
    const conf = checkDualConformity(d.marquage_atex, zg, zd);
    const risk = riskFromDual(zg, zd, conf);

    const last = d.last_inspection_date || null;
    const next = d.next_inspection_date || (last ? addYearsISO(last, d.frequence || 3) : null);

    const sql =
      'INSERT INTO atex_equipments ' +
      '(risque, secteur, batiment, local, composant, fournisseur, type, identifiant, ' +
      ' zone_gaz, zone_poussiere, exterieur, interieur, categorie_minimum, marquage_atex, photo, conformite, comments, ' +
      ' last_inspection_date, next_inspection_date, grade, frequence, ia_history) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ' +
      'RETURNING *';
    const vals = [
      risk, d.secteur, d.batiment, d.local, d.composant, d.fournisseur, d.type, d.identifiant,
      zg, zd, zg, zd, cat, d.marquage_atex, d.photo || null, conf, d.comments || null,
      last, next, d.grade || 'V', d.frequence || 3, null
    ];
    const r = await q(sql, vals);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur ajout équipement: ' + e.message });
  }
});

router.put('/atex-equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const d  = req.body || {};
    const zg = normZoneG(d.zone_gaz ?? d.exterieur);
    const zd = normZoneD(d.zone_poussiere ?? d.interieur);

    const cat  = calculateMinCategory(zg, zd);
    const conf = checkDualConformity(d.marquage_atex, zg, zd);
    const risk = riskFromDual(zg, zd, conf);

    const sql =
      'UPDATE atex_equipments SET ' +
      'risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7, identifiant=$8, ' +
      'zone_gaz=$9, zone_poussiere=$10, exterieur=$11, interieur=$12, ' +
      'categorie_minimum=$13, marquage_atex=$14, photo=$15, conformite=$16, comments=$17, ' +
      'last_inspection_date=$18, next_inspection_date=$19, grade=$20, frequence=$21, ia_history=COALESCE($22, ia_history) ' +
      'WHERE id=$23 RETURNING *';
    const vals = [
      risk, d.secteur, d.batiment, d.local, d.composant, d.fournisseur, d.type, d.identifiant,
      zg, zd, zg, zd,
      cat, d.marquage_atex, d.photo || null, conf, d.comments || null,
      d.last_inspection_date || null, d.next_inspection_date || null, d.grade || 'V', d.frequence || 3,
      d.ia_history ? JSON.stringify(d.ia_history) : null,
      id
    ];
    const r = await q(sql, vals);
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

// --- INSPECTION ---
router.post('/atex-inspect', async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.equipment_id;
    const date = b.inspection_date || new Date().toISOString().split('T')[0];
    await q(
      'INSERT INTO atex_inspections (equipment_id, status, comment, photo, inspection_date) VALUES ($1,$2,$3,$4,$5)',
      [id, b.status || 'done', b.comment || null, b.photo || null, date]
    );
    // MAJ next
    const r = await rows('SELECT frequence FROM atex_equipments WHERE id=$1', [id]);
    const freq = r.length ? (r[0].frequence || 3) : 3;
    const next = addYearsISO(date, freq);
    await q('UPDATE atex_equipments SET last_inspection_date=$1, next_inspection_date=$2 WHERE id=$3', [date, next, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur inspection: ' + e.message });
  }
});

// --- IMPORT / EXPORT ---
router.get('/atex-import-columns', (_req, res) => {
  res.json({
    required: ['secteur','batiment','local','composant','fournisseur','type','identifiant','zone_gaz','zone_poussieres','marquage_atex'],
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
    const lines = arr.slice(1); // saute entête

    for (const r of lines) {
      if (!r || !r.length) continue;
      const secteur     = r[0] || null;
      const batiment    = r[1] || null;
      const local       = r[2] || null;
      const composant   = r[3] || null;
      const fournisseur = r[4] || null;
      const type        = r[5] || null;
      const identifiant = r[6] || null;
      const zg          = normZoneG(r[7] != null ? r[7] : null);
      const zd          = normZoneD(r[8] != null ? r[8] : null);
      const marquage    = r[9] || null;
      const comments    = r[10] || null;
      const last        = r[11] || null;

      const cat  = calculateMinCategory(zg, zd);
      const conf = checkDualConformity(marquage, zg, zd);
      const risk = riskFromDual(zg, zd, conf);
      const next = last ? addYearsISO(last, 3) : null;

      await q(
        'INSERT INTO atex_equipments ' +
        '(risque, secteur, batiment, local, composant, fournisseur, type, identifiant, ' +
        ' zone_gaz, zone_poussieres, exterieur, interieur, ' +
        ' categorie_minimum, marquage_atex, photo, conformite, comments, last_inspection_date, next_inspection_date, grade, frequence) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ' +
        'ON CONFLICT (identifiant) DO UPDATE SET ' +
        'risque=EXCLUDED.risque, secteur=EXCLUDED.secteur, batiment=EXCLUDED.batiment, local=EXCLUDED.local, ' +
        'composant=EXCLUDED.composant, fournisseur=EXCLUDED.fournisseur, type=EXCLUDED.type, identifiant=EXCLUDED.identifiant, ' +
        'zone_gaz=EXCLUDED.zone_gaz, zone_poussieres=EXCLUDED.zone_poussieres, exterieur=EXCLUDED.exterieur, interieur=EXCLUDED.interieur, ' +
        'categorie_minimum=EXCLUDED.categorie_minimum, marquage_atex=EXCLUDED.marquage_atex, photo=EXCLUDED.photo, ' +
        'conformite=EXCLUDED.conformite, comments=EXCLUDED.comments, ' +
        'last_inspection_date=EXCLUDED.last_inspection_date, next_inspection_date=EXCLUDED.next_inspection_date',
        [
          risk, secteur, batiment, local, composant, fournisseur, type, identifiant,
          zg, zd, zg, zd,
          cat, marquage, null, conf, comments, last, next, 'V', 3
        ]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur import Excel: ' + e.message });
  }
});

// --- IA ---
router.get('/atex-help/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await rows('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    const eq = r[0];
    const zg = normZoneG(eq.zone_gaz ?? eq.exterieur);
    const zd = normZoneD(eq.zone_poussiere ?? eq.interieur);

    const userPrompt =
      'Corriger une non-conformité ATEX.\n' +
      'Données: composant=' + (eq.composant || '') +
      ', marquage=' + (eq.marquage_atex || '') +
      ', zones: G=' + (zg || '-') + ' / D=' + (zd || '-') +
      ', conformité=' + (eq.conformite || 'N/A') + '.\n' +
      'Donne 3 étapes terrain, 3 contrôles, et une suggestion de marquage/type compatible (en HTML).';

    if (!openai || !process.env.OPENAI_API_KEY) {
      return res.json({ response: '<p><strong>AutonomiX IA</strong> indisponible. Vérifier couverture G/D, catégorie (1/2/3) et T≥135°C ; proposer remplacement compatible.</p>' });
    }
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Tu es AutonomiX IA. Réponds en HTML concis en français.' },
        { role: 'user', content: userPrompt }
      ]
    });
    const html = resp?.choices?.[0]?.message?.content || '';
    res.json({ response: html });
  } catch (e) {
    res.status(500).json({ error: 'Erreur aide conformité: ' + e.message });
  }
});

// Stockage auto de l’historique si equipment_id fourni
router.post('/atex-chat', async (req, res) => {
  try {
    const b = req.body || {};
    const question  = b.question || '';
    const equip     = b.equipment || null;
    const equipId   = b.equipment_id || b.id || equip?.id || null;
    const history   = Array.isArray(b.history) ? b.history : [];

    const messages = [{ role: 'system', content: 'Tu es AutonomiX IA. Tu réponds en HTML concis en français.' }];
    for (const m of history) { if (m?.role && m?.content) messages.push({ role: m.role, content: m.content }); }

    let userPrompt = question;
    if (equip) {
      const zg = normZoneG(equip.zone_gaz ?? equip.exterieur);
      const zd = normZoneD(equip.zone_poussieres ?? equip.zone_poussiere ?? equip.interieur);
      userPrompt =
        'Analyse l\'équipement ATEX suivant et propose des corrections :\n' +
        'Composant: ' + (equip.composant || '') + '\n' +
        'Risque: ' + (equip.risque ?? 'N/A') + '\n' +
        'Zones: G=' + (zg || '-') + ' / D=' + (zd || '-') + '\n' +
        'Prochaine inspection: ' + (equip.next_inspection_date || 'n/a') + '\n' +
        'Réponds en HTML avec titres + listes.';
    }
    if (!userPrompt) return res.status(400).json({ error: 'question ou equipment requis' });

    let html = '<p><em>IA indisponible.</em></p>';
    if (openai && process.env.OPENAI_API_KEY) {
      messages.push({ role: 'user', content: userPrompt });
      const resp = await openai.chat.completions.create({ model: 'gpt-4o', messages });
      html = resp?.choices?.[0]?.message?.content || 'Réponse indisponible.';
    }

    // Si on a un equipment_id => on stocke l’historique dans la DB
    if (equipId) {
      const current = await rows('SELECT ia_history FROM atex_equipments WHERE id=$1', [equipId]);
      let iah = (current[0]?.ia_history) || [];
      if (!Array.isArray(iah)) iah = [];
      iah.push({ at: new Date().toISOString(), question: question || '(auto)', html });
      await q('UPDATE atex_equipments SET ia_history=$1 WHERE id=$2', [JSON.stringify(iah), equipId]);
      return res.json({ response: html, saved: true });
    }

    res.json({ response: html });
  } catch (e) {
    res.status(500).json({ error: 'Erreur chat IA: ' + e.message });
  }
});

router.get('/atex-ia-history/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await rows('SELECT ia_history FROM atex_equipments WHERE id=$1', [id]);
    const iah = r.length ? (r[0].ia_history || []) : [];
    res.json({ history: iah });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lecture historique IA: ' + e.message });
  }
});

// --- PHOTOS ---
router.post('/atex-photo/:id', upload.single('file'), async (req, res) => {
  try {
    const id = req.params.id;
    let dataUrl = null;
    if (req.file?.buffer) {
      const mime = req.file.mimetype || 'image/jpeg';
      dataUrl = `data:${mime};base64,` + req.file.buffer.toString('base64');
    } else if (req.body?.photo) {
      dataUrl = String(req.body.photo);
    }
    if (!dataUrl) return res.status(400).json({ error: 'Aucune image' });
    if (dataUrl.length > 14 * 1024 * 1024) return res.status(413).json({ error: 'Image trop volumineuse' });
    await q('UPDATE atex_equipments SET photo=$1 WHERE id=$2', [dataUrl, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur upload photo: ' + e.message });
  }
});

module.exports = router;
