// routes/atex.js — clean version
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');

const upload = multer();
const router = express.Router();

function getPool(req) {
  if (req.app && req.app.locals && req.app.locals.pool) return req.app.locals.pool;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
}

// -------------------- LIST / GET ONE --------------------
router.get('/atex-equipments', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(`
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
             identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
             photo, conformite, comments, last_inspection_date, next_inspection_date,
             risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
             zone_poussieres, ia_history, attachments,
             (ia_history IS NOT NULL AND jsonb_typeof(ia_history)='array' AND jsonb_array_length(ia_history) > 0) AS has_ia_history,
             COALESCE(jsonb_array_length(attachments), 0) AS attachments_count
      FROM public.atex_equipments
      ORDER BY id DESC
    `);
    rows.forEach(r => {
      if (r.zone_poussieres == null && r.zone_poussiere && /^\d+$/.test(r.zone_poussiere)) {
        r.zone_poussieres = parseInt(r.zone_poussiere, 10);
      }
    });
    res.json(rows);
  } catch (e) {
    console.error('GET /atex-equipments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-equipments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(`
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type,
             identifiant, interieur, exterieur, categorie_minimum, marquage_atex,
             photo, conformite, comments, last_inspection_date, next_inspection_date,
             risk_assessment, grade, frequence, zone_type, zone_gaz, zone_poussiere,
             zone_poussieres, ia_history, attachments
      FROM public.atex_equipments WHERE id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const r = rows[0];
    if (r.zone_poussieres == null && r.zone_poussiere && /^\d+$/.test(r.zone_poussiere)) {
      r.zone_poussieres = parseInt(r.zone_poussiere, 10);
    }
    res.json(r);
  } catch (e) {
    console.error('GET /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- CREATE / UPDATE / DELETE --------------------
function nullIfEmpty(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function normZoneG(v) {
  const s = nullIfEmpty(v);
  if (!s) return null;
  const m = String(s).match(/^(0|1|2)$/);
  return m ? m[1] : null;
}
function normZoneD(v) {
  const s = nullIfEmpty(v);
  if (!s) return null;
  const m = String(s).match(/^(20|21|22)$/);
  return m ? m[1] : null;
}

router.post('/atex-equipments', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);
    const { rows } = await pool.query(
      `INSERT INTO public.atex_equipments
       (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
        interieur, exterieur, categorie_minimum, marquage_atex, photo, conformite,
        comments, last_inspection_date, next_inspection_date, risk_assessment, grade,
        frequence, zone_type, zone_gaz, zone_poussiere, ia_history, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10,NULL,$11,$12,NULL,NULL,NULL,'V',
               COALESCE($13,3),$14,$15,$16,$17)
       RETURNING id`,
      [
        nullIfEmpty(b.risque),
        nullIfEmpty(b.secteur), nullIfEmpty(b.batiment), nullIfEmpty(b.local),
        nullIfEmpty(b.composant), nullIfEmpty(b.fournisseur), nullIfEmpty(b.type),
        nullIfEmpty(b.identifiant),
        nullIfEmpty(b.categorie_minimum), nullIfEmpty(b.marquage_atex),
        nullIfEmpty(b.conformite), nullIfEmpty(b.comments),
        b.frequence ? parseInt(b.frequence, 10) : null,
        nullIfEmpty(b.zone_type), zg, zd,
        null, null
      ]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    console.error('POST /atex-equipments', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/atex-equipments/:id', upload.none(), async (req, res) => {
  const pool = getPool(req);
  try {
    const b = req.body || {};
    const zg = normZoneG(b.zone_gaz ?? b.exterieur);
    const zd = normZoneD(b.zone_poussiere ?? b.zone_poussieres ?? b.interieur);
    const result = await pool.query(
      `UPDATE public.atex_equipments SET
        risque=$2, secteur=$3, batiment=$4, local=$5, composant=$6, fournisseur=$7, type=$8,
        identifiant=$9, categorie_minimum=$10, marquage_atex=$11, conformite=$12, comments=$13,
        grade=COALESCE($14,'V'), frequence=COALESCE($15,3), zone_type=$16, zone_gaz=$17, zone_poussiere=$18
       WHERE id = $1`,
      [
        req.params.id,
        nullIfEmpty(b.risque),
        nullIfEmpty(b.secteur), nullIfEmpty(b.batiment), nullIfEmpty(b.local),
        nullIfEmpty(b.composant), nullIfEmpty(b.fournisseur), nullIfEmpty(b.type),
        nullIfEmpty(b.identifiant),
        nullIfEmpty(b.categorie_minimum), nullIfEmpty(b.marquage_atex),
        nullIfEmpty(b.conformite), nullIfEmpty(b.comments),
        nullIfEmpty(b.grade),
        b.frequence ? parseInt(b.frequence, 10) : null,
        nullIfEmpty(b.zone_type), zg, zd
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/atex-equipments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rowCount } = await pool.query('DELETE FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /atex-equipments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- IA HISTORY --------------------
router.get('/atex-ia-history/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT ia_history FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(Array.isArray(rows[0].ia_history) ? rows[0].ia_history : []);
  } catch (e) {
    console.error('GET /atex-ia-history/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.patch('/atex-ia-history/:id', express.json(), async (req, res) => {
  const pool = getPool(req);
  try {
    const item = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      ...req.body?.message
    };
    await pool.query(
      `UPDATE public.atex_equipments
         SET ia_history = COALESCE(ia_history, '[]'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [req.params.id, JSON.stringify([item])]
    );
    res.json({ ok: true, appended: item });
  } catch (e) {
    console.error('PATCH /atex-ia-history/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- ATTACHMENTS --------------------
router.get('/atex-attachments/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments, photo FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const att = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const legacy = rows[0].photo ? [{ id: 'legacy-photo', name: 'photo', mime: 'image/jpeg', url: rows[0].photo }] : [];
    res.json(att.length ? att : legacy);
  } catch (e) {
    console.error('GET /atex-attachments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/atex-attachments/:id', upload.any(), async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const files = Array.isArray(req.files) ? req.files : [];
    const toAdd = files.map(f => ({
      id: uuidv4(),
      name: f.originalname || 'fichier',
      mime: f.mimetype || 'application/octet-stream',
      url: `data:${f.mimetype || 'application/octet-stream'};base64,${f.buffer.toString('base64')}`
    }));
    const final = current.concat(toAdd);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(final)]);
    res.json({ ok: true, added: toAdd.length });
  } catch (e) {
    console.error('POST /atex-attachments/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/atex-attachments/:id/:attId', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const next = current.filter(x => x && x.id !== req.params.attId);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(next)]);
    res.json({ ok: true, removed: current.length - next.length });
  } catch (e) {
    console.error('DELETE /atex-attachments/:id/:attId', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Export CSV
router.get('/atex-attachments/:id/export.csv', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const atts = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const header = 'id,name,mime,url\\n';
    const q = s => '"' + String(s ?? '').replace(/"/g,'""') + '"';
    const csv = header + atts.map(a => [q(a.id), q(a.name), q(a.mime), q(a.url)].join(',')).join('\\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attachments_${req.params.id}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('GET /atex-attachments/:id/export.csv', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Export XLSX
router.get('/atex-attachments/:id/export.xlsx', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const atts = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const wsData = [['id','name','mime','url'], ...atts.map(a => [a.id, a.name, a.mime, a.url])];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'attachments');
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attachments_${req.params.id}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('GET /atex-attachments/:id/export.xlsx', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Import links JSON
router.post('/atex-attachments/:id/links', express.json({ limit: '2mb' }), async (req, res) => {
  const pool = getPool(req);
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    if (!links.length) return res.status(400).json({ error: 'no_links' });
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const toAdd = links.map(l => ({
      id: uuidv4(),
      name: l.name || l.url || 'lien',
      mime: l.mime || 'text/uri-list',
      url: l.url
    })).filter(x => !!x.url);
    const final = current.concat(toAdd);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(final)]);
    res.json({ ok: true, added: toAdd.length });
  } catch (e) {
    console.error('POST /atex-attachments/:id/links', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Import CSV (file field 'file')
router.post('/atex-attachments/:id/import', upload.single('file'), async (req, res) => {
  const pool = getPool(req);
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const text = req.file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    let start = 0;
    const header = (lines[0] || '').toLowerCase();
    if (header.includes('id') && header.includes('name') && header.includes('url')) start = 1;
    const parsed = [];
    for (let i = start; i < lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.replace(/^"|"$/g,'').replace(/""/g,'"'));
      const id = parts[0] || '';
      const name = parts[1] || '';
      const mime = parts[2] || 'text/uri-list';
      const url = parts[3] || '';
      if (url) parsed.push({ id, name: name || url, mime, url });
    }
    const { rows } = await pool.query('SELECT attachments FROM public.atex_equipments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const toAdd = parsed.map(l => ({ id: l.id || uuidv4(), name: l.name, mime: l.mime, url: l.url }));
    const final = current.concat(toAdd);
    await pool.query('UPDATE public.atex_equipments SET attachments = $2 WHERE id = $1', [req.params.id, JSON.stringify(final)]);
    res.json({ ok: true, added: toAdd.length });
  } catch (e) {
    console.error('POST /atex-attachments/:id/import', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- SECTEURS --------------------
router.get('/atex-secteurs', async (req, res) => {
  const pool = getPool(req);
  try {
    const eq = await pool.query(`SELECT DISTINCT secteur AS name FROM public.atex_equipments WHERE secteur IS NOT NULL AND trim(secteur) <> ''`);
    let list = eq.rows.map(r => ({ name: r.name }));
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS public.atex_sectors (id SERIAL PRIMARY KEY, name VARCHAR UNIQUE)`);
      const sx = await pool.query(`SELECT name FROM public.atex_sectors WHERE name IS NOT NULL AND trim(name) <> ''`);
      const extra = new Set(sx.rows.map(r => r.name));
      const known = new Set(list.map(o => o.name));
      for (const n of extra) if (!known.has(n)) list.push({ name: n });
    } catch(_e) {}
    list.sort((a,b)=> a.name.localeCompare(b.name, 'fr'));
    res.json(list);
  } catch (e) {
    console.error('GET /atex-secteurs', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/atex-secteurs', express.json(), async (req, res) => {
  const pool = getPool(req);
  try {
    const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    await pool.query(`CREATE TABLE IF NOT EXISTS public.atex_sectors (id SERIAL PRIMARY KEY, name VARCHAR UNIQUE)`);
    await pool.query(`INSERT INTO public.atex_sectors(name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
    res.json({ ok: true, name });
  } catch (e) {
    console.error('POST /atex-secteurs', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// -------------------- HELP (4 cards) --------------------
router.get('/atex-help/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const { rows } = await pool.query(
      `SELECT id, composant, marquage_atex, conformite, zone_type, zone_gaz, zone_poussiere, zone_poussieres
         FROM public.atex_equipments WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const e = rows[0];
    const zg = String(e.zone_gaz || e.zone_type || '');
    const zd = String(e.zone_poussiere || (e.zone_poussieres != null ? String(e.zone_poussieres) : ''));

    function reqCat(g, d){
      const gm = (g || '').match(/^(0|1|2)$/);
      const dm = (d || '').match(/^(20|21|22)$/);
      if (gm && gm[1] === '0') return 'II 1GD';
      if (dm && dm[1] === '20') return 'II 1GD';
      if (gm && gm[1] === '1') return 'II 2GD';
      if (dm && dm[1] === '21') return 'II 2GD';
      return 'II 3GD';
    }
    const cat = reqCat(zg, zd);
    const isNC = (String(e.conformite || '').toLowerCase().includes('non'));

    const cards = [
      {
        title: 'Pourquoi',
        body: (isNC ? 'Non-conformité détectée.' : 'Aucune non-conformité déclarée.')
          + (zg ? '<br>Zone gaz: <strong>'+zg+'</strong>' : '')
          + (zd ? '<br>Zone poussières: <strong>'+zd+'</strong>' : '')
          + (e.marquage_atex ? '<br>Marquage actuel: <em>'+e.marquage_atex+'</em>' : '')
      },
      {
        title: 'Mesures palliatives',
        list: isNC ? [
          'Sécuriser la zone et éviter toute source d’inflammation.',
          'Mettre en place une surveillance accrue jusqu’au remplacement.'
        ] : ['Aucune mesure palliative requise.']
      },
      {
        title: 'Mesures préventives',
        list: isNC ? [
          'Choisir matériel avec marquage compatible (Ex, catégorie, T-class).',
          'Mettre à jour documentation et marquage local.'
        ] : ['Maintenir la conformité via inspection périodique.']
      },
      {
        title: 'Catégorie requise (estimée)',
        body: 'Pour ces zones, la catégorie minimale recommandée est <strong>'+cat+'</strong>.'
      }
    ];
    const html = '<div class="mb-3">'
  + '<h6 class="mb-1">Explication synthétique</h6>'
  + '<div class="small">Ce résumé présente l’état de conformité, les raisons principales et les actions recommandées. Les quatre cartes ci‑dessous détaillent <em>Pourquoi</em>, les <em>Mesures palliatives</em>, les <em>Mesures préventives</em>, et la <em>Catégorie requise</em> estimée en fonction des zones ATEX.</div>'
  + '</div>' + '<div class="row g-3">'
      + cards.map(c =>
        '<div class="col-md-6"><div class="border rounded p-3 h-100">'
        + '<strong>'+c.title+'</strong>'
        + (c.body ? '<div class="mt-2">'+c.body+'</div>' : '')
        + (Array.isArray(c.list) ? '<ul class="mb-0 mt-2">'+c.list.map(li=>'<li>'+li+'</li>').join('')+'</ul>' : '')
        + '</div></div>'
      ).join('')
      + '</div>';
    res.json({ response: html, meta: { categorie_requise: cat } });
  } catch (e) {
    console.error('GET /atex-help/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});


// -------------------- INSPECTION (fix 404) --------------------

router.post('/atex-inspect', express.json(), async (req, res) => {
  const pool = getPool(req);
  try {
    const id = Number(req.body?.equipment_id || req.query?.equipment_id);
    if (!id) return res.status(400).json({ error: 'equipment_id_required' });
    const date = (req.body?.inspection_date || req.query?.inspection_date || new Date().toISOString().slice(0,10)).slice(0,10);
    const { rowCount } = await pool.query(
      `UPDATE public.atex_equipments
         SET last_inspection_date = $2
       WHERE id = $1`,
      [id, date]
    );
    if (!rowCount) return res.status(404).json({ error: 'equipment_not_found' });
    res.json({ ok: true, inspection_date: date });
  } catch (e) {
    console.error('POST /atex-inspect', e);
    res.status(500).json({ error: 'server_error' });
  }
});
router.post('/atex-photo/:id', upload.single('photo'), async (req, res) => {
  const pool = getPool(req);
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_id' });
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    await pool.query(`UPDATE public.atex_equipments SET photo = $2 WHERE id = $1`, [id, dataUrl]);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /atex-photo/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/atex-photo/:id', async (req, res) => {
  const pool = getPool(req);
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT photo FROM public.atex_equipments WHERE id = $1`, [id]);
    if (!rows.length || !rows[0].photo) return res.status(404).json({ error: 'not_found' });
    // photo is a data URL; just return JSON for simplicity
    res.json({ url: rows[0].photo });
  } catch (e) {
    console.error('GET /atex-photo/:id', e);
    res.status(500).json({ error: 'server_error' });
  }
});


// -------------------- IA CHAT --------------------
async function callOpenAI(prompt) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return "Résumé automatique indisponible (clé OpenAI absente).\n\n• État: synthèse locale\n• Actions: vérifier marquage ATEX, zones gaz/poussières, fréquence d’inspection.";
    }
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{role:'system', content:'Tu es un assistant ATEX. Rédige en français.'},{role:'user', content: prompt}], temperature: 0.2 })
    });
    const j = await r.json();
    return j.choices?.[0]?.message?.content || 'Réponse IA indisponible.';
  } catch (e) { console.error('callOpenAI error', e); return 'Réponse IA indisponible pour le moment.'; }
}
async function pushIAHistory(pool, id, role, content) {
  await pool.query(`UPDATE public.atex_equipments
     SET ia_history = COALESCE(ia_history, '[]'::jsonb) || jsonb_build_object('ts', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS'),'role', $2, 'content', $3)
     WHERE id = $1`, [id, role, content]);
}

router.post('/atex-chat', express.json(), async (req, res) => {
  const pool = getPool(req);
  try {
    const question = (req.body?.question || '').trim();
    const id = Number(req.body?.id || req.body?.equipment_id || 0);
    const message = (req.body?.message || question || '').trim();
    if (!message) return res.status(400).json({ error:'question_required' });

    if (id) { await pushIAHistory(pool, id, 'user', message); }

    const ctx = id ? `Contexte: Equipement ATEX #${id}. ` : '';
    const prompt = `${ctx}${message}\n\nStructure attendue: 
    1) Titre: Explication synthétique (5-6 phrases concises, sans HTML superflu). 
    2) 4 blocs: Pourquoi ? | Mesures palliatives | Mesures préventives | Catégorie requise (1 phrase). 
    Style pro, français.`;

    const reply = await callOpenAI(prompt);
    if (id) { await pushIAHistory(pool, id, 'assistant', reply); }

    res.json({ response: reply });
  } catch (e) {
    console.error('POST /atex-chat', e);
    res.status(500).json({ error: 'server_error' });
  }
});
router.delete('/atex-chat/:id', async (req, res) => {
  const pool = getPool(req);
  try { const id = Number(req.params.id); if(!id) return res.status(400).json({ error:'bad_id' });
    await pool.query(`UPDATE public.atex_equipments SET ia_history='[]'::jsonb WHERE id=$1`, [id]);
    res.json({ ok:true });
  } catch (e) { console.error('DELETE /atex-chat/:id', e); res.status(500).json({ error: 'server_error' }); }
});
module.exports = router;
