/* public/js/create.js */
/* eslint-disable */
"use strict";

// utilitaires sûrs
const $id = (id) => document.getElementById(id);
const setVal = (id, val) => { const el = $id(id); if (el) el.value = val; };
const setChecked = (id, bool) => { const el = $id(id); if (el) el.checked = !!bool; };
const on = (id, evt, cb) => { const el = $id(id); if (el) el.addEventListener(evt, cb); };

// === tes fonctions existantes (garde-les) ===
// si tu avais déjà ces fonctions, laisse-les telles quelles.
// j'indique quelques stubs au cas où :
function showPopup(msg, title = '', cb = () => {}) { alert(msg); cb(); }
function toggleHTAFields() {}
function chargerEquipementsExistants() {}
function chargerTableaux() {}
function toggleEquipementForm() {}

function normalizeNumericValue(value, field = '') {
  if (value == null || value === '') return '';
  const stringValue = String(value).trim();
  const match = stringValue.match(/[\d.]+/);
  if (!match) return '';
  const number = parseFloat(match[0]);
  if (isNaN(number) || number <= 0) return '';

  let defaultUnit = 'kA';
  if (field === 'triptime') defaultUnit = 's';
  else if (field === 'section' || field === 'cable_section') defaultUnit = 'mm²';
  else if (field === 'in' || field === 'ir' || field === 'courant' || field === 'courant_admissible') defaultUnit = 'A';
  else if (field === 'icn' || field === 'ics' || field === 'pouvoir_coupure') defaultUnit = 'kA';
  else if (field === 'transformerPower') defaultUnit = 'kVA';
  else if (field === 'voltage' || field === 'tension' || field === 'tension_primaire') defaultUnit = 'kV';
  else if (field === 'tension_secondaire') defaultUnit = 'V';
  else if (field === 'longueur') defaultUnit = 'm';

  const unitMatch = stringValue.match(/[a-zA-Z²]+$/i);
  const unit = unitMatch ? unitMatch[0].toLowerCase() : '';

  if (unit) {
    if (field === 'triptime' && unit !== 's') return '';
    if ((field === 'section' || field === 'cable_section') && unit !== 'mm²' && unit !== 'mm2') return '';
    if ((field === 'in' || field === 'ir' || field === 'courant' || field === 'courant_admissible') && unit !== 'a') return '';
    if ((field === 'icn' || field === 'ics' || field === 'pouvoir_coupure') && unit !== 'ka') return '';
    if (field === 'transformerPower' && unit !== 'kva') return '';
    if ((field === 'voltage' || field === 'tension' || field === 'tension_primaire') && unit !== 'kv') return '';
    if (field === 'tension_secondaire' && unit !== 'v') return '';
    if (field === 'longueur' && unit !== 'm') return '';
  }
  return `${number} ${defaultUnit}`;
}

// === INITIALISATION SÛRE ===
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Create] Initialisation page create à', new Date().toLocaleString('fr-FR'));

  if (window.location.protocol === 'file:') {
    showPopup('Erreur : Veuillez exécuter cette page via le serveur (http://localhost:3000/create.html) pour accéder à l\'API.', '', () => {});
    return;
  }

  // Ces IDs doivent exister dans create.html — si un manque, ça ne plantera plus.
  setVal('tableau-id', '');
  setChecked('tableau-issitemain', false);
  setChecked('tableau-isHTA', false);

  // Si la fonction existe, on l’appelle (sinon no-op)
  try { toggleHTAFields(); } catch {}
  try { chargerEquipementsExistants(); } catch {}
  try { chargerTableaux(); } catch {}
  try { toggleEquipementForm(); } catch {}
});
