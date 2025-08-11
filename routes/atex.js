// atex.js
const express = require('express');
const router = express.Router();
const pool = require('./db');           // utilise ton db.js existant (PostgreSQL)
const { openai } = require('./openai'); // utilise ton openai.js existant

// --------------- Helpers règles ATEX & utilitaires -----------------

const SECTEURS_INIT = ['Maintenance', 'Métro', 'Utilité'];

/**
 * Calcule la catégorie minimale requise selon le type de zone ATEX.
 * Exemples de zone_type supportés :
 *  "Zone 0", "Zone 1", "Zone 2" (Gaz)
 *  "Zone 20", "Zone 21", "Zone 22" (Poussières)
 */
function categorieMinimaleFromZone(zone_type) {
  if (!zone_type) return null;

  const z = String(zone_type).trim().toLowerCase();
  if (z.includes('zone 0')) return 'II 1G';
  if (z.includes('zone 1')) return 'II 2G';
  if (z.includes('zone 2')) return 'II 3G';

  if (z.includes('zone 20')) return 'II 1D';
  if (z.includes('zone 21')) return 'II 2D';
  if (z.includes('zone 22')) return 'II 3D';

  return null;
}

/**
 * Parse une chaîne de marquage ATEX pour en extraire la catégorie "II xG" ou "II xD".
 * Retourne { num: 1|2|3, milieu: 'G'|'D' } ou null.
 */
function parseCategorieFromMarquage(marquage) {
  if (!marquage) return null;
  const m = String(marquage).toUpperCase();
  const rx = /II\s*([123])\s*([GD])/;
  const match = m.match(rx);
  if (!match) return null;
  return { num: Number(match[1]), milieu: match[2] };
}

/**
 * Détermine conformité selon zone & marquage.
 * Règle simple :
 *   - on calcule la catégorie minimale exigée par la zone (ex: Zone 21 => II 2D)
 *   - si le marquage est d’un NIVEAU ÉGAL OU PLUS PROTECTEUR (1 > 2 > 3) ET du bon milieu (G vs D),
 *     c’est Conforme. Sinon Non Conforme.
 * Renvoie { conforme: boolean, details: string, categorie_minimum: string|null }
 */
function evalConformite({ zone_type, marquage_atex }) {
  const catReq = categorieMinimaleFromZone(zone_type);
  if (!catReq) {
    return {
      conforme: false,
      details: `Type de zone non spécifié ou inconnu. Impossible d'évaluer la conformité.`,
      categorie_minimum: null,
    };
  }
  const parsedReq = parseCategorieFromMarquage(catReq);
  const parsedEquip = parseCategorieFromMarquage(marquage_atex);

  if (!parsedEquip) {
    return {
      conforme: false,
      details: `Marquage ATEX non reconnu (ex: "II 2G", "II 3D").`,
      categorie_minimum: catReq,
    };
  }

  if (parsedReq.milieu !== parsedEquip.milieu) {
    return {
      conforme: false,
      details: `Milieu différent : requis ${catReq}, marquage ${marquage_atex}.`,
      categorie_minimum: catReq,
    };
  }

  // 1 est plus protecteur que 2, qui est plus protecteur que 3
  const ok = parsedEquip.num <= parsedReq.num;
  return {
    conforme: ok,
    details: ok
      ? `OK : marquage ${marquage_atex} ≥ exigence ${catReq}.`
      : `Insuffisant : requis ${catReq}, trouvé ${marquage_atex}.`,
    categorie_minimum: catReq,
  };
}

/**
 * Calcule la prochaine date d’inspection :
 *  - si last_inspection_date fournie -> + frequence (années)
 *  - sinon -> aujourd’hui + frequence (années)
 * Renvoie une date ISO (yyyy-mm-dd)
 */
function computeNextInspectionDate(last_inspection_date, frequence = 3) {
  const base = last_inspection_date ? new Date(last_inspection_date) : new Date();
  const next = new Date(base);
  next.setFullYear(base.getFullYear() + (Number(frequence) || 3));
  return next.toISOString().slice(0, 10);
}

/**
 * Validation des champs obligatoires.
 */
