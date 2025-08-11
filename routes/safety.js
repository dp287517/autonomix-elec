const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { validateChecklistData } = require('../utils/validation');

router.get('/safety-actions', async (req, res) => {
  const { building, tableau } = req.query;
  let client; try {
    client = await pool.connect();
    let query = 'SELECT * FROM safety_actions'; const params = []; const cond = [];
    if (building) { cond.push(`building = $${params.length+1}`); params.push(building); }
    if (tableau) { cond.push(`tableau_id = $${params.length+1}`); params.push(tableau); }
    if (cond.length) query += ' WHERE ' + cond.join(' AND ');
    const r = await client.query(query, params);
    const actions = r.rows.map(row => ({ id: row.id, type: row.type, description: row.description, building: row.building, tableau: row.tableau_id, status: row.status, date: row.date ? row.date.toISOString().split('T')[0] : null, timestamp: row.timestamp }));
    res.json({ data: actions });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la récupération des actions: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/safety-actions', async (req, res) => {
  const { type, description, building, tableau, status, date } = req.body;
  let client; try {
    client = await pool.connect();
    if (!type || !description || !building || !status) throw new Error('Type, description, bâtiment et statut sont requis');
    if (tableau) {
      const t = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
      if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    }
    const r = await client.query('INSERT INTO safety_actions (type, description, building, tableau_id, status, date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [type, description, building, tableau || null, status, date || null]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'action: ' + e.message }); } finally { if (client) client.release(); }
});

router.put('/safety-actions/:id', async (req, res) => {
  const { id } = req.params;
  const { type, description, building, tableau, status, date } = req.body;
  let client; try {
    client = await pool.connect();
    if (!type || !description || !building || !status) throw new Error('Type, description, bâtiment et statut sont requis');
    if (tableau) {
      const t = await client.query('SELECT id FROM tableaux WHERE id = $1', [tableau]);
      if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    }
    const r = await client.query('UPDATE safety_actions SET type=$1, description=$2, building=$3, tableau_id=$4, status=$5, date=$6 WHERE id=$7 RETURNING *', [type, description, building, tableau || null, status, date || null, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Action non trouvée' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'action: ' + e.message }); } finally { if (client) client.release(); }
});

router.delete('/safety-actions/:id', async (req, res) => {
  const { id } = req.params; let client;
  try {
    client = await pool.connect();
    const r = await client.query('DELETE FROM safety_actions WHERE id = $1 RETURNING *', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Action non trouvée' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la suppression de l\'action: ' + e.message }); } finally { if (client) client.release(); }
});

// Breaker checklists
router.get('/breaker-checklists', async (req, res) => {
  const { tableauId, disjoncteurId } = req.query;
  let client; try {
    client = await pool.connect();
    let query = 'SELECT * FROM breaker_checklists'; const params = []; const cond = [];
    if (tableauId) { cond.push(`tableau_id = $${params.length+1}`); params.push(tableauId); }
    if (disjoncteurId) { cond.push(`disjoncteur_id = $${params.length+1}`); params.push(disjoncteurId); }
    if (cond.length) query += ' WHERE ' + cond.join(' AND ');
    query += ' ORDER BY timestamp DESC';
    const r = await client.query(query, params);
    const checklists = r.rows.map(row => ({ id: row.id, tableau_id: row.tableau_id, disjoncteur_id: row.disjoncteur_id, status: row.status, comment: row.comment, photo: row.photo, timestamp: row.timestamp }));
    res.json(checklists);
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la récupération des checklists: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/breaker-checklists', async (req, res) => {
  const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
  let client; try {
    client = await pool.connect();
    const errs = validateChecklistData(req.body);
    if (errs.length) return res.status(400).json({ error: 'Données invalides: ' + errs.join('; ') });
    const t = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const disjoncteurs = Array.isArray(t.rows[0].disjoncteurs) ? t.rows[0].disjoncteurs : [];
    if (!disjoncteurs.some(d => d.id === disjoncteur_id)) return res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
    const r = await client.query('INSERT INTO breaker_checklists (tableau_id, disjoncteur_id, status, comment, photo) VALUES ($1,$2,$3,$4,$5) RETURNING *', [tableau_id, disjoncteur_id, status, comment, photo || null]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de l\'ajout de la checklist: ' + e.message }); } finally { if (client) client.release(); }
});

router.put('/breaker-checklists/:id', async (req, res) => {
  const { id } = req.params;
  const { tableau_id, disjoncteur_id, status, comment, photo } = req.body;
  let client; try {
    client = await pool.connect();
    const errs = validateChecklistData(req.body);
    if (errs.length) return res.status(400).json({ error: 'Données invalides: ' + errs.join('; ') });
    const t = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableau_id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const disjoncteurs = Array.isArray(t.rows[0].disjoncteurs) ? t.rows[0].disjoncteurs : [];
    if (!disjoncteurs.some(d => d.id === disjoncteur_id)) return res.status(404).json({ error: 'Disjoncteur non trouvé dans ce tableau' });
    const r = await client.query('UPDATE breaker_checklists SET tableau_id=$1, disjoncteur_id=$2, status=$3, comment=$4, photo=$5 WHERE id=$6 RETURNING *', [tableau_id, disjoncteur_id, status, comment, photo || null, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Checklist non trouvée' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la mise à jour de la checklist: ' + e.message }); } finally { if (client) client.release(); }
});

router.delete('/breaker-checklists/:id', async (req, res) => {
  const { id } = req.params;
  let client; try {
    client = await pool.connect();
    const r = await client.query('DELETE FROM breaker_checklists WHERE id = $1 RETURNING *', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Checklist non trouvée' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la suppression de la checklist: ' + e.message }); } finally { if (client) client.release(); }
});

module.exports = router;
