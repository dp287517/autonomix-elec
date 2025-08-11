const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { buildReportsPDF } = require('../services/reports');
const { calculateAdjustedLifespan } = require('../services/obsolescence');
const { getRecommendedSection, normalizeIcn } = require('../utils/electric');

router.post('/reports', async (req, res) => {
  const { reportType, filters } = req.body;
  let client; try {
    client = await pool.connect();
    const tableauxResult = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
    const equipementsResult = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
    let tableauxData = tableauxResult.rows.map(row => {
      const autresEquipements = equipementsResult.rows.filter(e => e.tableau_id === row.id).map(e => ({ id: e.equipment_id, equipmentType: e.equipment_type, ...e.data }));
      return { ...row, disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [], autresEquipements, building: row.id.split('-')[0] || 'Inconnu' };
    });

    // Préparer datasets secondaires
    let selectivityReportData = tableauxData;
    let obsolescenceReportData = tableauxData.map(row => {
      const disjoncteurs = row.disjoncteurs.map(d => {
        const date = d.date ? new Date(d.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
        const { adjustedLifespan, isCritical, criticalReason } = calculateAdjustedLifespan(d);
        const status = age !== null && age >= adjustedLifespan ? 'Obsolète' : 'OK';
        let replacementDate = d.replacementDate || null;
        if (!replacementDate) {
          if (status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
          else if (!manufactureYear) replacementDate = `${new Date().getFullYear() + 2}-01-01`;
        }
        return { ...d, manufactureYear, age, status, replacementDate, adjustedLifespan, isCritical, criticalReason };
      });
      const autresEquipements = row.autresEquipements.map(e => {
        const date = e.date ? new Date(e.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear !== null ? (new Date().getFullYear() - manufactureYear) : null;
        const status = age !== null && age >= 30 ? 'Obsolète' : 'OK';
        let replacementDate = e.replacementDate || null;
        if (!replacementDate && status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
        return { ...e, manufactureYear, age, status, replacementDate };
      });
      return { id: row.id, building: row.building, disjoncteurs, autresEquipements, isSiteMain: !!row.issitemain };
    });
    let faultLevelReportData = tableauxData.map(row => {
      const disjoncteurs = row.disjoncteurs.map(d => {
        let ik = null;
        if (d.ue && (d.impedance || d.section)) {
          const ueMatch = String(d.ue).match(/[\d.]+/);
          const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
          let z;
          let L = isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength);
          if (d.impedance) {
            z = parseFloat(d.impedance); if (z < 0.05) z = 0.05;
          } else {
            const rho = 0.0175;
            const sectionMatch = d.section ? String(d.section).match(/[\d.]+/) : null;
            const S = sectionMatch ? parseFloat(sectionMatch[0]) : getRecommendedSection(d.in);
            const Z_cable = (rho * L * 2) / S; const Z_network = 0.01; z = Z_cable + Z_network; if (z < 0.05) z = 0.05;
          }
          ik = (ue / (Math.sqrt(3) * z)) / 1000; if (ik > 100) ik = null;
        }
        return { ...d, ik, icn: normalizeIcn(d.icn), tableauId: row.id };
      });
      return { id: row.id, building: row.building, disjoncteurs, isSiteMain: !!row.issitemain };
    });
    let safetyReportData = [];
    if (reportType === 'all' || reportType === 'safety') {
      const s = await client.query('SELECT * FROM safety_actions');
      safetyReportData = s.rows.map(r => ({ id: r.id, type: r.type, description: r.description, building: r.building, tableau: r.tableau_id, status: r.status, date: r.date ? r.date.toISOString().split('T')[0] : null }));
    }

    // Filtres (optionnels)
    if (filters) {
      tableauxData = tableauxData.filter(tableau => {
        let keep = true;
        if (filters.building && tableau.building !== filters.building) keep = false;
        if (filters.tableau && tableau.id !== filters.tableau) keep = false;
        return keep;
      });
    }

    await buildReportsPDF({ res, reportType, tableauxData, selectivityReportData, obsolescenceReportData, faultLevelReportData, safetyReportData });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la génération du rapport: ' + e.message });
  } finally {
    // puppeteer fermé côté service au besoin
  }
});

module.exports = router;