function validateRequired(body) {
  const missing = [];
  if (!body.composant) missing.push('Composant');
  if (!body.fournisseur) missing.push('Fabricant');
  if (!body.type) missing.push('Type');
  if (!body.marquage_atex) missing.push('Marquage');
  if (missing.length) {
    const err = new Error(`Champs obligatoires manquants : ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

/**
 * Normalise l’objet équipement reçu du front.
 */
function normalizeEquipmentPayload(payload) {
  const e = { ...payload };

  // Booléens
  if (e.interieur !== undefined) e.interieur = !!e.interieur;
  if (e.exterieur !== undefined) e.exterieur = !!e.exterieur;

  // Fréquence
  e.frequence = Number(e.frequence || 3);

  // Zone & catégorie
  const evalC = evalConformite({ zone_type: e.zone_type, marquage_atex: e.marquage_atex });
  e.categorie_minimum = evalC.categorie_minimum || e.categorie_minimum || null;
  e.conformite = evalC.conforme ? 'Conforme' : 'Non Conforme';
  // On ajoute le détail de conformité côté réponse (pas stocké), voir plus bas.

  // Dates
  const last = e.last_inspection_date ? String(e.last_inspection_date).slice(0, 10) : null;
  e.last_inspection_date = last;
  e.next_inspection_date = computeNextInspectionDate(last, e.frequence);

  // Valeurs par défaut usuelles si non fournies
  if (!e.grade) e.grade = 'V';
  if (e.risque === undefined || e.risque === null || e.risque === '') e.risque = 1;

  return { normalized: e, conformityDetails: evalC.details };
}

// -------------------------- Bootstrap SQL ----------------------------

async function ensureTables() {
  await pool.query(`
    create table if not exists atex_secteurs(
      id serial primary key,
      name text unique not null
    );
  `);

  await pool.query(`
    create table if not exists atex_equipments(
      id serial primary key,
      risque integer default 1,
      secteur text,
      batiment text,
      local text,
      composant text not null,
      fournisseur text not null,
      type text not null,
      identifiant text,
      interieur boolean,
      exterieur boolean,
      categorie_minimum text,
      marquage_atex text not null,
      photo text,
      conformite text,
      comments text,
      last_inspection_date date,
      next_inspection_date date,
      risk_assessment jsonb,
      grade text,
      frequence integer default 3,
      zone_type text
    );
  `);

  await pool.query(`
    create table if not exists atex_chat(
      id serial primary key,
      equipment_id integer references atex_equipments(id) on delete cascade,
      role text not null,
      content text not null,
      created_at timestamptz default now()
    );
  `);

  // Seed secteurs si vide
  const { rows } = await pool.query(`select count(*)::int as n from atex_secteurs`);
  if (rows[0].n === 0) {
    const values = SECTEURS_INIT.map((s) => `('${s.replace(/'/g, "''")}')`).join(',');
    await pool.query(`insert into atex_secteurs(name) values ${values}`);
  }
}

// Au chargement du routeur, on s’assure que les tables existent
ensureTables().catch((e) => {
  console.error('[ATEX] init DB error:', e);
});

// ---------------------------- Routes ---------------------------------

