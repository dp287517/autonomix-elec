// routes/atex_epd.js
// Routeur ATEX minimal pour la page EPD (évite les conflits avec routes/atex.js d'atex-control)
const express = require('express');
const router = express.Router();

let pool, initDb, openaiCfg;
try { pool = require('../config/db').pool; } catch { pool = require('../db').pool; } // fallback si arbo différente
try { initDb = require('../initDb'); } catch { initDb = async () => {}; }
try { openaiCfg = require('../config/openai'); } catch { openaiCfg = require('../openai'); }

const MAX_LIMIT = 500;
let dbReady = false;
async function ensureDb(){
  if (dbReady) return;
  if (initDb && pool) await initDb(pool);
  dbReady = true;
}

/** GET /api/atex-equipments — liste filtrable (limité à 500) */
router.get('/atex-equipments', async (req, res, next) => {
  try {
    await ensureDb();
    const { secteur, batiment, local, conformite, q } = req.query || {};
    const where = [];
    const params = [];

    function add(col, val, op='='){
      if (val==null || val==='') return;
      if (op === 'ILIKE') {
        params.push(`%${val}%`);
        where.push(`${col} ILIKE $${params.length}`);
      } else {
        params.push(val);
        where.push(`${col} = $${params.length}`);
      }
    }
    add('secteur', secteur, 'ILIKE');
    add('batiment', batiment, 'ILIKE');
    add('local', local, 'ILIKE');
    add('conformite', conformite, '=');

    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      where.push(`(composant ILIKE $${idx} OR marquage_atex ILIKE $${idx} OR fournisseur ILIKE $${idx} OR identifiant ILIKE $${idx})`);
    }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      SELECT id, risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
             interieur, exterieur, categorie_minimum, marquage_atex, conformite,
             zone_type, zone_gaz, zone_poussiere, zone_poussieres
      FROM public.atex_equipments
      ${w}
      ORDER BY id DESC
      LIMIT ${MAX_LIMIT};
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

/** POST /api/atex-equipments — création minimale */
router.post('/atex-equipments', async (req, res, next) => {
  try {
    await ensureDb();
    const b = req.body || {};
    const sql = `
      INSERT INTO public.atex_equipments
      (risque, secteur, batiment, local, composant, fournisseur, type, identifiant,
       interieur, exterieur, categorie_minimum, marquage_atex, conformite,
       zone_type, zone_gaz, zone_poussiere, zone_poussieres)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *;
    `;
    const params = [
      b.risque ?? null, b.secteur ?? null, b.batiment ?? null, b.local ?? null,
      b.composant ?? null, b.fournisseur ?? null, b.type ?? null, b.identifiant ?? null,
      b.interieur ?? null, b.exterieur ?? null, b.categorie_minimum ?? null, b.marquage_atex ?? null,
      b.conformite ?? null, b.zone_type ?? null, b.zone_gaz ?? null, b.zone_poussiere ?? null, b.zone_poussieres ?? null
    ];
    const r = await pool.query(sql, params);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

/** POST /api/atex-chat — IA (fallback local si pas de clé) */
router.post('/atex-chat', async (req, res, next) => {
  try {
    const { question, equipment, history } = req.body || {};
    const chat = openaiCfg?.chat;
    if (typeof chat === 'function') {
      const html = await chat({ question: question || 'Analyse ATEX', equipment: equipment || null, history: history || [] });
      res.json({ response: html });
    } else {
      // Fallback ultra simple
      res.json({
        response: `<div class="small text-muted">IA locale</div>
<article>
  <h5>Réponse (fallback)</h5>
  <p>Question : <code>${(question||'—')}</code></p>
  <p>Équipement : <code>${equipment?.identifiant || equipment?.composant || '—'}</code></p>
  <p>Historique : ${Array.isArray(history) ? history.length : 0} message(s).</p>
</article>`
      });
    }
  } catch (e) { next(e); }
});

module.exports = router;
