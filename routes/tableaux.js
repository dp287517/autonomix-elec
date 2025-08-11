const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { openai } = require('../config/openai');
const { validateDisjoncteurData, validateEquipementData, validateHTAData } = require('../utils/validation');
const { getRecommendedSection, normalizeIcn } = require('../utils/electric');

// GET équipements agrégés
router.get('/equipements', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const disjoncteursResult = await client.query('SELECT id, disjoncteurs FROM tableaux');
    const allDisjoncteurs = disjoncteursResult.rows.flatMap(row => Array.isArray(row.disjoncteurs) ? row.disjoncteurs.map(d => ({ ...d, equipmentType: 'disjoncteur' })) : []);
    const uniqueDisjoncteurs = Array.from(new Map(allDisjoncteurs.map(d => [`${d.equipmentType}-${d.marque}-${d.ref || d.id}`, d])).values());
    const equipementsResult = await client.query('SELECT equipment_id, equipment_type, data FROM equipements');
    const autresEquipements = equipementsResult.rows.map(row => ({ id: row.equipment_id, equipmentType: row.equipment_type, ...row.data }));
    res.json([...uniqueDisjoncteurs, ...autresEquipements]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la récupération: ' + e.message });
  } finally { if (client) client.release(); }
});

// IDs tableaux
router.get('/tableaux/ids', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const result = await client.query('SELECT id FROM tableaux');
    res.json(result.rows.map(r => r.id));
  } catch (e) { res.status(500).json({ error: e.message }); } finally { if (client) client.release(); }
});