// Secteurs (GET)
router.get('/atex-secteurs', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`select id, name from atex_secteurs order by name asc`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Équipements (LIST)
router.get('/atex-equipments', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      select id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
             interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite, comments,
             last_inspection_date, next_inspection_date, risk_assessment, grade, frequence, zone_type
      from atex_equipments
      order by id desc
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// Équipements (CREATE)
router.post('/atex-equipments', async (req, res, next) => {
  try {
    validateRequired(req.body);
    const { normalized, conformityDetails } = normalizeEquipmentPayload(req.body);

    const q = `
      insert into atex_equipments
      (risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur,
       categorie_minimum, marquage_atex, photo, conformite, comments, last_inspection_date, next_inspection_date,
       risk_assessment, grade, frequence, zone_type)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      returning *
    `;
    const vals = [
      normalized.risque, normalized.secteur, normalized.batiment, normalized.local, normalized.composant,
      normalized.fournisseur, normalized.type, normalized.identifiant, normalized.interieur, normalized.exterieur,
      normalized.categorie_minimum, normalized.marquage_atex, normalized.photo, normalized.conformite,
      normalized.comments, normalized.last_inspection_date, normalized.next_inspection_date,
      normalized.risk_assessment || null, normalized.grade, normalized.frequence, normalized.zone_type
    ];
    const { rows } = await pool.query(q, vals);
    const item = rows[0];
    res.json({ ...item, conformity_details: conformityDetails });
  } catch (e) { next(e); }
});

// Équipements (UPDATE)
router.put('/atex-equipments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      const err = new Error('ID manquant');
      err.status = 400;
      throw err;
    }
    validateRequired(req.body);
    const { normalized, conformityDetails } = normalizeEquipmentPayload(req.body);

    const q = `
      update atex_equipments set
        risque=$1, secteur=$2, batiment=$3, local=$4, composant=$5, fournisseur=$6, type=$7, identifiant=$8,
        interieur=$9, exterieur=$10, categorie_minimum=$11, marquage_atex=$12, photo=$13, conformite=$14,
        comments=$15, last_inspection_date=$16, next_inspection_date=$17, risk_assessment=$18, grade=$19,
        frequence=$20, zone_type=$21
      where id=$22
      returning *
    `;
    const vals = [
      normalized.risque, normalized.secteur, normalized.batiment, normalized.local, normalized.composant,
      normalized.fournisseur, normalized.type, normalized.identifiant, normalized.interieur, normalized.exterieur,
      normalized.categorie_minimum, normalized.marquage_atex, normalized.photo, normalized.conformite,
      normalized.comments, normalized.last_inspection_date, normalized.next_inspection_date,
      normalized.risk_assessment || null, normalized.grade, normalized.frequence, normalized.zone_type, id
    ];
    const { rows } = await pool.query(q, vals);
    if (!rows.length) return res.status(404).json({ error: 'Introuvable' });
    const item = rows[0];
    res.json({ ...item, conformity_details: conformityDetails });
  } catch (e) { next(e); }
});

// Équipements (DELETE)
router.delete('/atex-equipments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`delete from atex_chat where equipment_id=$1`, [id]); // ménage
    const { rowCount } = await pool.query(`delete from atex_equipments where id=$1`, [id]);
    res.json({ success: rowCount > 0 });
  } catch (e) { next(e); }
});

// Statistiques globales (liste + agrégats)
router.get('/atex-risk-global', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`select id, risque, conformite from atex_equipments`);
    const total = rows.length;
    const conformes = rows.filter(r => r.conformite === 'Conforme').length;
    const nonConformes = total - conformes;
    const risqueMoyen = total ? (rows.reduce((s, r) => s + (Number(r.risque) || 0), 0) / total) : 0;

    // tu peux ajouter ici une logique "highRisk" selon tes critères
    const highRisk = rows.filter(r => (Number(r.risque) || 0) >= 4).map(r => r.id);

    res.json({
      stats: {
        total_equipements: total,
        conformes,
        non_conformes: nonConformes,
        risque_moyen: risqueMoyen.toFixed(1),
      },
      highRisk,
    });
  } catch (e) { next(e); }
});

// Import JSON (avec nouveaux champs zone_type & last_inspection_date)
router.post('/atex-import', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : (req.body.rows || []);
    if (!rows.length) return res.status(400).json({ error: 'Aucune ligne à importer' });

    const inserted = [];
    for (const raw of rows) {
      try {
        validateRequired(raw);
        const { normalized } = normalizeEquipmentPayload(raw);
        const vals = [
          normalized.risque, normalized.secteur, normalized.batiment, normalized.local, normalized.composant,
          normalized.fournisseur, normalized.type, normalized.identifiant, normalized.interieur, normalized.exterieur,
          normalized.categorie_minimum, normalized.marquage_atex, normalized.photo, normalized.conformite,
          normalized.comments, normalized.last_inspection_date, normalized.next_inspection_date,
          normalized.risk_assessment || null, normalized.grade, normalized.frequence, normalized.zone_type
        ];
        const { rows: r } = await pool.query(
          `insert into atex_equipments
           (risque, secteur, batiment, local, composant, fournisseur, type, identifiant, interieur, exterieur,
            categorie_minimum, marquage_atex, photo, conformite, comments, last_inspection_date, next_inspection_date,
            risk_assessment, grade, frequence, zone_type)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           returning *`, vals
        );
        inserted.push(r[0]);
      } catch (rowErr) {
        // on continue mais on note l'erreur sur cette ligne
        inserted.push({ error: rowErr.message, row: raw });
      }
    }
    res.json({ inserted });
  } catch (e) { next(e); }
});

