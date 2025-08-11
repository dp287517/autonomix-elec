const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { pool } = require('../config/db');
const { validateProjectData } = require('../utils/validation');
const { openai } = require('../config/openai');

router.get('/projects', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const r = await client.query('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erreur récupération projets: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/projects', async (req, res) => {
  const data = req.body; let client;
  try {
    client = await pool.connect();
    const errors = validateProjectData(data);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const r = await client.query('INSERT INTO projects (name, description, business_case, pip, wbs_number, gantt_data, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [data.name, data.description || '', data.business_case || '', data.pip || '', data.wbs_number || '', JSON.stringify(data.gantt_data || {}), data.status || 'En cours']);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erreur création projet: ' + e.message }); } finally { if (client) client.release(); }
});

router.put('/projects/:id', async (req, res) => {
  const { id } = req.params; const data = req.body; let client;
  try {
    client = await pool.connect();
    const errors = validateProjectData(data);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    let budget_spent; if (Array.isArray(data.quotes)) budget_spent = data.quotes.reduce((s,q)=> s + (q.status === 'Approuvé' ? (parseFloat(q.montant)||0) : 0), 0);
    const setClauses = []; const values = []; let i=1;
    for (const k of ['name','description','business_case','pip','wbs_number','po_requests','quotes','attachments','gantt_data','budget_total','status',
      'business_case_approved','pip_approved','wbs_created','po_launched','project_phase_completed','reception_completed','closure_completed']) {
      if (k in data) {
        if (['po_requests','quotes','attachments','gantt_data'].includes(k)) { setClauses.push(`${k} = $${i++}::jsonb`); values.push(JSON.stringify(data[k] || (k==='gantt_data'?{}:[]))); }
        else if (['business_case_approved','pip_approved','wbs_created','po_launched','project_phase_completed','reception_completed','closure_completed'].includes(k)) { setClauses.push(`${k} = $${i++}`); values.push(!!data[k]); }
        else if (k === 'budget_total') { setClauses.push(`${k} = $${i++}`); values.push(parseFloat(data[k]) || 0); }
        else { setClauses.push(`${k} = $${i++}`); values.push(data[k]); }
      }
    }
    if (budget_spent !== undefined) { setClauses.push(`budget_spent = $${i++}`); values.push(budget_spent); }
    if (!setClauses.length) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
    const q = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`; values.push(id);
    const r = await client.query(q, values);
    if (!r.rows.length) return res.status(404).json({ error: 'Projet non trouvé' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erreur mise à jour projet: ' + e.message }); } finally { if (client) client.release(); }
});

router.delete('/projects/:id', async (req, res) => {
  const { id } = req.params; let client;
  try {
    client = await pool.connect();
    const r = await client.query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Projet non trouvé' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression projet: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/projects/:id/attachment', upload.single('file'), async (req, res) => {
  const { id } = req.params; const file = req.file; let client;
  try {
    client = await pool.connect();
    if (!file) return res.status(400).json({ error: 'Fichier requis' });
    const base64 = file.buffer.toString('base64');
    const attachment = { filename: file.originalname, data: `data:${file.mimetype};base64,${base64}`, type: file.mimetype };
    const r = await client.query('SELECT attachments FROM projects WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Projet non trouvé' });
    const attachments = [...(r.rows[0].attachments || []), attachment];
    await client.query('UPDATE projects SET attachments = $1::jsonb WHERE id = $2', [JSON.stringify(attachments), id]);
    res.json({ success: true, attachment });
  } catch (e) { res.status(500).json({ error: 'Erreur upload: ' + e.message }); } finally { if (client) client.release(); }
});

router.get('/project-stats', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const p = await client.query('SELECT * FROM projects');
    const stats = {
      totalProjects: p.rows.length,
      approvedBusinessCases: p.rows.filter(x => x.business_case_approved).length,
      totalBudget: p.rows.reduce((s, x) => s + (parseFloat(x.budget_total)||0), 0),
      spentBudget: p.rows.reduce((s, x) => s + (parseFloat(x.budget_spent)||0), 0),
      statusDistribution: p.rows.reduce((acc, x) => { acc[x.status] = (acc[x.status]||0)+1; return acc; }, {}),
    };
    res.json(stats);
  } catch (e) { res.status(500).json({ error: 'Erreur stats: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/project-analyze', async (req, res) => {
  const { projectData } = req.body;
  try {
    const prompt = `Analyse ce projet en date du July 10, 2025: Nom: ${projectData.name}. Description: ${projectData.description}. Business Case: ${projectData.business_case}. PIP: ${projectData.pip}. WBS: ${projectData.wbs_number}. Budget: ${projectData.budget_total} (spent: ${projectData.budget_spent}). Gantt: ${JSON.stringify(projectData.gantt_data)}. Donne un avis détaillé, risques potentiels, score /100, suggestions pour amélioration. Format JSON: {avis: string, risques: array, score: number, suggestions: array}`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const analysis = JSON.parse(response.choices[0].message.content);
    res.json(analysis);
  } catch (e) { res.status(500).json({ error: 'Erreur analyse AI: ' + e.message }); }
});

module.exports = router;
