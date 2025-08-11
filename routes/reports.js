const PDFDocument = require('pdfkit');
const fs = require('fs');
const { captureChart } = require('../utils/capture');

async function buildReportsPDF({
  res,
  reportType,
  tableauxData,
  selectivityReportData,
  obsolescenceReportData,
  faultLevelReportData,
  safetyReportData
}) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=rapport_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`
  );
  doc.pipe(res);

  const logoPath = 'logo.png';
  if (fs.existsSync(logoPath)) doc.image(logoPath, 450, 30, { width: 100 });

  doc.fontSize(20).text("Rapport Autonomix Elec", 50, 50);
  doc.moveDown(2);

  if (reportType === 'all' || reportType === 'tableaux') {
    doc.fontSize(16).text("Rapport des Tableaux", 50, doc.y).moveDown();
    doc.fontSize(12).text("Tableau | Bâtiment | Disjoncteurs | Autres Équipements");
    doc.moveDown(0.5);
    tableauxData.forEach(t => {
      doc.text(`${t.id} | ${t.building} | ${t.disjoncteurs.length} | ${t.autresEquipements.length}`);
      t.autresEquipements.forEach(e => {
        const typeText = e.equipmentType || 'Inconnu';
        doc.moveDown(0.2).text(`  - ${e.id} | ${typeText} | ${e.marque || 'N/A'} | ${e.ref || 'N/A'}`);
      });
      doc.moveDown(0.4);
    });
    doc.moveDown();
  }

  if (reportType === 'all' || reportType === 'selectivity') {
    doc.fontSize(16).text("Rapport de Sélectivité", 50, doc.y).moveDown();
    doc.fontSize(12).text("Tableau | Disjoncteur Principal | Statut").moveDown(0.5);
    selectivityReportData.forEach(t => {
      const principal = t.disjoncteurs.find(d => d.isPrincipal || d.isHTAFeeder) || {};
      doc.text(`${t.id} | ${principal.id || 'N/A'} | ${principal.selectivityStatus || 'N/A'}`);
    });
    try {
      const schemaImage = await captureChart('http://localhost:3000/selectivity.html', '#network-schema');
      doc.addPage().fontSize(16).text("Schéma Électrique", 50, 50);
      doc.image(schemaImage, 50, 100, { width: 500 });
    } catch {}
  }

  if (reportType === 'all' || reportType === 'obsolescence') {
    doc.fontSize(16).text("Rapport d'Obsolescence", 50, doc.y).moveDown();
    doc.fontSize(12).text("Tableau | Équipement | Type | Âge | Statut | Date de remplacement").moveDown(0.5);
    obsolescenceReportData.forEach(t => {
      t.disjoncteurs.forEach(d => {
        doc.text(`${t.id} | ${d.id} | Disjoncteur | ${d.age || 'N/A'} | ${d.status} | ${d.replacementDate || 'N/A'}`);
      });
      t.autresEquipements.forEach(e => {
        doc.text(`${t.id} | ${e.id} | ${e.equipmentType || 'Inconnu'} | ${e.age || 'N/A'} | ${e.status} | ${e.replacementDate || 'N/A'}`);
      });
    });
    try {
      const capexImage = await captureChart('http://localhost:3000/obsolescence.html', '#gantt-table');
      doc.addPage().fontSize(16).text("Prévision CAPEX", 50, 50);
      doc.image(capexImage, 50, 100, { width: 500 });
    } catch {}
  }

  if (reportType === 'all' || reportType === 'fault_level') {
    doc.fontSize(16).text("Rapport d'Évaluation du Niveau de Défaut", 50, doc.y).moveDown();
    doc.fontSize(12).text("Tableau | Disjoncteur | Ik (kA) | Icn (kA) | Statut").moveDown(0.5);
    faultLevelReportData.forEach(t => {
      t.disjoncteurs.forEach(d => {
        const statut = d.ik && d.icn ? (d.ik > d.icn ? 'KO' : 'OK') : 'N/A';
        doc.text(`${t.id} | ${d.id} | ${d.ik || 'N/A'} | ${d.icn || 'N/A'} | ${statut}`);
      });
    });
    try {
      const bubbleImage = await captureChart('http://localhost:3000/fault_level_assessment.html', '#bubble-chart');
      doc.addPage().fontSize(16).text("Graphique Ik vs Icn", 50, 50);
      doc.image(bubbleImage, 50, 100, { width: 500 });
    } catch {}
  }

  if (reportType === 'all' || reportType === 'safety') {
    doc.fontSize(16).text("Rapport de Sécurité Électrique", 50, doc.y).moveDown();
    doc.fontSize(12).text("Type | Description | Bâtiment | Tableau | Statut").moveDown(0.5);
    safetyReportData.forEach(a => {
      doc.text(`${a.type} | ${a.description} | ${a.building} | ${a.tableau || 'N/A'} | ${a.status}`);
    });
    try {
      const statusImage = await captureChart('http://localhost:3000/electrical_safety_program.html', '#status-chart');
      doc.addPage().fontSize(16).text("Répartition des Statuts", 50, 50);
      doc.image(statusImage, 50, 100, { width: 500 });
    } catch {}
  }

  doc.end();
}

module.exports = { buildReportsPDF };
