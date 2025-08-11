const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

router.post('/emergency-report', async (req, res) => {
  const { tableauId, disjoncteurId, description } = req.body;
  let client; try {
    client = await pool.connect();
    if (!tableauId || !disjoncteurId || !description) throw new Error('Paramètres requis');
    const t = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableauId]);
    if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const td = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
    const disjoncteurs = Array.isArray(td.rows[0].disjoncteurs) ? td.rows[0].disjoncteurs : [];
    if (!disjoncteurs.some(d => d.id === disjoncteurId)) return res.status(404).json({ error: 'Disjoncteur non trouvé' });
    const r = await client.query('INSERT INTO emergency_reports (tableau_id, disjoncteur_id, description, status) VALUES ($1,$2,$3,$4) RETURNING *', [tableauId, disjoncteurId, description, 'En attente']);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors du signalement de la panne: ' + e.message }); } finally { if (client) client.release(); }
});

router.get('/emergency-reports', async (req, res) => {
  const { tableauId, status } = req.query;
  let client; try {
    client = await pool.connect();
    let query = 'SELECT * FROM emergency_reports'; const params = []; const cond = [];
    if (tableauId) { cond.push(`tableau_id = $${params.length+1}`); params.push(tableauId); }
    if (status) { cond.push(`status = $${params.length+1}`); params.push(status); }
    if (cond.length) query += ' WHERE ' + cond.join(' AND ');
    query += ' ORDER BY timestamp DESC';
    const r = await client.query(query, params);
    const reports = r.rows.map(row => ({ id: row.id, tableau_id: row.tableau_id, disjoncteur_id: row.disjoncteur_id, description: row.description, status: row.status, timestamp: row.timestamp }));
    res.json({ data: reports });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la récupération des rapports: ' + e.message }); } finally { if (client) client.release(); }
});

router.put('/emergency-reports/:id', async (req, res) => {
  const { id } = req.params;
  const { status, description } = req.body;
  let client; try {
    client = await pool.connect();
    if (!status) throw new Error('Statut requis');
    const r = await client.query('UPDATE emergency_reports SET status = $1, description = $2 WHERE id = $3 RETURNING *', [status, description || null, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Rapport non trouvé' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la mise à jour du rapport: ' + e.message }); } finally { if (client) client.release(); }
});

module.exports = router;
