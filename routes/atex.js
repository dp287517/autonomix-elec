// routes/atex.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const multer = require('multer');
const upload = multer();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
let openai = null;
try { openai = require('../config/openai').openai; } catch {}

const JSON_LIMIT_ERR = 'Charge utile trop volumineuse. Utilisez une image redimensionnée.';

// ============ DB helpers ============
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

// ============ Utils ============
const REQUIRED_FIELDS = ['composant', 'type', 'marquage_atex'];

function missingFields(data) {
  const miss = [];
  for (const f of REQUIRED_FIELDS) if (!data[f]) miss.push(f);
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
function addYearsISO(dateISO, years) {
  const d = new Date(dateISO);
  if (isNaN(d)) return null;
  d.setFullYear(d.getFullYear() + (parseInt(years,10)||0));
  return d.toISOString().split('T')[0];
}

// Zones : Gaz ↦ interieur (0/1/2), Poussières ↦ exterieur (20/21/22)
function pickZones(payload = {}) {
  const zg = payload.zone_gaz || (['0','1','2'].includes(String(payload.zone_type||'')) ? String(payload.zone_type) : '');
  const zd = payload.zone_poussieres || (['20','21','22'].includes(String(payload.zone_type||'')) ? String(payload.zone_type) : '');
  return { zone_gaz: zg || null, zone_poussieres: zd || null };
}
function minCatForZone(z){ if(!z) return null;
  const s = String(z);
  if (s === '0' || s === '20') return 1;
  if (s === '1' || s === '21') return 2;
  return 3;
}
function tempClassToMaxC(marquage = '') {
  const m = marquage.match(/T(\d)/i);
  if (!m) return 135;
  return { '1':450,'2':300,'3':200,'4':135,'5':100,'6':85 }[m[1]];
}
function catFromMarquage(marquage = '') {
  // Heuristique : si “II 1x/2x/3x …”
  const m = marquage.match(/II\s+([123])/i);
  return m ? parseInt(m[1],10) : 3;
}
function checkDualConformity(marquage, zg, zd) {
  const needG = ['0','1','2'].includes(String(zg||''));
  const needD = ['20','21','22'].includes(String(zd||''));

  // Présence marquage côté G/D
  const okG = !needG || /II\s+[123]\s*G/i.test(marquage);
  const okD = !needD || /II\s+[123]\s*D/i.test(marquage);
  if (!okG || !okD) return 'Non Conforme';

  // Catégorie requise = pire des deux
  const req = Math.max(minCatForZone(zg)||0, minCatForZone(zd)||0) || 3;
  const marqCat = catFromMarquage(marquage);
  if (marqCat > req) return 'Non Conforme';

  // Classe T minimale (135°C par défaut)
  const tMin = 135;
  const tMarq = tempClassToMaxC(marquage);
  if (tMarq < tMin) return 'Non Conforme';

  return 'Conforme';
}
function riskFromDual(zg, zd, conformity='Conforme'){
  function score(z) {
    if (!z && z!==0) return 0;
    const s = String(z);
    if (s==='0' || s==='20') return 5;
    if (s==='1' || s==='21') return 3;
    return 1; // 2 / 22
  }
  const zoneScore = Math.max(score(zg), score(zd));
  const confScore = (conformity !== 'Conforme') ? 2 : 0;
  return Math.min(Math.max(zoneScore + confScore, 0), 5);
}
function worstZone(zg, zd){
  // renvoie la plus sévère des 2 pour compat “zone_type”
  const rank = z => (z==='0'||z==='20')?3 : (z==='1'||z==='21')?2 : (z==='2'||z==='22')?1 : 0;
  return rank(zg) >= rank(zd) ? (zg || zd || '22') : (zd || zg || '22');
}
function nextFrom(lastISO, freqYears = 3) {
  const base = parseDateFlexible(lastISO) || new Date().toISOString().split('T')[0];
  return addYearsISO(base, freqYears);
}

// ============ Secteurs ============
router.get('/atex-secteurs', async (_req, res) => {
  try {
    const rows = await rowsOrEmpty(`SELECT id, name FROM atex_secteurs ORDER BY name ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur ATEX secteurs: ' + e.message }); }
});
router.post('/atex-secteurs', async (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom de secteur requis' });
    const r = await query(`INSERT INTO atex_secteurs(name) VALUES ($1) ON CONFLICT(name) DO NOTHING RETURNING *`, [name]);
    res.json(r.rows[0] || { name, created: false });
  } catch (e) { res.status(500).json({ error: 'Erreur création secteur: ' + e.message }); }
});

// ============ Equipements ============
router.get('/atex-equipments', async (_req, res) => {
  try {
    let rows = await rowsOrEmpty(`SELECT * FROM atex_equipments ORDER BY id DESC`);
    // enrichissement : zone_gaz / zone_poussieres + fallback prochaine date
    rows = rows.map(r => {
      const zg = (['0','1','2'].includes(String(r.interieur))) ? String(r.interieur) : null;
      const zd = (['20','21','22'].includes(String(r.exterieur))) ? String(r.exterieur) : null;
      const next = (!r.next_inspection_date && r.last_inspection_date)
        ? nextFrom(r.last_inspection_date, r.frequence || 3)
        : r.next_inspection_date;
      return { ...r, zone_gaz: zg, zone_poussieres: zd, next_inspection_date: next };
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur récupération équipements ATEX: ' + e.message }); }
});

router.get('/atex-equipments/:id', async (req, res) => {
  try {
    const r = await rowsOrEmpty(`SELECT * FROM atex_equipments WHERE id = $1`, [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    const row = r[0];
    const zg = (['0','1','2'].includes(String(row.interieur))) ? String(row.interieur) : null;
    const zd = (['20','21','22'].includes(String(row.exterieur))) ? String(row.exterieur) : null;
    if (!row.next_inspection_date && row.last_inspection_date) {
      row.next_inspection_date = nextFrom(row.last_inspection_date, row.frequence || 3);
    }
    res.json({ ...row, zone_gaz: zg, zone_poussieres: zd });
  } catch (e) { res.status(500).json({ error: 'Erreur récupération équipement: ' + e.message }); }
});

router.get('/atex-equipments/:id/photo', async (req, res) => {
  try {
    const r = await rowsOrEmpty(`SELECT photo FROM atex_equipments WHERE id = $1`, [req.params.id]);
    if (!r.length || !r[0].photo) return res.status(404).json({ error: 'Photo absente' });
    res.json({ photo: r[0].photo });
  } catch (e) { res.status(500).json({ error: 'Erreur récupération photo: ' + e.message }); }
});

// Upload photo multipart
router.post('/atex-photo/:id', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    await query(`UPDATE atex_equipments SET photo=$1 WHERE id=$2`, [b64, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur upload photo: ' + e.message }); }
});

// Create
router.post('/atex-equipments', async (req, res) => {
  try {
    const data = req.body || {};
    const miss = missingFields(data);
    if (miss.length) return res.status(400).json({ error: `Champs obligatoires manquants: ${miss.join(', ')}` });

    const { zone_gaz, zone_poussieres } = pickZones(data);
    const zone_type = worstZone(zone_gaz, zone_poussieres);
    const categorie_minimum = `II ${Math.max(minCatForZone(zone_gaz)||0, minCatForZone(zone_poussieres)||0 || 3}${(zone_gaz && zone_poussieres)?'GD':(zone_gaz?'G':'D')} T135°C`;
    const conformite = checkDualConformity(data.marquage_atex, zone_gaz, zone_poussieres);
    const risque = riskFromDual(zone_gaz, zone_poussieres, conformite);

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
        risque, data.secteur || null, data.batiment || null, data.local || null,
        data.composant, data.fournisseur, data.type, data.identifiant || null,
        zone_gaz || null, zone_poussieres || null, zone_type,
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

// Update
router.put('/atex-equipments/:id', async (req, res) => {
  try {
    const data = req.body || {};
    const miss = missingFields(data);
    if (miss.length) return res.status(400).json({ error: `Champs obligatoires manquants: ${miss.join(', ')}` });

    const { zone_gaz, zone_poussieres } = pickZones(data);
    const zone_type = worstZone(zone_gaz, zone_poussieres);
    const categorie_minimum = `II ${Math.max(minCatForZone(zone_gaz)||0, minCatForZone(zone_poussieres)||0 || 3}${(zone_gaz && zone_poussieres)?'GD':(zone_gaz?'G':'D')} T135°C`;
    const conformite = checkDualConformity(data.marquage_atex, zone_gaz, zone_poussieres);
    const risque = riskFromDual(zone_gaz, zone_poussieres, conformite);

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
        risque, data.secteur || null, data.batiment || null, data.local || null,
        data.composant, data.fournisseur, data.type, data.identifiant || null,
        zone_gaz || null, zone_poussieres || null, zone_type,
        data.marquage_atex, data.photo || null, conformite, data.comments || null,
        data.grade || 'V', frequence, lastInspection, isoOrNull(next), req.params.id
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erreur update équipement ATEX: ' + e.message }); }
});

// Delete
router.delete('/atex-equipments/:id', async (req, res) => {
  try {
    const r = await query(`DELETE FROM atex_equipments WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression équipement ATEX: ' + e.message }); }
});

// Inspections
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
    const eq = (await rowsOrEmpty(`SELECT frequence FROM atex_equipments WHERE id=$1`, [equipment_id]))[0];
    const next = nextFrom(dateISO, eq?.frequence || 3);
    await query(
      `UPDATE atex_equipments SET last_inspection_date=$1, next_inspection_date=$2 WHERE id=$3`,
      [dateISO, next, equipment_id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur enregistrement inspection: ' + e.message }); }
});

// Import / Templates
router.get('/atex-import-columns', (_req, res) => {
  res.json({
    required: ['secteur','batiment','local','composant','fabricant','type','identifiant','zone_gaz','zone_poussieres','marquage_atex'],
    optional: ['comments','last_inspection_date'],
    note: 'zone_gaz attendu : 0/1/2; zone_poussieres attendu : 20/21/22; dates JJ-MM-AAAA ou AAAA-MM-JJ'
  });
});
router.get('/atex-import-template', (_req, res) => {
  const csv =
`secteur,batiment,local,composant,fabricant,type,identifiant,zone_gaz,zone_poussieres,marquage_atex,comments,last_inspection_date
Métro,BâtA,L-01,Capteur pression,ACME,REF-123,CPT-0001,1,21,II 2GD T135°C,Premier lot,01-06-2025
`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.csv"');
  res.send(csv);
});
router.get('/atex-import-template.xlsx', (_req, res) => {
  try{
    const wb = XLSX.utils.book_new();
    const data = [
      ['secteur','batiment','local','composant','fabricant','type','identifiant','zone_gaz','zone_poussieres','marquage_atex','comments','last_inspection_date'],
      ['Métro','BâtA','L-01','Capteur pression','ACME','REF-123','CPT-0001','1','21','II 2GD T135°C','Premier lot','01-06-2025']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'import');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="atex_import_template.xlsx"');
    res.send(buf);
  }catch(e){ res.status(500).json({ error: 'xlsx generation failed', detail: e.message }); }
});
router.post('/atex-import-excel', upload.single('excel'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier Excel requis' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const get = (row, keys) => { for (const k of keys) if (row[k] !== undefined) return String(row[k]).trim(); return ''; };

    for (const row of rows) {
      let data = {
        secteur:                get(row, ['secteur','Secteur']),
        batiment:               get(row, ['batiment','Bâtiment','Batiment']),
        local:                  get(row, ['local','Local']),
        composant:              get(row, ['composant','Composant']),
        fabricant:              get(row, ['fabricant','Fournisseur']),
        type:                   get(row, ['type','Type']),
        identifiant:            get(row, ['identifiant','Identifiant','ID']),
        zone_gaz:               get(row, ['zone_gaz','Zone Gaz','Gaz']),
        zone_poussieres:        get(row, ['zone_poussieres','Zone Poussières','Poussières']),
        marquage_atex:          get(row, ['marquage_atex','Marquage atex','Marquage ATEX']),
        comments:               get(row, ['comments','Commentaires']),
        last_inspection_date:   get(row, ['last_inspection_date','Date dernière inspection','Date de dernière inspection'])
      };

      const miss = missingFields(data);
      if (miss.length) continue;

      const zg = (['0','1','2'].includes(String(data.zone_gaz))) ? String(data.zone_gaz) : null;
      const zd = (['20','21','22'].includes(String(data.zone_poussieres))) ? String(data.zone_poussieres) : null;
      const zone_type = worstZone(zg, zd);

      const conformite = checkDualConformity(data.marquage_atex, zg, zd);
      const risque = riskFromDual(zg, zd, conformite);
      const lastISO = parseDateFlexible(data.last_inspection_date);
      const frequence = 3;
      const nextISO = lastISO ? addYearsISO(lastISO, frequence) : null;
      const categorie_minimum = `II ${Math.max(minCatForZone(zg)||0, minCatForZone(zd)||0 || 3}${(zg && zd)?'GD':(zg?'G':'D')} T135°C`;

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
          risque, data.secteur, data.batiment, data.local, data.composant, data.fabricant,
          data.type, data.identifiant, zg, zd, zone_type, categorie_minimum, data.marquage_atex,
          conformite, data.comments || null, lastISO, nextISO, frequence, 'V'
        ]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur import Excel: ' + e.message }); }
});

// ======== Analyses / IA ========
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

router.post('/atex-chat', async (req, res) => {
  try {
    const { question, equipment, history = [] } = req.body || {};
    const sys = { role: 'system', content: 'Tu es AutonomiX IA. Tu réponds en HTML concis en français.' };

    let userPrompt = question || '';
    if (equipment) {
      userPrompt = `Analyse l'équipement ATEX suivant et propose des corrections concrètes :
Composant: ${equipment.composant}
Risque: ${equipment.risque}
Zones: G=${equipment.zone_gaz||'-'} / D=${equipment.zone_poussieres||'-'}
Prochaine inspection: ${equipment.next_inspection_date || 'n/a'}
Réponds en HTML concis (titres + liste).`;
    }
    if (!userPrompt) return res.status(400).json({ error: 'question ou equipment requis' });

    if (!openai || !process.env.OPENAI_API_KEY) {
      const html = `<p><strong>AutonomiX IA (local)</strong> — Moteur IA indisponible sur ce déploiement. Vérifiez marquage vs zones G/D, classe T (≥135°C) et catégorie (1/2/3).</p>`;
      return res.json({ response: html, offline: true });
    }

    const messages = [sys, ...history, { role: 'user', content: userPrompt }];
    const resp = await openai.chat.completions.create({ model: 'gpt-4o', messages });
    const html = resp.choices?.[0]?.message?.content || 'Réponse indisponible.';
    res.json({ response: html });
  } catch (e) { res.status(500).json({ error: 'Erreur chat IA: ' + e.message }); }
});

router.get('/atex-help/:id', async (req, res) => {
  try {
    const eq = (await rowsOrEmpty(`SELECT * FROM atex_equipments WHERE id=$1`, [req.params.id]))[0];
    if (!eq) return res.status(404).json({ error: 'Équipement non trouvé' });

    const zg = (['0','1','2'].includes(String(eq.interieur))) ? String(eq.interieur) : null;
    const zd = (['20','21','22'].includes(String(eq.exterieur))) ? String(eq.exterieur) : null;

    const question = `Corriger une non-conformité ATEX.
Données: composant=${eq.composant}, marquage=${eq.marquage_atex}, zones: G=${zg||'-'} / D=${zd||'-'}, conformité=${eq.conformite}.
Donne 3 étapes terrain, 3 contrôles, et une suggestion de marquage/type compatible (en HTML 150-220 mots).`;

    if (!openai || !process.env.OPENAI_API_KEY) {
      return res.json({ response: `<p><strong>AutonomiX IA</strong> — Sans moteur IA ici. Vérifier la couverture G/D, classe T ≥ 135°C et catégorie requise (1/2/3), remplacer si nécessaire.</p>` });
    }

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'Tu es AutonomiX IA. Réponds en HTML concis.' }, { role: 'user', content: question }]
    });
    res.json({ response: resp.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ error: 'Erreur aide conformité: ' + e.message }); }
});

module.exports = router;
