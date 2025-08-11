function validateDisjoncteurData(data) {
  const errors = [];
  if (data.ip && !['IP20','IP40','IP54','IP65'].includes(data.ip)) errors.push('Indice de protection invalide.');
  if (data.temp && (isNaN(parseFloat(data.temp)) || parseFloat(data.temp) < 0)) errors.push('Température invalide.');
  const getNum = v => parseFloat(String(v||'').match(/[\d.]+/)?.[0]);
  if (data.ue && (isNaN(getNum(data.ue)) || getNum(data.ue) < 0)) errors.push('Tension nominale invalide.');
  if (data.section && (isNaN(getNum(data.section)) || getNum(data.section) < 0)) errors.push('Section invalide.');
  if (data.cableLength && (isNaN(parseFloat(data.cableLength)) || parseFloat(data.cableLength) < 0)) errors.push('Longueur de câble invalide.');
  if (data.humidite && (isNaN(parseFloat(data.humidite)) || data.humidite < 0 || data.humidite > 100)) errors.push('Humidité invalide.');
  if (data.temp_ambiante && (isNaN(parseFloat(data.temp_ambiante)) || data.temp_ambiante < -20 || data.temp_ambiante > 60)) errors.push('Temp ambiante invalide.');
  if (data.charge && (isNaN(parseFloat(data.charge)) || data.charge < 0 || data.charge > 100)) errors.push('Charge invalide.');
  const idRegex = /^[\p{L}0-9\s\-_:]+$/u;
  if (data.id && !idRegex.test(data.id)) errors.push('ID disjoncteur invalide.');
  if (data.newId && !idRegex.test(data.newId)) errors.push('Nouvel ID invalide.');
  if (data.in && (isNaN(getNum(data.in)) || getNum(data.in) <= 0)) errors.push('In invalide.');
  if (data.ir && (isNaN(getNum(data.ir)) || getNum(data.ir) <= 0)) errors.push('Ir invalide.');
  if (data.courbe && !['B','C','D','K','Z'].includes(String(data.courbe).toUpperCase())) errors.push('Courbe invalide.');
  if (data.triptime && (isNaN(parseFloat(data.triptime)) || parseFloat(data.triptime) <= 0)) errors.push('Triptime invalide.');
  if (data.icn) {
    const match = String(data.icn).match(/[\d.]+/);
    const val = match ? parseFloat(match[0]) : NaN;
    if (isNaN(val) || val <= 0) errors.push('Icn invalide.');
  }
  if (data.linkedTableauIds && (!Array.isArray(data.linkedTableauIds) || data.linkedTableauIds.some(id => !id || !idRegex.test(id)))) {
    errors.push('linkedTableauIds invalide.');
  }
  return errors;
}

function validateHTAData(data) {
  const errors = [];
  if (!data) return errors;
  const getNum = v => { const m = String(v||'').match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; };
  if (isNaN(getNum(data.transformerPower)) || getNum(data.transformerPower) <= 0) errors.push('Puissance transfo invalide.');
  if (isNaN(getNum(data.voltage)) || getNum(data.voltage) <= 0) errors.push('Tension HTA invalide.');
  if (isNaN(getNum(data.in)) || getNum(data.in) <= 0) errors.push('In HTA invalide.');
  if (isNaN(getNum(data.ir)) || getNum(data.ir) <= 0) errors.push('Ir HTA invalide.');
  if (isNaN(getNum(data.triptime)) || getNum(data.triptime) <= 0) errors.push('Triptime HTA invalide.');
  if (data.icn) {
    const match = String(data.icn).match(/[\d.]+/);
    const val = match ? parseFloat(match[0]) : NaN;
    if (isNaN(val) || val <= 0) errors.push('Icn HTA invalide.');
  }
  return errors;
}

function validateChecklistData(data) {
  const errors = [];
  if (!['Conforme','Non conforme','Non applicable'].includes(data.status)) errors.push('Statut invalide.');
  if (!data.comment || typeof data.comment !== 'string' || !data.comment.trim().length) errors.push('Commentaire requis.');
  if (data.photo && !String(data.photo).startsWith('data:image/')) errors.push('Photo invalide.');
  const idRegex = /^[\p{L}0-9\s\-_:]+$/u;
  if (!data.tableau_id || !idRegex.test(data.tableau_id)) errors.push('ID tableau invalide.');
  if (!data.disjoncteur_id || !idRegex.test(data.disjoncteur_id)) errors.push('ID disjoncteur invalide.');
  return errors;
}

function validateEquipementData(data) {
  const errors = [];
  const idRegex = /^[\p{L}0-9\s\-_:]+$/u;
  if (!data.id || !idRegex.test(data.id)) errors.push('ID équipement invalide.');
  if (data.equipmentType && !['transformateur','cellule_mt','cable_gaine'].includes(data.equipmentType)) errors.push('Type équipement invalide.');
  return errors;
}

function validateProjectData(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || !data.name.trim().length) errors.push('Nom projet requis.');
  const boolKeys = ['business_case_approved','pip_approved','wbs_created','po_launched','project_phase_completed','reception_completed','closure_completed'];
  boolKeys.forEach(k => { if (k in data && typeof data[k] !== 'boolean') errors.push(`${k} doit être booléen.`); });
  if (data.po_requests && !Array.isArray(data.po_requests)) errors.push('po_requests doit être un tableau.');
  if (data.quotes && !Array.isArray(data.quotes)) errors.push('quotes doit être un tableau.');
  if (data.attachments && !Array.isArray(data.attachments)) errors.push('attachments doit être un tableau.');
  if (data.gantt_data && typeof data.gantt_data !== 'object') errors.push('gantt_data doit être un objet.');
  if (data.budget_total && isNaN(parseFloat(data.budget_total))) errors.push('budget_total doit être un nombre.');
  if (data.chantier_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.chantier_date)) errors.push('chantier_date doit être YYYY-MM-DD.');
  return errors;
}

module.exports = { 
  validateDisjoncteurData, validateHTAData, validateChecklistData, validateEquipementData, validateProjectData 
};
