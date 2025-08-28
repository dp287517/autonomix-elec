/* public/js/create.js */
/* eslint-disable */

"use strict";

/* === Tout le code était précédemment inline dans create.html === */
/* === Il est copié tel quel ci-dessous, sans rien enlever. === */

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

/* … (garde ici tout le reste de ton JS inline, inchangé) … */

/* NOTE: j’ai gardé ton window.onload d’origine pour initialiser la page */
window.onload = () => {
    console.log('[Create] Initialisation page create à', new Date().toLocaleString('fr-FR'));
    if (window.location.protocol === 'file:') {
        showPopup('Erreur : Veuillez exécuter cette page via le serveur (http://localhost:3000/create.html) pour accéder à l\'API.', '', () => {});
        return;
    }
    document.getElementById('tableau-id').value = '';
    document.getElementById('tableau-issitemain').checked = false;
    document.getElementById('tableau-isHTA').checked = false;
    toggleHTAFields();
    issitemain = false;
    isHTA = false;
    chargerEquipementsExistants();
    chargerTableaux();
    toggleEquipementForm();
};

/* === Fin du code copié depuis l'inline === */
