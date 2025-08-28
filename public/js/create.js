/* public/js/create.js */
"use strict";

/* ---------- Helpers DOM sûrs ---------- */
const $id = (id) => document.getElementById(id);
const on = (id, evt, cb) => { const el = $id(id); if (el) el.addEventListener(evt, cb); };
const setVal = (id, val) => { const el = $id(id); if (el) el.value = val; };
const setChecked = (id, bool) => { const el = $id(id); if (el) el.checked = !!bool; };

/* ---------- Popup non-inline, compatible CSP ---------- */
function ensurePopup() {
  let modal = $id('popup');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'popup';
    modal.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 hidden';
    modal.innerHTML = `
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-4 max-w-md w-full mx-4">
        <h3 id="popup-title" class="text-lg font-bold mb-2 text-blue-200">Info</h3>
        <p id="popup-message" class="text-sm text-gray-200 mb-4"></p>
        <div class="text-right">
          <button id="popup-close" class="btn btn-primary px-4 py-2">OK</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#popup-close').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }
  return modal;
}

function showPopup(message, title = 'Information') {
  console.log('[Create] Affichage pop-up:', message);
  const modal = ensurePopup();
  const titleEl = $id('popup-title');
  const msgEl = $id('popup-message');
  if (titleEl) titleEl.textContent = title || 'Information';
  if (msgEl) msgEl.textContent = message || '';
  modal.classList.remove('hidden');
}

/* ---------- Normalisation numérique (ton ancienne logique) ---------- */
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

/* ---------- Bascule HTA (tolérante aux IDs) ---------- */
function toggleHTAFields() {
  const isHTA = !!$id('tableau-isHTA')?.checked;
  console.log('[Create] Bascule champs HTA:', isHTA);

  const htaSection = $id('hta-fields');
  if (htaSection) htaSection.classList.toggle('hidden', !isHTA);

  const voltageInput = $id('hta-voltage') || $id('hta_voltage') || $id('tension_primaire') || $id('hta-tension');
  const powerInput   = $id('hta-power')   || $id('hta_power')   || $id('puissance_transfo') || $id('hta-puissance');

  if (isHTA) {
    if (voltageInput && !voltageInput.value) voltageInput.value = '20 kV';
    if (powerInput && !powerInput.value)     powerInput.value   = '250 kVA';
  } else {
    if (voltageInput) voltageInput.value = '';
    if (powerInput)   powerInput.value   = '';
  }
}

/* ---------- Rendu liste (très simple, évite les erreurs si vide) ---------- */
function renderList(ulId, items, renderItem) {
  const ul = $id(ulId);
  if (!ul) return;
  ul.innerHTML = '';
  (items || []).forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'p-2 bg-gray-800 border border-gray-700 rounded';
    li.innerHTML = renderItem ? renderItem(it, idx) : `<span class="text-sm text-gray-200">${JSON.stringify(it)}</span>`;
    ul.appendChild(li);
  });
}

/* ---------- Fetch util ---------- */
async function safeFetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = `Erreur HTTP: ${res.status}${text ? ` – ${text}` : ''}`;
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- Charger équipements existants (tolérant 401) ---------- */
async function chargerEquipementsExistants() {
  console.log('[Create] Chargement équipements existants');
  try {
    const data = await safeFetchJSON('/api/equipements');
    // data = array d’équipements { id, equipmentType, ... }
    renderList('equipements-list', data, (it) => {
      const label = it?.id || it?.equipmentType || 'Équipement';
      return `<div class="flex items-center justify-between">
        <span class="text-sm text-gray-200">${label}</span>
        <span class="tag">${it?.equipmentType || 'type inconnu'}</span>
      </div>`;
    });
  } catch (e) {
    console.warn('[Create] Erreur chargement équipements existants:', e);
    showPopup('Erreur lors du chargement des équipements existants: ' + e.message, 'Chargement');
    // on n’arrête pas l’init pour autant
  }
}

/* ---------- Charger liste des tableaux (tolérant 401) ---------- */
async function chargerTableaux() {
  console.log('[Create] Chargement liste tableaux');
  try {
    const tableaux = await safeFetchJSON('/api/tableaux');
    // tableaux = [{id, disjoncteurs, ...}]
    // ici on ne fait que logguer pour éviter le hors-scope
    console.log('[Create] Tableaux existants:', tableaux?.length || 0);
  } catch (e) {
    console.warn('[Create] Erreur chargement tableaux:', e);
    showPopup('Erreur lors du chargement des tableaux: ' + e.message, 'Chargement');
  }
}

/* ---------- Ajouts simples d’items (local UI) ---------- */
function addDisjoncteur() {
  const now = new Date().toLocaleString('fr-FR');
  const items = [{ id: `DJ-${Date.now()}`, in: '16 A', icn: '6 kA', at: now }];
  renderList('disjoncteurs-list', items, (d) => {
    return `<div>
      <div class="font-semibold text-blue-200">${d.id}</div>
      <div class="text-sm text-gray-300">In: ${d.in} — Icn: ${d.icn}</div>
      <div class="text-xs text-gray-500">${d.at}</div>
    </div>`;
  });
}

function addEquipement() {
  const now = new Date().toLocaleString('fr-FR');
  const items = [{ id: `EQ-${Date.now()}`, equipmentType: 'variateur', at: now }];
  renderList('equipements-list', items, (e) => {
    return `<div class="flex items-center justify-between">
      <div>
        <div class="font-semibold text-blue-200">${e.id}</div>
        <div class="text-sm text-gray-300">${e.equipmentType}</div>
      </div>
      <span class="text-xs text-gray-500">${e.at}</span>
    </div>`;
  });
}

/* ---------- Sauvegarde tableau (POST) ---------- */
async function saveTableau() {
  const id = $id('tableau-id')?.value?.trim();
  const isSiteMain = !!$id('tableau-issitemain')?.checked;
  const isHTA = !!$id('tableau-isHTA')?.checked;

  if (!id) {
    showPopup('Merci de saisir un identifiant de tableau (ex: 27-9-G).', 'Validation');
    return;
  }

  const payload = {
    id,
    disjoncteurs: [],          // à connecter à ton UI si tu veux sérialiser la liste
    autresEquipements: [],     // idem
    isSiteMain,
    isHTA,
    htaData: isHTA ? {
      voltage: $id('hta-voltage')?.value || '',
      transformerPower: $id('hta-power')?.value || ''
    } : null
  };

  try {
    const res = await safeFetchJSON('/api/tableaux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[Create] Sauvegarde OK:', res);
    showPopup('Tableau enregistré avec succès.', 'Succès');
  } catch (e) {
    console.warn('[Create] Sauvegarde KO:', e);
    showPopup('Échec de l’enregistrement: ' + e.message, 'Erreur');
  }
}

/* ---------- Reset simple ---------- */
function resetForm() {
  setVal('tableau-id', '');
  setChecked('tableau-issitemain', false);
  setChecked('tableau-isHTA', false);
  toggleHTAFields();
  renderList('disjoncteurs-list', []);
  renderList('equipements-list', []);
}

/* ---------- Init ---------- */
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Create] Initialisation page create à', new Date().toLocaleString('fr-FR'));

  // Si tu ouvres le fichier en local (file://), on avertit :
  if (window.location.protocol === 'file:') {
    showPopup('Ouvre cette page depuis le serveur (http://localhost:3000/create.html) pour accéder à l’API.', 'Info');
    return;
  }

  // Listeners UI
  on('tableau-isHTA', 'change', toggleHTAFields);
  on('add-disjoncteur', 'click', addDisjoncteur);
  on('add-equipement', 'click', addEquipement);
  on('save-tableau', 'click', saveTableau);
  on('reset-form', 'click', resetForm);

  // Valeurs par défaut
  setVal('tableau-id', '');
  setChecked('tableau-issitemain', false);
  setChecked('tableau-isHTA', false);
  toggleHTAFields();

  // Chargements (tolérants 401)
  chargerEquipementsExistants();
  chargerTableaux();
});
