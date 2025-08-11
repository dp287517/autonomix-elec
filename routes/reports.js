// routes/reports.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { buildReportsPDF } = require('../services/reports');
const { getRecommendedSection, normalizeIcn } = require('../utils/electric');
const { calculateAdjustedLifespan } = require('../services/obsolescence');

// Petit endpoint santé pour vérifier que le router est bien monté
router.get('/reports/health', (req, res) => {
  res.json({ ok: true, at: 'routes/reports.js' });
});

// Génération PDF
router.post('/reports', async (req, res) => {
  const { reportType = 'all', filters } = req.body || {};
  let client;
  try {
    client = await pool.connect();

    // Données de base
    const tableauxResult = await client.query(
      'SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux'
    );
    const equipementsResult = await client.query(
      'SELECT tableau_id, equipment_id, equipment_type, data FROM equipements'
    );

    let tableauxData = tableauxResult.rows.map(row => {
      const autresEquipements = equipementsResult.rows
        .filter(e => e.tableau_id === row.id)
        .map(e => ({ id: e.equipment_id, equipmentType: e.equipment_type, ...e.data }));

      return {
        id: row.id,
        disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
        autresEquipements,
        building: row.id.split('-')[0] || 'Inconnu',
        issitemain: !!row.issitemain,
        ishta: !!row.ishta,
        htadata: row.htadata || null
      };
    });

    // Filtres optionnels
    if (filters) {
      tableauxData = tableauxData.filter(t => {
        if (filters.building && t.building !== filters.building) return false;
        if (filters.tableau && t.id !== filters.tableau) return false;
        return true;
      });
    }

    // Jeux de données pour le PDF
    const selectivityReportData = tableauxData.map(t => ({
      id: t.id,
      building: t.building,
      disjoncteurs: t.disjoncteurs.map(d => ({
        ...d,
        isPrincipal: !!d.isPrincipal,
        isHTAFeeder: !!d.isHTAFeeder
      }))
    }));

    const obsolescenceReportData = tableauxData.map(t => {
      const disjoncteurs = t.disjoncteurs.map(d => {
        const date = d.date ? new Date(d.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear != null ? (new Date().getFullYear() - manufactureYear) : null;
        const { adjustedLifespan, isCritical, criticalReason } = calculateAdjustedLifespan(d);
        const status = age != null && adjustedLifespan != null && age >= adjustedLifespan ? 'Obsolète' : 'OK';
        let replacementDate = d.replacementDate || null;
        if (!replacementDate) {
          if (status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
          else if (!manufactureYear) replacementDate = `${new Date().getFullYear() + 2}-01-01`;
        }
        return { ...d, manufactureYear, age, status, replacementDate, adjustedLifespan, isCritical, criticalReason };
      });

      const autresEquipements = t.autresEquipements.map(e => {
        const date = e.date ? new Date(e.date) : null;
        const manufactureYear = date ? date.getFullYear() : null;
        const age = manufactureYear != null ? (new Date().getFullYear() - manufactureYear) : null;
        const status = age != null && age >= 30 ? 'Obsolète' : 'OK';
        let replacementDate = e.replacementDate || null;
        if (!replacementDate && status === 'Obsolète') replacementDate = `${new Date().getFullYear() + 1}-01-01`;
        return { ...e, manufactureYear, age, status, replacementDate };
      });

      return { id: t.id, building: t.building, disjoncteurs, autresEquipements, isSiteMain: t.issitemain };
    });

    const faultLevelReportData = tableauxData.map(t => {
      const disjoncteurs = t.disjoncteurs.map(d => {
        let ik = null;
        try {
          if (d.ue && (d.impedance || d.section)) {
            const ueMatch = String(d.ue).match(/[\d.]+/);
            const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;

            let L = isNaN(parseFloat(d.cableLength))
              ? (d.isPrincipal || d.isHTAFeeder) ? 0 : 20
              : parseFloat(d.cableLength);
            if ((d.isPrincipal || d.isHTAFeeder) && L < 0) L = 0;
            else if (!d.isPrincipal && !d.isHTAFeeder && L < 20) L = 20;

            let z;
            if (d.impedance) {
              z = Math.max(parseFloat(d.impedance), 0.05);
            } else {
              const rho = 0.0175;
              const sectionMatch = d.section ? String(d.section).match(/[\d.]+/) : null;
              const S = sectionMatch ? parseFloat(sectionMatch[0]) : getRecommendedSection(d.in);
              const Z_cable = (rho * L * 2) / S;
              const Z_network = 0.01;
              z = Math.max(Z_cable + Z_network, 0.05);
            }
            ik = (ue / (Math.sqrt(3) * z)) / 1000;
            if (ik > 100) ik = null;
          }
        } catch {}
        return { ...d, ik, icn: normalizeIcn(d.icn), tableauId: t.id };
      });

      return { id: t.id, building: t.building, disjoncteurs, isSiteMain: t.issitemain };
    });

    // Safety
    let safetyReportData = [];
    if (reportType === 'all' || reportType === 'safety') {
      const s = await client.query('SELECT * FROM safety_actions');
      safetyReportData = s.rows.map(r => ({
        id: r.id,
        type: r.type,
        description: r.description,
        building: r.building,
        tableau: r.tableau_id,
        status: r.status,
        date: r.date ? r.date.toISOString().split('T')[0] : null
      }));
    }

    // Génère le PDF
    await buildReportsPDF({
      res,
      reportType,
      tableauxData,
      selectivityReportData,
      obsolescenceReportData,
      faultLevelReportData,
      safetyReportData
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la génération du rapport: ' + e.message });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
