const express = require('express');
const router = express.Router();
const fs = require('fs');
const { pool } = require('../config/db');
const { calculateAdjustedLifespan } = require('../services/obsolescence');

const REPLACEMENT_FILE = 'replacementDates.json';
let replacementDates = {};
if (fs.existsSync(REPLACEMENT_FILE)) {
  try { replacementDates = JSON.parse(fs.readFileSync(REPLACEMENT_FILE)); } catch {}
}

router.get('/obsolescence', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const tableauxResult = await client.query('SELECT id, disjoncteurs, issitemain FROM tableaux');
    const equipementsResult = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
    const tableaux = tableauxResult.rows.map(row => {
      const disjoncteurs = (Array.isArray(row.disjoncteurs) ? row.disjoncteurs : []).map(d => {
        const date = d.date ? new Date(d.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
        const { adjustedLifespan, isCritical, criticalReason } = calculateAdjustedLifespan(d);
        const status = age !== null && age >= adjustedLifespan ? 'Obsolète' : 'OK';
        let replacementDate = d.replacementDate || replacementDates[`${row.id}-${d.id}`] || null;
        if (!replacementDate) {
          if (status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
          else if (!manufactureYear) replacementDate = `${new Date().getFullYear() + 2}-01-01`;
        }
        return { ...d, manufactureYear, age, status, replacementDate, adjustedLifespan, isCritical, criticalReason };
      });
      const autresEquipements = equipementsResult.rows.filter(e => e.tableau_id === row.id).map(e => {
        const date = e.data.date ? new Date(e.data.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
        const status = age !== null && age >= 30 ? 'Obsolète' : 'OK';
        let replacementDate = replacementDates[`${row.id}-${e.equipment_id}`] || null;
        if (!replacementDate && status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
        return { id: e.equipment_id, equipmentType: e.equipment_type, ...e.data, manufactureYear, age, status, replacementDate };
      });
      const validYears = [...disjoncteurs, ...autresEquipements].map(it => it.manufactureYear).filter(y => typeof y === 'number' && !isNaN(y));
      const avgManufactureYear = validYears.length ? Math.round(validYears.reduce((a,b)=>a+b,0)/validYears.length) : 2000;
      return { id: row.id, building: row.id.split('-')[0] || 'Inconnu', disjoncteurs, autresEquipements, avgManufactureYear, isSiteMain: !!row.issitemain };
    });
    res.json({ data: tableaux });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de l\'analyse: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/obsolescence/update', async (req, res) => {
  const { tableauId, disjoncteurId, equipmentId, replacementDate } = req.body;
  let client; try {
    client = await pool.connect();
    if (!tableauId || (!disjoncteurId && !equipmentId) || !replacementDate) throw new Error('Paramètres requis');
    if (disjoncteurId) {
      const r = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
      if (!r.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
      const disjoncteurs = Array.isArray(r.rows[0].disjoncteurs) ? r.rows[0].disjoncteurs : [];
      const idx = disjoncteurs.findIndex(d => d.id === disjoncteurId);
      if (idx === -1) return res.status(404).json({ error: 'Disjoncteur non trouvé' });
      disjoncteurs[idx].replacementDate = replacementDate;
      await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
    } else if (equipmentId) {
      const r = await client.query('SELECT data FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, equipmentId]);
      if (!r.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
      const data = { ...r.rows[0].data, replacementDate };
      await client.query('UPDATE equipements SET data = $1::jsonb WHERE tableau_id = $2 AND equipment_id = $3', [JSON.stringify(data), tableauId, equipmentId]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/obsolescence/replacement', (req, res) => {
  const { tableauId, replacementYear } = req.body;
  try {
    if (!tableauId || !replacementYear) throw new Error('Paramètres requis');
    const dates = fs.existsSync(REPLACEMENT_FILE) ? JSON.parse(fs.readFileSync(REPLACEMENT_FILE)) : {};
    dates[tableauId] = replacementYear;
    fs.writeFileSync(REPLACEMENT_FILE, JSON.stringify(dates, null, 2));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de l\'enregistrement: ' + e.message }); }
});

module.exports = router;