// Modèle d’import CSV (avec colonnes demandées)
router.get('/atex-import/template', (_req, res) => {
  const headers = [
    'secteur','batiment','local','composant','fournisseur','type','identifiant',
    'interieur','exterieur','marquage_atex','risque','grade','frequence',
    'zone_type','last_inspection_date','comments','photo'
  ];
  const csv = headers.join(',') + '\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="import_atex_template.csv"');
  res.send(csv);
});

// Historique de chat IA (GET)
router.get('/atex-chat/:equipmentId/history', async (req, res, next) => {
  try {
    const id = Number(req.params.equipmentId);
    const { rows } = await pool.query(
      `select id, role, content, created_at
       from atex_chat
       where equipment_id=$1
       order by id asc`,
      [id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Chat IA (POST) - conserve l’historique et répond en "AutonomiX IA"
router.post('/atex-chat', async (req, res, next) => {
  try {
    const { equipmentId, message } = req.body;
    if (!equipmentId || !message) {
      const err = new Error('equipmentId et message sont requis.');
      err.status = 400;
      throw err;
    }

    // Enregistrer la question utilisateur
    await pool.query(
      `insert into atex_chat(equipment_id, role, content) values($1,$2,$3)`,
      [equipmentId, 'user', String(message)]
    );

    // Charger l’équipement et les 12 derniers messages
    const { rows: eqRows } = await pool.query(`select * from atex_equipments where id=$1`, [equipmentId]);
    const equipment = eqRows[0] || {};
    const { rows: hist } = await pool.query(
      `select role, content from atex_chat where equipment_id=$1 order by id desc limit 12`,
      [equipmentId]
    );

    // Contexte synthétique de l’équipement pour l’IA
    const resumeEquip = `
Équipement:
- Composant: ${equipment.composant || '-'}
- Fabricant: ${equipment.fournisseur || '-'}
- Type: ${equipment.type || '-'}
- ID: ${equipment.identifiant || '-'}
- Secteur: ${equipment.secteur || '-'}
- Bâtiment: ${equipment.batiment || '-'}, Local: ${equipment.local || '-'}
- Zone: ${equipment.zone_type || '-'} (catégorie minimale: ${equipment.categorie_minimum || '-'})
- Marquage ATEX: ${equipment.marquage_atex || '-'}
- Conformité actuelle: ${equipment.conformite || '-'}
- Dernière inspection: ${equipment.last_inspection_date || '-'}, Prochaine: ${equipment.next_inspection_date || '-'}
- Risque: ${equipment.risque || '-'}, Grade: ${equipment.grade || '-'}, Fréquence: ${equipment.frequence || '-'}
`.trim();

    // Construire la conversation (ancien → nouveau)
    const messages = [
      {
        role: 'system',
        content:
`Tu es **AutonomiX IA**, assistant expert ATEX.
Règles:
- Présente-toi toujours comme "AutonomiX IA".
- Explique clairement pourquoi un équipement est (non) conforme, avec références normatives ATEX/G/D quand utile.
- Propose des actions correctives (immédiates et pérennes), contrôles préventifs, idées d'approvisionnement (types de matériels conformes), et fournis des estimations de coûts si pertinent.
- Reste factuel, structuré, en français, et évite les promesses irréalistes.`
      },
      { role: 'system', content: resumeEquip },
      // historique inverse -> on le remet dans le bon ordre
      ...hist.reverse().map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: String(message) }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "Désolé, je n'ai pas pu générer de réponse utile.";

    // Enregistrer la réponse IA
    await pool.query(
      `insert into atex_chat(equipment_id, role, content) values($1,$2,$3)`,
      [equipmentId, 'assistant', reply]
    );

    res.json({ reply });
  } catch (e) { next(e); }
});

// ---------------------- Gestion des erreurs --------------------------
router.use((err, _req, res, _next) => {
  console.error('[ATEX][ERR]', err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

module.exports = router;