// Un tableau
router.get('/tableaux/:id', async (req, res) => {
  const { id } = req.params;
  let client; try {
    client = await pool.connect();
    const t = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux WHERE id = $1', [id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const e = await client.query('SELECT equipment_id, equipment_type, data FROM equipements WHERE tableau_id = $1', [id]);
    const tableau = {
      id: t.rows[0].id,
      disjoncteurs: t.rows[0].disjoncteurs || [],
      autresEquipements: e.rows.map(r => ({ id: r.equipment_id, equipmentType: r.equipment_type, ...r.data })),
      isSiteMain: t.rows[0].issitemain || false,
      isHTA: t.rows[0].ishta || false,
      htaData: t.rows[0].htadata || null
    };
    if (!Array.isArray(tableau.disjoncteurs)) {
      tableau.disjoncteurs = [];
      await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', ['[]', id]);
    }
    res.json(tableau);
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

// Tous tableaux
router.get('/tableaux', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const t = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
    const e = await client.query('SELECT tableau_id, equipment_id, equipment_type, data FROM equipements');
    const tableaux = t.rows.map(row => ({
      id: row.id,
      disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
      autresEquipements: e.rows.filter(r => r.tableau_id === row.id).map(r => ({ id: r.equipment_id, equipmentType: r.equipment_type, ...r.data })),
      isSiteMain: row.issitemain || false,
      isHTA: row.ishta || false,
      htaData: row.htadata || null
    }));
    res.json(tableaux);
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

// Création tableau
router.post('/tableaux', async (req, res) => {
  const { id, disjoncteurs, autresEquipements, isSiteMain, isHTA, htaData } = req.body;
  let client; try {
    client = await pool.connect();
    if (!id || !/^[\p{L}0-9\s\-_:]+$/u.test(id)) throw new Error('ID tableau invalide');
    if (!Array.isArray(disjoncteurs) || !Array.isArray(autresEquipements)) throw new Error('disjoncteurs et autresEquipements doivent être des tableaux');
    const exists = await client.query('SELECT id FROM tableaux WHERE id = $1', [id]);
    if (exists.rows.length) return res.status(400).json({ error: 'Cet identifiant de tableau existe déjà' });

    // validations
    for (const d of disjoncteurs) {
      if (d.linkedTableauIds && d.linkedTableauIds.length) {
        const invalidIds = d.linkedTableauIds.filter(lid => lid === id || !/^[\p{L}0-9\s\-_:]+$/u.test(lid));
        if (invalidIds.length) throw new Error(`IDs de tableaux liés invalides pour disjoncteur ${d.id}: ${invalidIds.join(', ')}`);
        const linked = await client.query('SELECT id FROM tableaux WHERE id = ANY($1)', [d.linkedTableauIds]);
        if (linked.rows.length !== d.linkedTableauIds.length) {
          const missing = d.linkedTableauIds.filter(lid => !linked.rows.some(r => r.id === lid));
          throw new Error(`Tableaux liés non trouvés pour disjoncteur ${d.id}: ${missing.join(', ')}`);
        }
      }
      const errs = validateDisjoncteurData(d);
      if (errs.length) throw new Error(`Données invalides pour disjoncteur ${d.id}: ${errs.join('; ')}`);
    }
    for (const e of autresEquipements) {
      const errs = validateEquipementData(e);
      if (errs.length) throw new Error(`Données invalides pour équipement ${e.id}: ${errs.join('; ')}`);
    }
    if (isHTA) {
      const htaErrors = validateHTAData(htaData);
      if (htaErrors.length) throw new Error(`Données HTA invalides: ${htaErrors.join('; ')}`);
    }

    // normalize & insert
    const normalizedDisjoncteurs = disjoncteurs.map(d => {
      const courbe = d.courbe ? String(d.courbe).toUpperCase() : 'C';
      let defaultTriptime = 0.02;
      if (courbe === 'B') defaultTriptime = 0.01;
      else if (courbe === 'D') defaultTriptime = 0.03;
      else if (courbe === 'K') defaultTriptime = 0.015;
      else if (courbe === 'Z') defaultTriptime = 0.005;
      return {
        ...d,
        icn: normalizeIcn(d.icn),
        cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength),
        section: d.section || `${getRecommendedSection(d.in)} mm²`,
        ue: d.ue || '400 V',
        triptime: d.triptime || defaultTriptime,
        humidite: d.humidite || 50,
        temp_ambiante: d.temp_ambiante || 25,
        charge: d.charge || 80,
        linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [],
        isPrincipal: !!d.isPrincipal,
        isHTAFeeder: !!d.isHTAFeeder
      }
    });
    await client.query('INSERT INTO tableaux (id, disjoncteurs, issitemain, ishta, htadata) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)',
      [id, JSON.stringify(normalizedDisjoncteurs), !!isSiteMain, !!isHTA, isHTA ? JSON.stringify(htaData) : null]);

    for (const e of autresEquipements) {
      const data = { ...e }; delete data.id; delete data.equipmentType;
      await client.query('INSERT INTO equipements (tableau_id, equipment_id, equipment_type, data) VALUES ($1, $2, $3, $4::jsonb)',
        [id, e.id, e.equipmentType, JSON.stringify(data)]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la création: ' + e.message }); } finally { if (client) client.release(); }
});

// Update tableau
router.put('/tableaux/:id', async (req, res) => {
  const { id } = req.params;
  const { disjoncteurs, autresEquipements, isSiteMain, isHTA, htaData } = req.body;
  let client; try {
    client = await pool.connect();
    const check = await client.query('SELECT id FROM tableaux WHERE id = $1', [id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });

    for (const d of disjoncteurs) {
      if (d.linkedTableauIds && d.linkedTableauIds.length) {
        const invalidIds = d.linkedTableauIds.filter(lid => lid === id || !/^[\p{L}0-9\s\-_:]+$/u.test(lid));
        if (invalidIds.length) throw new Error(`IDs de tableaux liés invalides pour disjoncteur ${d.id}: ${invalidIds.join(', ')}`);
        const linked = await client.query('SELECT id FROM tableaux WHERE id = ANY($1)', [d.linkedTableauIds]);
        if (linked.rows.length !== d.linkedTableauIds.length) {
          const missing = d.linkedTableauIds.filter(lid => !linked.rows.some(r => r.id === lid));
          throw new Error(`Tableaux liés non trouvés pour disjoncteur ${d.id}: ${missing.join(', ')}`);
        }
      }
      const errs = require('../utils/validation').validateDisjoncteurData(d);
      if (errs.length) throw new Error(`Données invalides pour disjoncteur ${d.id || 'sans ID'}: ${errs.join('; ')}`);
    }
    for (const e of autresEquipements) {
      const errs = require('../utils/validation').validateEquipementData(e);
      if (errs.length) throw new Error(`Données invalides pour équipement ${e.id}: ${errs.join('; ')}`);
    }
    if (isHTA) {
      const htaErrors = require('../utils/validation').validateHTAData(htaData);
      if (htaErrors.length) throw new Error(`Données HTA invalides: ${htaErrors.join('; ')}`);
    }

    const normalizedDisjoncteurs = disjoncteurs.map(d => ({
      ...d,
      icn: normalizeIcn(d.icn),
      cableLength: isNaN(parseFloat(d.cableLength)) ? (d.isPrincipal ? 0 : 20) : parseFloat(d.cableLength),
      section: d.section || `${getRecommendedSection(d.in)} mm²`,
      humidite: d.humidite || 50,
      temp_ambiante: d.temp_ambiante || 25,
      charge: d.charge || 80,
      linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [],
      isPrincipal: !!d.isPrincipal,
      isHTAFeeder: !!d.isHTAFeeder,
      equipmentType: 'disjoncteur'
    }));

    const result = await client.query(
      'UPDATE tableaux SET disjoncteurs = $1::jsonb, issitemain = $2, ishta = $3, htadata = $4::jsonb WHERE id = $5 RETURNING id, disjoncteurs, issitemain, ishta, htadata',
      [JSON.stringify(normalizedDisjoncteurs), !!isSiteMain, !!isHTA, isHTA ? JSON.stringify(htaData) : null, id]
    );

    await client.query('DELETE FROM equipements WHERE tableau_id = $1', [id]);
    for (const e of autresEquipements) {
      const data = { ...e }; delete data.id; delete data.equipmentType;
      await client.query('INSERT INTO equipements (tableau_id, equipment_id, equipment_type, data) VALUES ($1, $2, $3, $4::jsonb)',
        [id, e.id, e.equipmentType, JSON.stringify(data)]);
    }

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        disjoncteurs: result.rows[0].disjoncteurs,
        autresEquipements,
        isSiteMain: result.rows[0].issitemain,
        isHTA: result.rows[0].ishta,
        htaData: result.rows[0].htadata
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour: ' + e.message });
  } finally { if (client) client.release(); }
});

// Delete tableau (avec check des liens)
router.delete('/tableaux/:id', async (req, res) => {
  const { id } = req.params;
  let client; try {
    client = await pool.connect();
    const linkedCheck = await client.query('SELECT id, disjoncteurs FROM tableaux');
    const linkedBy = linkedCheck.rows.filter(row => (row.disjoncteurs||[]).some(d => Array.isArray(d.linkedTableauIds) && d.linkedTableauIds.includes(id)));
    if (linkedBy.length) {
      const linkedInfo = linkedBy.map(row => `${row.id}`).join(', ');
      return res.status(400).json({ error: `Impossible de supprimer : ce tableau est lié par ${linkedInfo}.` });
    }
    const result = await client.query('DELETE FROM tableaux WHERE id = $1 RETURNING *', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Tableau non trouvé' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la suppression: ' + e.message }); } finally { if (client) client.release(); }
});

// Disjoncteur update (ID conservé)
router.put('/disjoncteur/:tableauId/:disjoncteurId', async (req, res) => {
  const { tableauId, disjoncteurId } = req.params;
  const updatedData = req.body;
  const newId = updatedData.newId || updatedData.id;
  let client; try {
    client = await pool.connect();
    if (!tableauId || !disjoncteurId) throw new Error('Tableau ID et Disjoncteur ID sont requis');
    const validationErrors = validateDisjoncteurData({ ...updatedData, id: newId });
    if (validationErrors.length) return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });

    const result = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const disjoncteurs = Array.isArray(result.rows[0].disjoncteurs) ? result.rows[0].disjoncteurs : [];
    const idx = disjoncteurs.findIndex(d => d.id === decodeURIComponent(disjoncteurId));
    if (idx === -1) return res.status(404).json({ error: 'Disjoncteur non trouvé' });

    const updated = {
      ...disjoncteurs[idx],
      ...updatedData,
      id: newId || decodeURIComponent(disjoncteurId),
      icn: require('../utils/electric').normalizeIcn(updatedData.icn || disjoncteurs[idx].icn),
      section: updatedData.section || disjoncteurs[idx].section || `${getRecommendedSection(updatedData.in || disjoncteurs[idx].in)} mm²`,
      cableLength: isNaN(parseFloat(updatedData.cableLength)) ? (disjoncteurs[idx].isPrincipal ? 0 : 20) : parseFloat(updatedData.cableLength),
      humidite: updatedData.humidite || disjoncteurs[idx].humidite || 50,
      temp_ambiante: updatedData.temp_ambiante || disjoncteurs[idx].temp_ambiante || 25,
      charge: updatedData.charge || disjoncteurs[idx].charge || 80,
      linkedTableauIds: Array.isArray(updatedData.linkedTableauIds) ? updatedData.linkedTableauIds : [],
      isPrincipal: !!updatedData.isPrincipal,
      isHTAFeeder: !!updatedData.isHTAFeeder,
      equipmentType: 'disjoncteur'
    };
    disjoncteurs[idx] = updated;
    await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour du disjoncteur: ' + e.message });
  } finally { if (client) client.release(); }
});

// Equipements non-disjoncteur
router.put('/equipement/:tableauId/:equipmentId', async (req, res) => {
  const { tableauId, equipmentId } = req.params;
  const updatedData = req.body;
  const newId = updatedData.newId || updatedData.id;
  let client; try {
    client = await pool.connect();
    const errors = require('../utils/validation').validateEquipementData({ ...updatedData, id: newId });
    if (errors.length) return res.status(400).json({ error: 'Données invalides: ' + errors.join('; ') });
    const result = await client.query('SELECT equipment_id, equipment_type, data FROM equipements WHERE tableau_id = $1 AND equipment_id = $2', [tableauId, equipmentId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });

    const updatedEquipement = { id: newId || decodeURIComponent(equipmentId), equipmentType: updatedData.equipmentType, ...updatedData };
    delete updatedEquipement.newId;
    const data = { ...updatedEquipement }; delete data.id; delete data.equipmentType;
    await client.query('UPDATE equipements SET equipment_id = $1, equipment_type = $2, data = $3::jsonb WHERE tableau_id = $4 AND equipment_id = $5',
      [newId || decodeURIComponent(equipmentId), updatedData.equipmentType, JSON.stringify(data), tableauId, decodeURIComponent(equipmentId)]);
    res.json({ success: true, data: updatedEquipement });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la mise à jour de l'équipement: ' + e.message }); } finally { if (client) client.release(); }
});

router.delete('/equipement/:tableauId/:equipmentId', async (req, res) => {
  const { tableauId, equipmentId } = req.params;
  let client; try {
    client = await pool.connect();
    const result = await client.query('DELETE FROM equipements WHERE tableau_id = $1 AND equipment_id = $2 RETURNING *', [tableauId, decodeURIComponent(equipmentId)]);
    if (!result.rows.length) return res.status(404).json({ error: 'Équipement non trouvé' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur lors de la suppression de l'équipement: ' + e.message }); } finally { if (client) client.release(); }
});

// Data pour selectivity et arc-flash (identiques structure)
router.get('/selectivity', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const r = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
    const data = r.rows.map(row => ({
      id: row.id,
      disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
      building: row.id.split('-')[0] || 'Inconnu',
      isSiteMain: !!row.issitemain,
      isHTA: !!row.ishta,
      htaData: row.htadata || null
    }));
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

router.get('/arc-flash', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const r = await client.query('SELECT id, disjoncteurs, issitemain, ishta, htadata FROM tableaux');
    const data = r.rows.map(row => ({
      id: row.id,
      disjoncteurs: Array.isArray(row.disjoncteurs) ? row.disjoncteurs : [],
      building: row.id.split('-')[0] || 'Inconnu',
      isSiteMain: !!row.issitemain,
      isHTA: !!row.ishta,
      htaData: row.htadata || null
    }));
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

// Fault-level data + update
router.get('/fault-level', async (req, res) => {
  let client; try {
    client = await pool.connect();
    const result = await client.query('SELECT id, disjoncteurs, issitemain FROM tableaux');
    const tableaux = result.rows.map(row => {
      const disjoncteurs = (Array.isArray(row.disjoncteurs) ? row.disjoncteurs : []).map(d => {
        let ik = null;
        if (d.ue && (d.impedance || d.section)) {
          const ueMatch = String(d.ue).match(/[\d.]+/);
          const ue = ueMatch ? parseFloat(ueMatch[0]) : 400;
          let z;
          let L = isNaN(parseFloat(d.cableLength)) ? ((d.isPrincipal || d.isHTAFeeder) ? 0 : 20) : parseFloat(d.cableLength);
          if ((d.isPrincipal || d.isHTAFeeder) && L < 0) L = 0; else if (!d.isPrincipal && !d.isHTAFeeder && L < 20) L = 20;
          if (d.impedance) { z = parseFloat(d.impedance); if (z < 0.05) z = 0.05; }
          else {
            const rho = 0.0175;
            const sectionMatch = d.section ? String(d.section).match(/[\d.]+/) : null;
            const S = sectionMatch ? parseFloat(sectionMatch[0]) : require('../utils/electric').getRecommendedSection(d.in);
            const Z_cable = (rho * L * 2) / S; const Z_network = 0.01; z = Z_cable + Z_network; if (z < 0.05) z = 0.05;
          }
          ik = (ue / (Math.sqrt(3) * z)) / 1000;
          if (ik > 100) ik = null;
        }
        return { ...d, ik, icn: require('../utils/electric').normalizeIcn(d.icn), tableauId: row.id, linkedTableauIds: Array.isArray(d.linkedTableauIds) ? d.linkedTableauIds : d.linkedTableauId ? [d.linkedTableauId] : [] };
      });
      return { id: row.id, building: row.id.split('-')[0] || 'Inconnu', disjoncteurs, isSiteMain: !!row.issitemain };
    });
    res.json({ data: tableaux });
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

router.post('/fault-level/update', async (req, res) => {
  const { tableauId, disjoncteurId, ue, section, cableLength, impedance } = req.body;
  let client; try {
    client = await pool.connect();
    const result = await client.query('SELECT disjoncteurs FROM tableaux WHERE id = $1', [tableauId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Tableau non trouvé' });
    const disjoncteurs = Array.isArray(result.rows[0].disjoncteurs) ? result.rows[0].disjoncteurs : [];
    const idx = disjoncteurs.findIndex(d => d.id === disjoncteurId);
    if (idx === -1) return res.status(404).json({ error: 'Disjoncteur non trouvé' });
    const updatedData = { ue: ue || disjoncteurs[idx].ue, section: section || disjoncteurs[idx].section, cableLength: cableLength || disjoncteurs[idx].cableLength, impedance: impedance || disjoncteurs[idx].impedance };
    const errs = require('../utils/validation').validateDisjoncteurData(updatedData);
    if (errs.length) return res.status(400).json({ error: 'Données invalides: ' + errs.join('; ') });
    disjoncteurs[idx] = { ...disjoncteurs[idx], ...updatedData };
    await client.query('UPDATE tableaux SET disjoncteurs = $1::jsonb WHERE id = $2', [JSON.stringify(disjoncteurs), tableauId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); } finally { if (client) client.release(); }
});

// Recherche OpenAI d'un disjoncteur (inchangée)
router.post('/disjoncteur', async (req, res) => {
  const { marque, ref } = req.body;
  let client; try {
    client = await pool.connect();
    if (!marque || !ref) throw new Error('Marque et référence sont requis');
    const prompt = `Fournis les caractéristiques techniques du disjoncteur de marque "${marque}" et référence "${ref}". Retourne un JSON avec les champs suivants : id (laisser vide), type, poles, montage, ue, ui, uimp, frequence, in, ir, courbe, triptime, icn, ics, ip, temp, dimensions, section, date, tension, selectivite, lifespan (durée de vie en années, ex. 30), cableLength (laisser vide), impedance (laisser vide), humidite (en %, ex. 50), temp_ambiante (en °C, ex. 25), charge (en %, ex. 80), linkedTableauIds (tableau vide), isPrincipal (false), isHTAFeeder (false), equipmentType ("disjoncteur"). Si une information est manquante, utilise des valeurs par défaut plausibles ou laisse le champ vide.`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const data = JSON.parse(response.choices[0].message.content);
    const validationErrors = validateDisjoncteurData(data);
    if (validationErrors.length) return res.status(400).json({ error: 'Données invalides: ' + validationErrors.join('; ') });
    const normalizedData = {
      ...data,
      icn: normalizeIcn(data.icn),
      section: data.section || `${getRecommendedSection(data.in)} mm²`,
      humidite: data.humidite || 50,
      temp_ambiante: data.temp_ambiante || 25,
      charge: data.charge || 80,
      linkedTableauIds: Array.isArray(data.linkedTableauIds) ? data.linkedTableauIds : [],
      isPrincipal: !!data.isPrincipal,
      isHTAFeeder: !!data.isHTAFeeder,
      equipmentType: 'disjoncteur'
    };
    res.json(normalizedData);
  } catch (e) {
    { res.status(500).json({ error: `Erreur lors de la mise à jour de l'équipement: ${e.message}` });
  } finally { if (client) client.release(); }
});

module.exports = router;
