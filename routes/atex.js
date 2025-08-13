const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { pool } = require('../config/db');
const { callOpenAI } = require('../config/openai');

// Helpers
const nullIfEmpty = v => (v === undefined || v === null || String(v).trim() === '' ? null : v);

// ===== Equipments =====
router.get('/atex-equipments', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
        last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
        zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments,
        (ia_history IS NOT NULL AND jsonb_typeof(ia_history)='array' AND jsonb_array_length(ia_history) > 0) AS has_ia_history
      FROM public.atex_equipments
      ORDER BY COALESCE(next_inspection_date, make_date(1970,1,1)) ASC, id ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('[GET /atex-equipments]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-equipments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`
      SELECT
        id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
        last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
        zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments
      FROM public.atex_equipments WHERE id=$1
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[GET /atex-equipments/:id]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/atex-equipments', upload.any(), async (req, res) => {
  try {
    const b = req.body || {};
    const values = [
      b.risque ? parseInt(b.risque,10) : null,
      nullIfEmpty(b.secteur), nullIfEmpty(b.batiment), nullIfEmpty(b.local),
      nullIfEmpty(b.composant), nullIfEmpty(b.fournisseur), nullIfEmpty(b.type),
      nullIfEmpty(b.identifiant),
      nullIfEmpty(b.interieur), nullIfEmpty(b.exterieur),
      nullIfEmpty(b.categorie_minimum), nullIfEmpty(b.marquage_atex),
      nullIfEmpty(b.photo),
      nullIfEmpty(b.conformite), nullIfEmpty(b.comments),
      b.last_inspection_date ? String(b.last_inspection_date).slice(0,10) : null,
      b.next_inspection_date ? String(b.next_inspection_date).slice(0,10) : null,
      nullIfEmpty(b.risk_assessment),
      nullIfEmpty(b.grade),
      b.frequence ? parseInt(b.frequence,10) : null,
      nullIfEmpty(b.zone_type),
      nullIfEmpty(b.zone_gaz),
      nullIfEmpty(b.zone_poussiere),
      b.zone_poussieres != null ? parseInt(b.zone_poussieres,10) : null,
      b.ia_history ? JSON.parse(b.ia_history) : null,
      b.attachments ? JSON.parse(b.attachments) : null
    ];
    const { rows } = await pool.query(`
      INSERT INTO public.atex_equipments
        (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
         interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
         last_inspection_date, next_inspection_date, risk_assessment, grade, frequence,
         zone_type, zone_gaz, zone_poussiere, zone_poussieres, ia_history, attachments)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING id
    `, values);
    res.json({ id: rows[0].id });
  } catch (e) {
    console.error('[POST /atex-equipments]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/atex-equipments/:id', upload.none(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    await pool.query(`
      UPDATE public.atex_equipments SET
        risque = COALESCE($1, risque),
        secteur = COALESCE($2, secteur),
        batiment = COALESCE($3, batiment),
        local = COALESCE($4, local),
        composant = COALESCE($5, composant),
        fournisseur = COALESCE($6, fournisseur),
        type = COALESCE($7, type),
        identifiant = COALESCE($8, identifiant),
        interieur = COALESCE($9, interieur),
        exterieur = COALESCE($10, exterieur),
        categorie_minimum = COALESCE($11, categorie_minimum),
        marquage_atex = COALESCE($12, marquage_atex),
        photo = COALESCE($13, photo),
        conformite = COALESCE($14, conformite),
        comments = COALESCE($15, comments),
        last_inspection_date = COALESCE($16, last_inspection_date),
        next_inspection_date = COALESCE($17, next_inspection_date),
        risk_assessment = COALESCE($18, risk_assessment),
        grade = COALESCE($19, grade),
        frequence = COALESCE($20, frequence),
        zone_type = COALESCE($21, zone_type),
        zone_gaz = COALESCE($22, zone_gaz),
        zone_poussiere = COALESCE($23, zone_poussiere),
        zone_poussieres = COALESCE($24, zone_poussieres)
      WHERE id=$25
    `, [
      b.risque ? parseInt(b.risque,10) : null,
      nullIfEmpty(b.secteur), nullIfEmpty(b.batiment), nullIfEmpty(b.local),
      nullIfEmpty(b.composant), nullIfEmpty(b.fournisseur), nullIfEmpty(b.type),
      nullIfEmpty(b.identifiant),
      nullIfEmpty(b.interieur), nullIfEmpty(b.exterieur),
      nullIfEmpty(b.categorie_minimum), nullIfEmpty(b.marquage_atex),
      nullIfEmpty(b.photo),
      nullIfEmpty(b.conformite), nullIfEmpty(b.comments),
      b.last_inspection_date ? String(b.last_inspection_date).slice(0,10) : null,
      b.next_inspection_date ? String(b.next_inspection_date).slice(0,10) : null,
      nullIfEmpty(b.risk_assessment),
      nullIfEmpty(b.grade),
      b.frequence ? parseInt(b.frequence,10) : null,
      nullIfEmpty(b.zone_type),
      nullIfEmpty(b.zone_gaz),
      nullIfEmpty(b.zone_poussiere),
      b.zone_poussieres != null ? parseInt(b.zone_poussieres,10) : null,
      id
    ]);
    res.json({ ok:true });
  } catch (e) {
    console.error('[PUT /atex-equipments/:id]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ===== Inspect (updates last_inspection_date; trigger sets next_inspection_date in MONTHS) =====
router.post('/atex-inspect', upload.any(), async (req, res) => {
  try {
    const b = req.body || {};
    const id = Number(b.equipment_id || req.query?.equipment_id);
    if (!id) return res.status(400).json({ error: 'equipment_id_required' });
    const date = (b.inspection_date || req.query?.inspection_date || new Date().toISOString().slice(0,10)).toString().slice(0,10);
    const r = await pool.query(`UPDATE public.atex_equipments SET last_inspection_date=$2 WHERE id=$1`, [id, date]);
    if (!r.rowCount) return res.status(404).json({ error: 'equipment_not_found' });
    res.json({ ok:true, id, inspection_date: date });
  } catch (e) {
    console.error('[POST /atex-inspect]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ===== IA utils =====
async function pushIAHistory(id, sid, role, content) {
  await pool.query(`
    UPDATE public.atex_equipments
       SET ia_history = COALESCE(ia_history, '[]'::jsonb) || jsonb_build_object(
         'ts', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS'),
         'sid', $2, 'role', $3, 'content', $4
       )
     WHERE id = $1
  `, [id, sid, role, content]);
}

// Start session
router.post('/atex-chat/start', upload.none(), async (req, res) => {
  try {
    const id = Number(req.body?.id || req.body?.equipment_id);
    if (!id) return res.status(400).json({ error:'id_required' });
    const sid = require('crypto').randomUUID();
    await pushIAHistory(id, sid, 'system', 'session_start');
    res.json({ sid });
  } catch (e) {
    console.error('[POST /atex-chat/start]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Message
router.post('/atex-chat/message', upload.none(), async (req, res) => {
  try {
    const id = Number(req.body?.id || req.body?.equipment_id);
    const sid = (req.body?.sid || '').trim();
    const question = (req.body?.question || req.body?.message || '').trim();
    if (!id || !sid || !question) return res.status(400).json({ error:'id_sid_question_required' });

    await pushIAHistory(id, sid, 'user', question);

    const prompt = [
      `Équipement ATEX #${id}. Question: ${question}`,
      "Rédige une réponse structurée en Markdown avec les sections suivantes (titres en gras):",
      "1) **Explication synthétique** (5–7 phrases).",
      "2) **Synthèses actionnables** (liste concise).",
      "3) **Pourquoi ?** (liste)",
      "4) **Mesures palliatives** (liste)",
      "5) **Mesures préventives** (liste)",
      "6) **Catégorie requise (estimée)** (1–2 phrases)",
      "7) **Suggestions d'achat** (liste d’items)",
      "8) **Discussions sur le même sujet** (2–3 pistes de questions)."
    ].join("\n");
    const reply = await callOpenAI(prompt);
    await pushIAHistory(id, sid, 'assistant', reply);
    res.json({ response: reply });
  } catch (e) {
    console.error('[POST /atex-chat/message]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Delete one discussion
router.delete('/atex-chat/delete/:id/:sid', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sid = (req.params.sid || '').trim();
    if (!id || !sid) return res.status(400).json({ error:'bad_id_or_sid' });
    const { rows } = await pool.query(`SELECT ia_history FROM public.atex_equipments WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error:'not_found' });
    const hist = rows[0].ia_history || [];
    const filtered = hist.filter(e => (e?.sid||'') !== sid);
    await pool.query(`UPDATE public.atex_equipments SET ia_history=$2 WHERE id=$1`, [id, JSON.stringify(filtered)]);
    res.json({ ok:true });
  } catch (e) {
    console.error('[DELETE /atex-chat/delete/:id/:sid]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Delete all
router.delete('/atex-chat/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error:'bad_id' });
    await pool.query(`UPDATE public.atex_equipments SET ia_history='[]'::jsonb WHERE id=$1`, [id]);
    res.json({ ok:true });
  } catch (e) {
    console.error('[DELETE /atex-chat/:id]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Help (structured HTML)
router.get('/atex-help/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM public.atex_equipments WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error:'not_found' });
    const e = rows[0];
    const isNC = (''+(e.conformite||'')).toLowerCase().includes('non');
    const zg = e.zone_gaz || null, zd = e.zone_poussiere || e.zone_poussieres || null;
    const cat = (zg||zd) ? '2G/2D' : 'non ATEX';

    const synth = `
      <div class="mb-2"><div class="ia-section-title"><strong>Explication synthétique</strong></div>
      <div class="ia-muted">Analyse automatique de l’équipement et de son contexte.</div></div>
      <div> ${isNC
        ? "L’équipement présente au moins une non-conformité. Une action correctrice est nécessaire."
        : "Aucune non-conformité détectée à ce stade. Maintenir le plan d’inspection."}
      </div>
    `;

    const actionable = `
      <div class="ia-section-title"><strong>Synthèses actionnables</strong></div>
      <ul class="mb-3">
        <li>Vérifier le marquage ATEX (Ex, catégorie, température).</li>
        <li>Mettre à jour la documentation (plan, certificat, feuille de vie).</li>
        <li>Programmer la prochaine inspection.</li>
      </ul>
    `;

    const cards = [
      { title:'Pourquoi ?', list: isNC ? [
          "Marquage incompatible avec la zone (gaz/poussières).",
          "Catégorie insuffisante pour le niveau de risque.",
          "Documentation incomplète ou obsolète."
        ] : [
          "Paramètres conformes aux exigences de la zone.",
          "Dernière inspection enregistrée et à jour."
        ]},
      { title:'Mesures palliatives', list: isNC ? [
          "Limiter les opérations et sources d’inflammation.",
          "Surveillance accrue jusqu’à correction."
        ] : ["Aucune mesure palliative requise."]},
      { title:'Mesures préventives', list: isNC ? [
          "Choisir un matériel avec marquage adapté (Ex, catégorie, T-class).",
          "Mettre à jour la signalétique et la documentation."
        ] : ["Maintenir la conformité via inspection périodique."]},
      { title:'Catégorie requise (estimée)', body: 'Catégorie minimale recommandée : <strong>'+cat+'</strong>.' }
    ].map(c => (
      '<div class="col-md-6"><div class="ia-card"><div class="fw-semibold">'+c.title+'</div>'
      + (c.body?'<div class="mt-2">'+c.body+'</div>':'')
      + (Array.isArray(c.list)?'<ul class="mb-0 mt-2">'+c.list.map(li=>'<li>'+li+'</li>').join('')+'</ul>':'')
      + '</div></div>'
    )).join('');

    const achats = `
      <div class="ia-section-title"><strong>Suggestions d'achat</strong></div>
      <ul class="mb-3">
        <li>Matériel certifié Ex adapté à la zone: éclairage, boîtiers, presse-étoupes.</li>
        <li>Étiquettes et signalétique ATEX.</li>
        <li>Documentation/certificats à jour (format numérique sécurisé).</li>
      </ul>
    `;

    const related = `
      <div class="ia-section-title"><strong>Discussions sur le même sujet</strong></div>
      <ul class="mb-2">
        <li>Comment vérifier la compatibilité marquage/zone ?</li>
        <li>Quelle périodicité d’inspection selon la zone et l’usage ?</li>
      </ul>
    `;

    const html = ''
      + '<div id="iaSummary" class="mb-3">'+synth+'</div>'
      + '<div id="iaActionable" class="mb-3">'+actionable+'</div>'
      + '<div id="iaCards" class="row g-3 mb-3">'+cards+'</div>'
      + '<div id="iaSuggestions" class="mb-3">'+achats+'</div>'
      + '<div id="iaRelated" class="mb-3">'+related+'</div>';

    res.json({ response: html });
  } catch (e) {
    console.error('[GET /atex-help/:id]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
