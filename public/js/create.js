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
                    return `${number} ${unitMatch[0]}`;
                }
                
                return `${number} ${defaultUnit}`;
            }

            let equipements = [];
            let equipementsExistants = [];
            let tableaux = [];
            let disjoncteurPrincipalIndex = null;
            let issitemain = false;
            let isHTA = false;

            function validateEquipementId(id) {
                const validIdRegex = /^[\p{L}0-9\s\-_:]+$/u;
                return validIdRegex.test(id);
            }

            function showPopup(message, content = '', confirmCallback = () => {}) {
                console.log('[Create] Affichage pop-up:', message);
                document.getElementById('popup-message').textContent = message;
                document.getElementById('popup-content').innerHTML = content;
                document.getElementById('popup').classList.remove('hidden');
                document.getElementById('popup-confirm').onclick = () => {
                    console.log('[Create] Pop-up confirmé:', message);
                    confirmCallback();
                    hidePopup();
                };
                document.getElementById('popup-cancel').onclick = () => {
                    console.log('[Create] Pop-up annulé:', message);
                    hidePopup();
                };
                gsap.from('#popup > div', { opacity: 0, scale: 0.8, duration: 0.5, ease: 'power2.out' });
            }

            function hidePopup() {
                console.log('[Create] Masquage pop-up');
                document.getElementById('popup').classList.add('hidden');
            }

            function toggleHTAFields() {
                isHTA = document.getElementById('tableau-isHTA').checked;
                const htaFields = document.getElementById('hta-fields');
                console.log('[Create] Bascule champs HTA:', isHTA);
                htaFields.classList.toggle('hidden', !isHTA);
                if (!isHTA) {
                    document.getElementById('hta-transformerPower').value = '';
                    document.getElementById('hta-voltage').value = '';
                    document.getElementById('hta-in').value = '';
                    document.getElementById('hta-ir').value = '';
                    document.getElementById('hta-triptime').value = '';
                    document.getElementById('hta-icn').value = '';
                }
            }

            function collectHTAData() {
                if (!document.getElementById('tableau-isHTA').checked) {
                    console.log('[Create] HTA non sélectionné, retour null');
                    return null;
                }

                let transformerPower = document.getElementById('hta-transformerPower').value.trim();
                let voltage = document.getElementById('hta-voltage').value.trim();
                let inCurrent = document.getElementById('hta-in').value.trim();
                let irCurrent = document.getElementById('hta-ir').value.trim();
                let triptime = document.getElementById('hta-triptime').value.trim();
                let icn = document.getElementById('hta-icn').value.trim();

                transformerPower = normalizeNumericValue(transformerPower, 'transformerPower');
                voltage = normalizeNumericValue(voltage, 'voltage');
                inCurrent = normalizeNumericValue(inCurrent, 'in');
                irCurrent = normalizeNumericValue(irCurrent, 'ir');
                triptime = normalizeNumericValue(triptime, 'triptime');
                icn = normalizeNumericValue(icn, 'icn');

                console.log('[Create] Collecte données HTA:', { transformerPower, voltage, inCurrent, irCurrent, triptime, icn });

                const errors = [];
                if (!transformerPower || !transformerPower.match(/^\d+(\.?\d+)?\s*kVA$/)) errors.push('Puissance du transformateur (ex. 1600 kVA)');
                if (!voltage || !voltage.match(/^\d+(\.?\d+)?\s*kV$/)) errors.push('Tension HTA (ex. 20 kV)');
                if (!inCurrent || !inCurrent.match(/^\d+(\.?\d+)?\s*A$/)) errors.push('Courant nominal (ex. 50 A)');
                if (!irCurrent || !irCurrent.match(/^\d+(\.?\d+)?\s*A$/)) errors.push('Courant réglable (ex. 40 A)');
                if (!triptime || !triptime.match(/^\d+(\.?\d+)?\s*s$/)) errors.push('Temps de déclenchement (ex. 0.2 s)');
                if (!icn || !icn.match(/^\d+(\.?\d+)?\s*kA$/)) errors.push('Pouvoir de coupure (ex. 16 kA)');

                if (errors.length > 0) {
                    console.log('[Create] Erreurs validation HTA:', errors);
                    showPopup(`Veuillez remplir correctement les champs HTA suivants : ${errors.join(', ')}.`, '', () => {});
                    return null;
                }

                return {
                    transformerPower,
                    voltage,
                    in: inCurrent,
                    ir: irCurrent,
                    triptime,
                    icn
                };
            }

            async function saveIsSiteMain() {
                console.log('[Create] Sauvegarde issitemain');
                const newIsSiteMain = document.getElementById('tableau-issitemain').checked;
                const messageDiv = document.getElementById('issitemain-message');
                try {
                    issitemain = newIsSiteMain;
                    messageDiv.textContent = 'Statut de tableau principal du site enregistré localement.';
                    messageDiv.className = 'bg-green-100 text-green-800 mt-2 p-2 rounded text-sm';
                    messageDiv.classList.remove('hidden');
                    setTimeout(() => messageDiv.classList.add('hidden'), 5000);
                } catch (error) {
                    console.error('[Create] Erreur sauvegarde issitemain:', error);
                    document.getElementById('tableau-issitemain').checked = issitemain;
                    messageDiv.textContent = 'Erreur lors de la mise à jour du statut: ' + error.message;
                    messageDiv.className = 'bg-red-100 text-red-800 mt-2 p-2 rounded text-sm';
                    messageDiv.classList.remove('hidden');
                    setTimeout(() => messageDiv.classList.add('hidden'), 5000);
                }
            }

            async function chargerEquipementsExistants() {
                console.log('[Create] Chargement équipements existants');
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const response = await fetch('/api/equipements', { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
                    equipementsExistants = await response.json();
                    const disjoncteursExistants = equipementsExistants.filter(e => e.equipmentType === 'disjoncteur');
                    console.log('[Create] Disjoncteurs existants reçus:', disjoncteursExistants.length);
                    const select = document.getElementById('equipement-existant');
                    select.innerHTML = '<option value="">-- Choisir un équipement --</option>';
                    disjoncteursExistants.forEach(e => {
                        const normalizedDisjoncteur = {
                            ...e,
                            icn: normalizeNumericValue(e.icn, 'icn'),
                            ics: normalizeNumericValue(e.ics, 'ics'),
                            in: normalizeNumericValue(e.in, 'in'),
                            ir: normalizeNumericValue(e.ir, 'ir'),
                            triptime: normalizeNumericValue(e.triptime, 'triptime'),
                            section: normalizeNumericValue(e.section, 'section')
                        };
                        const option = document.createElement('option');
                        option.value = JSON.stringify(normalizedDisjoncteur);
                        option.textContent = `${e.marque} ${e.ref} (Disjoncteur)`;
                        select.appendChild(option);
                    });
                } catch (error) {
                    console.error('[Create] Erreur chargement équipements existants:', error);
                    showPopup('Erreur lors du chargement des équipements existants: ' + error.message, '', () => {});
                }
            }

            async function chargerTableaux() {
                console.log('[Create] Chargement liste tableaux');
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const response = await fetch('/api/tableaux', { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
                    tableaux = await response.json();
                    console.log('[Create] Tableaux chargés:', tableaux.length);
                    const select = document.getElementById('disjoncteur-linked-tableaux');
                    select.innerHTML = '<option value="">-- Aucun tableau aval --</option>';
                    tableaux
                        .filter(t => !t.isHTA)
                        .forEach(t => {
                            const option = document.createElement('option');
                            option.value = t.id;
                            option.textContent = t.id + (t.issitemain ? ' (Principal)' : '');
                            select.appendChild(option);
                        });
                } catch (error) {
                    console.error('[Create] Erreur chargement tableaux:', error);
                    showPopup('Erreur lors du chargement des tableaux: ' + error.message, '', () => {});
                }
            }

            function toggleEquipementForm() {
                const type = document.getElementById('equipement-type').value;
                console.log('[Create] Bascule formulaire équipement:', type);
                const forms = document.querySelectorAll('#equipement-form .form-section');
                forms.forEach(form => form.classList.remove('active'));
                document.getElementById(`${type}-form`).classList.add('active');
                document.getElementById('equipement-form').classList.add('hidden');
                if (type !== 'disjoncteur') {
                    document.getElementById('equipement-marque').value = '';
                    document.getElementById('equipement-ref').value = '';
                }
            }

            async function rechercherEquipement() {
                console.log('[Create] Bouton Rechercher via OpenAI cliqué');
                const type = document.getElementById('equipement-type').value;
                if (type !== 'disjoncteur') {
                    console.log('[Create] Recherche OpenAI non supportée pour:', type);
                    showPopup('La recherche via OpenAI est uniquement disponible pour les disjoncteurs.', '', () => {});
                    return;
                }
                const marque = document.getElementById('equipement-marque').value.trim();
                const ref = document.getElementById('equipement-ref').value.trim();
                if (!marque || !ref) {
                    console.log('[Create] Erreur: Marque ou référence vide');
                    showPopup('Veuillez entrer la marque et la référence.', '', () => {});
                    return;
                }
                try {
                    console.log('[Create] Envoi requête OpenAI pour', { marque, ref });
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const response = await fetch('/api/disjoncteur', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ marque, ref }),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    const data = await response.json();
                    console.log('[Create] Données OpenAI reçues:', data);
                    if (response.ok && data && Object.keys(data).length > 0) {
                        document.getElementById('equipement-form').classList.remove('hidden');
                        document.getElementById('disjoncteur-id').value = '';
                        document.getElementById('disjoncteur-type').value = data.type || '';
                        document.getElementById('disjoncteur-poles').value = data.poles || '';
                        document.getElementById('disjoncteur-montage').value = data.montage || '';
                        document.getElementById('disjoncteur-ue').value = data.ue || '';
                        document.getElementById('disjoncteur-ui').value = data.ui || '';
                        document.getElementById('disjoncteur-uimp').value = data.uimp || '';
                        document.getElementById('disjoncteur-frequence').value = data.frequence || '';
                        document.getElementById('disjoncteur-in').value = normalizeNumericValue(data.in, 'in') || '';
                        document.getElementById('disjoncteur-ir').value = normalizeNumericValue(data.ir, 'ir') || '';
                        document.getElementById('disjoncteur-courbe').value = data.courbe || '';
                        document.getElementById('disjoncteur-triptime').value = normalizeNumericValue(data.triptime, 'triptime') || '';
                        document.getElementById('disjoncteur-icn').value = normalizeNumericValue(data.icn, 'icn') || '';
                        document.getElementById('disjoncteur-ics').value = normalizeNumericValue(data.ics, 'ics') || '';
                        document.getElementById('disjoncteur-ip').value = data.ip || '';
                        document.getElementById('disjoncteur-temp').value = data.temp || '';
                        document.getElementById('disjoncteur-dimensions').value = data.dimensions || '';
                        document.getElementById('disjoncteur-section').value = normalizeNumericValue(data.section, 'section') || '';
                        document.getElementById('disjoncteur-date').value = data.date || '';
                        document.getElementById('disjoncteur-tension').value = data.tension || '';
                        document.getElementById('disjoncteur-selectivite').value = data.selectivite || '';
                        document.getElementById('equipement-marque').value = marque;
                        document.getElementById('equipement-ref').value = ref;
                        const linkedSelect = document.getElementById('disjoncteur-linked-tableaux');
                        Array.from(linkedSelect.options).forEach(opt => opt.selected = false);
                        initializeDisjoncteurForm();
                    } else {
                        console.log('[Create] Aucune donnée OpenAI reçue');
                        showPopup('Aucune donnée trouvée pour ce disjoncteur. Essayez manuellement ou vérifiez la marque/référence.', '', () => {});
                    }
                } catch (error) {
                    console.error('[Create] Erreur recherche OpenAI:', error);
                    showPopup('Erreur lors de la recherche OpenAI: ' + error.message, '', () => {});
                }
            }

            function ajouterManuel() {
                console.log('[Create] Bouton Ajouter manuellement cliqué');
                const type = document.getElementById('equipement-type').value;
                document.getElementById('equipement-form').classList.remove('hidden');
                if (type === 'disjoncteur') {
                    document.getElementById('disjoncteur-id').value = '';
                    document.getElementById('disjoncteur-type').value = '';
                    document.getElementById('disjoncteur-poles').value = '';
                    document.getElementById('disjoncteur-montage').value = '';
                    document.getElementById('disjoncteur-ue').value = '';
                    document.getElementById('disjoncteur-ui').value = '';
                    document.getElementById('disjoncteur-uimp').value = '';
                    document.getElementById('disjoncteur-frequence').value = '';
                    document.getElementById('disjoncteur-in').value = '';
                    document.getElementById('disjoncteur-ir').value = '';
                    document.getElementById('disjoncteur-courbe').value = '';
                    document.getElementById('disjoncteur-triptime').value = '';
                    document.getElementById('disjoncteur-icn').value = '';
                    document.getElementById('disjoncteur-ics').value = '';
                    document.getElementById('disjoncteur-ip').value = '';
                    document.getElementById('disjoncteur-temp').value = '';
                    document.getElementById('disjoncteur-dimensions').value = '';
                    document.getElementById('disjoncteur-section').value = '';
                    document.getElementById('disjoncteur-date').value = '';
                    document.getElementById('disjoncteur-tension').value = '';
                    document.getElementById('disjoncteur-selectivite').value = '';
                    const linkedSelect = document.getElementById('disjoncteur-linked-tableaux');
                    Array.from(linkedSelect.options).forEach(opt => opt.selected = false);
                    initializeDisjoncteurForm();
                } else if (type === 'transformateur') {
                    document.getElementById('transformateur-id').value = '';
                    document.getElementById('transformateur-puissance').value = '';
                    document.getElementById('transformateur-tension-primaire').value = '';
                    document.getElementById('transformateur-tension-secondaire').value = '';
                    document.getElementById('transformateur-frequence').value = '';
                    document.getElementById('transformateur-date').value = '';
                } else if (type === 'cellule_mt') {
                    document.getElementById('cellule_mt-id').value = '';
                    document.getElementById('cellule_mt-tension').value = '';
                    document.getElementById('cellule_mt-courant').value = '';
                    document.getElementById('cellule_mt-pouvoir_coupure').value = '';
                    document.getElementById('cellule_mt-frequence').value = '';
                    document.getElementById('cellule_mt-date').value = '';
                } else if (type === 'cable_gaine') {
                    document.getElementById('cable_gaine-id').value = '';
                    document.getElementById('cable_gaine-type').value = 'cable';
                    document.getElementById('cable_gaine-section').value = '';
                    document.getElementById('cable_gaine-longueur').value = '';
                    document.getElementById('cable_gaine-courant').value = '';
                    document.getElementById('cable_gaine-date').value = '';
                }
                document.getElementById('equipement-marque').value = '';
                document.getElementById('equipement-ref').value = '';
            }

            async function ajouterEquipementExistant() {
                console.log('[Create] Bouton Ajouter (liste déroulante) cliqué');
                const select = document.getElementById('equipement-existant');
                const selected = select.value;
                if (!selected) {
                    console.log('[Create] Erreur: Aucun équipement sélectionné');
                    showPopup('Veuillez sélectionner un équipement.', '', () => {});
                    return;
                }
                try {
                    const equipementBase = JSON.parse(selected);
                    console.log('[Create] Équipement sélectionné:', equipementBase);
                    if (equipementBase.equipmentType !== 'disjoncteur') {
                        console.log('[Create] Erreur: Seuls les disjoncteurs peuvent être ajoutés via la liste existante');
                        showPopup('Seuls les disjoncteurs peuvent être sélectionnés dans la liste existante.', '', () => {});
                        return;
                    }
                    // Vérifier que le formulaire disjoncteur est actif
                    document.getElementById('equipement-type').value = 'disjoncteur';
                    toggleEquipementForm();
                    document.getElementById('equipement-form').classList.remove('hidden');

                    // Vérifier l'existence des champs avant de définir leurs valeurs
                    const fields = {
                        'disjoncteur-id': '',
                        'equipement-marque': equipementBase.marque || '',
                        'equipement-ref': equipementBase.ref || '',
                        'disjoncteur-type': equipementBase.type || '',
                        'disjoncteur-poles': equipementBase.poles || '',
                        'disjoncteur-montage': equipementBase.montage || '',
                        'disjoncteur-ue': equipementBase.ue || '',
                        'disjoncteur-ui': equipementBase.ui || '',
                        'disjoncteur-uimp': equipementBase.uimp || '',
                        'disjoncteur-frequence': equipementBase.frequence || '',
                        'disjoncteur-in': normalizeNumericValue(equipementBase.in, 'in') || '',
                        'disjoncteur-ir': normalizeNumericValue(equipementBase.ir, 'ir') || '',
                        'disjoncteur-courbe': equipementBase.courbe || '',
                        'disjoncteur-triptime': normalizeNumericValue(equipementBase.triptime, 'triptime') || '',
                        'disjoncteur-icn': normalizeNumericValue(equipementBase.icn, 'icn') || '',
                        'disjoncteur-ics': normalizeNumericValue(equipementBase.ics, 'ics') || '',
                        'disjoncteur-ip': equipementBase.ip || '',
                        'disjoncteur-temp': equipementBase.temp || '',
                        'disjoncteur-dimensions': equipementBase.dimensions || '',
                        'disjoncteur-section': normalizeNumericValue(equipementBase.section, 'section') || '',
                        'disjoncteur-date': equipementBase.date || '',
                        'disjoncteur-tension': equipementBase.tension || '',
                        'disjoncteur-selectivite': equipementBase.selectivite || ''
                    };

                    for (const [id, value] of Object.entries(fields)) {
                        const element = document.getElementById(id);
                        if (!element) {
                            console.error('[Create] Champ introuvable:', id);
                            showPopup(`Erreur: Le champ ${id} est introuvable dans le formulaire.`, '', () => {});
                            return;
                        }
                        element.value = value;
                    }

                    const linkedSelect = document.getElementById('disjoncteur-linked-tableaux');
                    if (linkedSelect) {
                        Array.from(linkedSelect.options).forEach(opt => opt.selected = false);
                    } else {
                        console.error('[Create] Champ disjoncteur-linked-tableaux introuvable');
                        showPopup('Erreur: Le champ des tableaux liés est introuvable.', '', () => {});
                        return;
                    }

                    initializeDisjoncteurForm();
                } catch (error) {
                    console.error('[Create] Erreur parsing équipement:', error);
                    showPopup('Erreur lors de la sélection de l\'équipement: ' + error.message, '', () => {});
                }
            }

            function updateTriptime() {
                const courbeInput = document.getElementById('disjoncteur-courbe');
                const triptimeInput = document.getElementById('disjoncteur-triptime');
                if (!courbeInput || !triptimeInput) {
                    console.warn('[Create] Champs courbe ou triptime non trouvés');
                    return;
                }

                const courbe = courbeInput.value ? courbeInput.value.toUpperCase() : '';
                let defaultTriptime;

                switch (courbe) {
                    case 'B':
                        defaultTriptime = 0.01; // 10 ms pour courbe B
                        break;
                    case 'C':
                        defaultTriptime = 0.02; // 20 ms pour courbe C
                        break;
                    case 'D':
                        defaultTriptime = 0.03; // 30 ms pour courbe D
                        break;
                    case 'K':
                        defaultTriptime = 0.015; // 15 ms pour courbe K
                        break;
                    case 'Z':
                        defaultTriptime = 0.005; // 5 ms pour courbe Z
                        break;
                    default:
                        defaultTriptime = 0.02; // Valeur par défaut si courbe non reconnue
                }

                if (!triptimeInput.value.trim()) {
                    triptimeInput.value = defaultTriptime.toFixed(3) + ' s';
                    console.log('[Create] Triptime pré-rempli:', defaultTriptime, 'pour courbe:', courbe);
                }
            }

            function initializeDisjoncteurForm() {
                updateTriptime();
            }

            document.getElementById('disjoncteur-courbe')?.addEventListener('input', updateTriptime);

            async function ajouterEquipement() {
                console.log('[Create] Bouton Ajouter au tableau cliqué');
                const type = document.getElementById('equipement-type').value;
                const marque = document.getElementById('equipement-marque').value.trim();
                const ref = document.getElementById('equipement-ref').value.trim();
                let equipement = { equipmentType: type, marque, ref };
                let idField, requiredFields = [];

                if (type === 'disjoncteur') {
                    idField = 'disjoncteur-id';
                    equipement = {
                        ...equipement,
                        id: document.getElementById('disjoncteur-id').value.trim(),
                        type: document.getElementById('disjoncteur-type').value.trim(),
                        poles: document.getElementById('disjoncteur-poles').value.trim(),
                        montage: document.getElementById('disjoncteur-montage').value.trim(),
                        ue: document.getElementById('disjoncteur-ue').value.trim(),
                        ui: document.getElementById('disjoncteur-ui').value.trim(),
                        uimp: document.getElementById('disjoncteur-uimp').value.trim(),
                        frequence: document.getElementById('disjoncteur-frequence').value.trim(),
                        in: normalizeNumericValue(document.getElementById('disjoncteur-in').value.trim(), 'in'),
                        ir: normalizeNumericValue(document.getElementById('disjoncteur-ir').value.trim(), 'ir'),
                        courbe: document.getElementById('disjoncteur-courbe').value.trim(),
                        triptime: normalizeNumericValue(document.getElementById('disjoncteur-triptime').value.trim(), 'triptime'),
                        icn: normalizeNumericValue(document.getElementById('disjoncteur-icn').value.trim(), 'icn'),
                        ics: normalizeNumericValue(document.getElementById('disjoncteur-ics').value.trim(), 'ics'),
                        ip: document.getElementById('disjoncteur-ip').value.trim(),
                        temp: document.getElementById('disjoncteur-temp').value.trim(),
                        dimensions: document.getElementById('disjoncteur-dimensions').value.trim(),
                        section: normalizeNumericValue(document.getElementById('disjoncteur-section').value.trim(), 'section'),
                        date: document.getElementById('disjoncteur-date').value.trim(),
                        tension: document.getElementById('disjoncteur-tension').value.trim(),
                        selectivite: document.getElementById('disjoncteur-selectivite').value.trim(),
                        isPrincipal: false,
                        linkedTableauIds: Array.from(document.getElementById('disjoncteur-linked-tableaux').selectedOptions).map(opt => opt.value).filter(Boolean)
                    };
                    requiredFields = ['id', 'marque', 'ref'];
                    if (equipement.courbe && !['B', 'C', 'D'].includes(equipement.courbe)) {
                        console.log('[Create] Erreur: Courbe invalide', equipement.courbe);
                        showPopup('La courbe doit être B, C ou D.', '', () => {});
                        return;
                    }
                    if (equipement.ir && !equipement.ir.match(/^\d+(\.?\d+)?\s*A$/)) {
                        console.log('[Create] Erreur: Ir invalide', equipement.ir);
                        showPopup('Ir doit être une valeur numérique, ex. 60 ou 60 A.', '', () => {});
                        return;
                    }
                    if (equipement.icn && !equipement.icn.match(/^\d+(\.?\d+)?\s*kA$/)) {
                        console.log('[Create] Erreur: Icn invalide', equipement.icn);
                        showPopup('Icn doit être une valeur numérique, ex. 6 ou 6 kA.', '', () => {});
                        return;
                    }
                    if (equipement.ics && !equipement.ics.match(/^\d+(\.?\d+)?\s*kA$/)) {
                        console.log('[Create] Erreur: Ics invalide', equipement.ics);
                        showPopup('Ics doit être une valeur numérique, ex. 4.5 ou 4.5 kA.', '', () => {});
                        return;
                    }
                    if (equipement.in && !equipement.in.match(/^\d+(\.?\d+)?\s*A$/)) {
                        console.log('[Create] Erreur: In invalide', equipement.in);
                        showPopup('In doit être une valeur numérique, ex. 16 ou 16 A.', '', () => {});
                        return;
                    }
                    if (equipement.triptime && !equipement.triptime.match(/^\d+(\.?\d+)?\s*s$/)) {
                        console.log('[Create] Erreur: TripTime invalide', equipement.triptime);
                        showPopup('TripTime doit être une valeur numérique, ex. 0.1 ou 0.1 s.', '', () => {});
                        return;
                    }
                    if (equipement.section && !equipement.section.match(/^\d+(\.?\d+)?\s*mm²$/)) {
                        console.log('[Create] Erreur: Section invalide', equipement.section);
                        showPopup('La section doit être une valeur numérique, ex. 2.5 ou 2.5 mm².', '', () => {});
                        return;
                    }
                    if (equipement.linkedTableauIds.some(id => tableaux.find(t => t.id === id)?.isHTA)) {
                        console.log('[Create] Erreur: Liaison à un tableau HTA détectée', equipement.linkedTableauIds);
                        showPopup('Un disjoncteur ne peut être lié qu’à des tableaux BT.', '', () => {});
                        return;
                    }
                } else if (type === 'transformateur') {
                    idField = 'transformateur-id';
                    equipement = {
                        ...equipement,
                        id: document.getElementById('transformateur-id').value.trim(),
                        puissance: normalizeNumericValue(document.getElementById('transformateur-puissance').value.trim(), 'transformerPower'),
                        tension_primaire: normalizeNumericValue(document.getElementById('transformateur-tension-primaire').value.trim(), 'tension_primaire'),
                        tension_secondaire: normalizeNumericValue(document.getElementById('transformateur-tension-secondaire').value.trim(), 'tension_secondaire'),
                        frequence: document.getElementById('transformateur-frequence').value.trim(),
                        date: document.getElementById('transformateur-date').value.trim()
                    };
                    requiredFields = ['id'];
                    if (equipement.puissance && !equipement.puissance.match(/^\d+(\.?\d+)?\s*kVA$/)) {
                        console.log('[Create] Erreur: Puissance invalide', equipement.puissance);
                        showPopup('La puissance doit être une valeur numérique, ex. 1600 ou 1600 kVA.', '', () => {});
                        return;
                    }
                    if (equipement.tension_primaire && !equipement.tension_primaire.match(/^\d+(\.?\d+)?\s*kV$/)) {
                        console.log('[Create] Erreur: Tension primaire invalide', equipement.tension_primaire);
                        showPopup('La tension primaire doit être une valeur numérique, ex. 20 ou 20 kV.', '', () => {});
                        return;
                    }
                    if (equipement.tension_secondaire && !equipement.tension_secondaire.match(/^\d+(\.?\d+)?\s*V$/)) {
                        console.log('[Create] Erreur: Tension secondaire invalide', equipement.tension_secondaire);
                        showPopup('La tension secondaire doit être une valeur numérique, ex. 400 ou 400 V.', '', () => {});
                        return;
                    }
                } else if (type === 'cellule_mt') {
                    idField = 'cellule_mt-id';
                    equipement = {
                        ...equipement,
                        id: document.getElementById('cellule_mt-id').value.trim(),
                        tension: normalizeNumericValue(document.getElementById('cellule_mt-tension').value.trim(), 'tension'),
                        courant: normalizeNumericValue(document.getElementById('cellule_mt-courant').value.trim(), 'courant'),
                        pouvoir_coupure: normalizeNumericValue(document.getElementById('cellule_mt-pouvoir_coupure').value.trim(), 'pouvoir_coupure'),
                        frequence: document.getElementById('cellule_mt-frequence').value.trim(),
                        date: document.getElementById('cellule_mt-date').value.trim()
                    };
                    requiredFields = ['id'];
                    if (equipement.courant && !equipement.courant.match(/^\d+(\.?\d+)?\s*A$/)) {
                        console.log('[Create] Erreur: Courant invalide', equipement.courant);
                        showPopup('Le courant doit être une valeur numérique, ex. 630 ou 630 A.', '', () => {});
                        return;
                    }
                    if (equipement.pouvoir_coupure && !equipement.pouvoir_coupure.match(/^\d+(\.?\d+)?\s*kA$/)) {
                        console.log('[Create] Erreur: Pouvoir de coupure invalide', equipement.pouvoir_coupure);
                        showPopup('Le pouvoir de coupure doit être une valeur numérique, ex. 25 ou 25 kA.', '', () => {});
                        return;
                    }
                    if (equipement.tension && !equipement.tension.match(/^\d+(\.?\d+)?\s*kV$/)) {
                        console.log('[Create] Erreur: Tension invalide', equipement.tension);
                        showPopup('La tension doit être une valeur numérique, ex. 20 ou 20 kV.', '', () => {});
                        return;
                    }
                } else if (type === 'cable_gaine') {
                    idField = 'cable_gaine-id';
                    equipement = {
                        ...equipement,
                        id: document.getElementById('cable_gaine-id').value.trim(),
                        type_cable: document.getElementById('cable_gaine-type').value,
                        section: normalizeNumericValue(document.getElementById('cable_gaine-section').value.trim(), 'cable_section'),
                        longueur: normalizeNumericValue(document.getElementById('cable_gaine-longueur').value.trim(), 'longueur'),
                        courant_admissible: normalizeNumericValue(document.getElementById('cable_gaine-courant').value.trim(), 'courant_admissible'),
                        date: document.getElementById('cable_gaine-date').value.trim()
                    };
                    requiredFields = ['id'];
                    if (equipement.section && !equipement.section.match(/^\d+(\.?\d+)?\s*mm²$/)) {
                        console.log('[Create] Erreur: Section invalide', equipement.section);
                        showPopup('La section doit être une valeur numérique, ex. 240 ou 240 mm².', '', () => {});
                        return;
                    }
                    if (equipement.longueur && !equipement.longueur.match(/^\d+(\.?\d+)?\s*m$/)) {
                        console.log('[Create] Erreur: Longueur invalide', equipement.longueur);
                        showPopup('La longueur doit être une valeur numérique, ex. 50 ou 50 m.', '', () => {});
                        return;
                    }
                    if (equipement.courant_admissible && !equipement.courant_admissible.match(/^\d+(\.?\d+)?\s*A$/)) {
                        console.log('[Create] Erreur: Courant admissible invalide', equipement.courant_admissible);
                        showPopup('Le courant admissible doit être une valeur numérique, ex. 400 ou 400 A.', '', () => {});
                        return;
                    }
                }

                console.log('[Create] Équipement à ajouter:', equipement);
                if (!equipement.id) {
                    console.log('[Create] Erreur: ID vide');
                    showPopup(`L\'ID de l\'équipement est obligatoire (ex. ${type === 'disjoncteur' ? '11F1 Compresseur' : type === 'transformateur' ? 'TR1-1600' : type === 'cellule_mt' ? 'CM1-01' : 'CB1-01'}).`, '', () => {});
                    return;
                }
                if (!validateEquipementId(equipement.id)) {
                    console.log('[Create] Erreur: ID invalide', equipement.id);
                    showPopup('L\'ID de l\'équipement contient des caractères non autorisés. Utilisez lettres (y compris accentuées), chiffres, espaces, tirets, underscores ou deux-points.', '', () => {});
                    return;
                }
                for (const field of requiredFields) {
                    if (!equipement[field]) {
                        console.log('[Create] Erreur: Champ requis vide', field);
                        showPopup(`Le champ ${field === 'id' ? 'ID' : field === 'marque' ? 'Marque' : 'Référence'} est requis.`, '', () => {});
                        return;
                    }
                }
                if (equipements.some(e => e.id === equipement.id)) {
                    console.log('[Create] Erreur: ID déjà utilisé dans le tableau local', equipement.id);
                    showPopup('Cet ID est déjà utilisé dans ce tableau. Choisissez un ID unique.', '', () => {});
                    return;
                }
                equipements.push(equipement);
                console.log('[Create] Équipement ajouté:', equipement.id);
                if (type === 'disjoncteur') {
                    const select = document.getElementById('equipement-existant');
                    const existingOptions = Array.from(select.options).map(opt => opt.value);
                    if (!existingOptions.includes(JSON.stringify({ ...equipement, equipmentType: 'disjoncteur' }))) {
                        const option = document.createElement('option');
                        option.value = JSON.stringify({ ...equipement, equipmentType: 'disjoncteur' });
                        option.textContent = `${equipement.marque} ${equipement.ref} (Disjoncteur)`;
                        select.appendChild(option);
                        console.log('[Create] Disjoncteur ajouté à la liste déroulante:', `${equipement.marque} ${equipement.ref}`);
                    }
                }
                afficherEquipements();
                document.getElementById('equipement-form').classList.add('hidden');
                document.getElementById('equipement-marque').value = '';
                document.getElementById('equipement-ref').value = '';
            }

            function designerPrincipal(index) {
                console.log('[Create] Bouton Principal cliqué, index:', index);
                const equipement = equipements[index];
                if (!equipement || equipement.equipmentType !== 'disjoncteur') {
                    console.error('[Create] Équipement non trouvé ou non disjoncteur à l\'index:', index);
                    showPopup('Seul un disjoncteur peut être désigné comme principal.', '', () => {});
                    return;
                }
                showPopup(`Voulez-vous désigner le disjoncteur ${equipement.id} comme principal ?`, '', () => {
                    console.log('[Create] Confirmation principal pour index:', index);
                    equipements.forEach(e => { if (e.equipmentType === 'disjoncteur') e.isPrincipal = false; });
                    equipements[index].isPrincipal = true;
                    equipements[index].linkedTableauIds = [];
                    disjoncteurPrincipalIndex = index;
                    equipements.forEach((e, i) => {
                        if (e.equipmentType === 'disjoncteur') {
                            console.log('[Create] Disjoncteur', e.id, 'isPrincipal:', e.isPrincipal);
                        }
                    });
                    afficherEquipements();
                    hidePopup();
                    console.log('[Create] Disjoncteur principal mis à jour, index:', disjoncteurPrincipalIndex, 'ID:', equipement.id);
                });
            }

            function supprimerEquipement(index) {
                console.log('[Create] Bouton Supprimer cliqué, index:', index);
                const equipement = equipements[index];
                if (!equipement) {
                    console.error('[Create] Équipement non trouvé à l\'index:', index);
                    showPopup('Erreur: Équipement non trouvé.', '', () => {});
                    return;
                }
                showPopup(`Voulez-vous supprimer l\'équipement ${equipement.id} ?`, '', () => {
                    console.log('[Create] Confirmation suppression équipement:', equipement.id);
                    equipements.splice(index, 1);
                    if (equipement.equipmentType === 'disjoncteur' && index === disjoncteurPrincipalIndex) {
                        disjoncteurPrincipalIndex = null;
                        console.log('[Create] Disjoncteur principal supprimé, réinitialisation index');
                    } else if (equipement.equipmentType === 'disjoncteur' && disjoncteurPrincipalIndex > index) {
                        disjoncteurPrincipalIndex--;
                        console.log('[Create] Ajustement disjoncteurPrincipalIndex:', disjoncteurPrincipalIndex);
                    }
                    afficherEquipements();
                    hidePopup();
                    console.log('[Create] Équipement supprimé:', equipement.id);
                });
            }

            function afficherEquipements() {
                console.log('[Create] Affichage équipements, total:', equipements.length, 'principal index:', disjoncteurPrincipalIndex);
                const tbody = document.querySelector('#equipements-table tbody');
                tbody.innerHTML = '';
                const idCounts = {};
                equipements.forEach(e => {
                    idCounts[e.id] = (idCounts[e.id] || 0) + 1;
                });
                equipements.sort((a, b) => a.id.localeCompare(b.id));
                equipements.forEach((e, index) => {
                    const isPrincipal = e.equipmentType === 'disjoncteur' && e.isPrincipal || false;
                    console.log('[Create] Équipement', e.id, 'index:', index, 'type:', e.equipmentType, 'isPrincipal:', isPrincipal);
                    const hasConflict = idCounts[e.id] > 1;
                    const row = document.createElement('tr');
                    if (isPrincipal) row.className = 'disjoncteur-principal';
                    const idCell = document.createElement('td');
                    idCell.className = `p-2 ${hasConflict ? 'conflict' : ''}`;
                    idCell.textContent = `${e.id}${hasConflict ? ' (Conflit)' : ''}`;
                    row.appendChild(idCell);
                    const typeCell = document.createElement('td');
                    typeCell.className = 'p-2';
                    typeCell.textContent = e.equipmentType === 'disjoncteur' ? 'Disjoncteur' :
                                           e.equipmentType === 'transformateur' ? 'Transformateur' :
                                           e.equipmentType === 'cellule_mt' ? 'Cellule MT' :
                                           e.equipmentType === 'cable_gaine' ? (e.type_cable === 'cable' ? 'Câble' : 'Gaine à Barre') : 'Inconnu';
                    row.appendChild(typeCell);
                    const marqueCell = document.createElement('td');
                    marqueCell.className = 'p-2';
                    marqueCell.textContent = e.marque || 'N/A';
                    row.appendChild(marqueCell);
                    const refCell = document.createElement('td');
                    refCell.className = 'p-2';
                    refCell.textContent = e.ref || 'N/A';
                    row.appendChild(refCell);
                    const principalCell = document.createElement('td');
                    principalCell.className = 'p-2 text-center';
                    principalCell.textContent = isPrincipal ? '⭐ Principal' : '';
                    row.appendChild(principalCell);
                    const liaisonCell = document.createElement('td');
                    liaisonCell.className = 'p-2';
                    liaisonCell.textContent = isPrincipal ? 'Lié à tous les avals' :
                                              e.equipmentType === 'disjoncteur' && e.linkedTableauIds?.length > 0 ? `Lié à ${e.linkedTableauIds.join(', ')}` :
                                              'Non lié';
                    row.appendChild(liaisonCell);
                    const actionsCell = document.createElement('td');
                    actionsCell.className = 'p-2 flex space-x-2';
                    const supprimerBtn = document.createElement('button');
                    supprimerBtn.className = 'bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 touch-friendly';
                    supprimerBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    supprimerBtn.onclick = () => supprimerEquipement(index);
                    actionsCell.appendChild(supprimerBtn);
                    if (e.equipmentType === 'disjoncteur' && !isPrincipal) {
                        const principalBtn = document.createElement('button');
                        principalBtn.className = 'bg-yellow-600 text-white px-2 py-1 rounded hover:bg-yellow-700 touch-friendly';
                        principalBtn.innerHTML = '<i class="fas fa-star"></i>';
                        principalBtn.onclick = () => designerPrincipal(index);
                        actionsCell.appendChild(principalBtn);
                    }
                    row.appendChild(actionsCell);
                    tbody.appendChild(row);
                });
                if (equipements.length === 0) {
                    const emptyRow = document.createElement('tr');
                    emptyRow.innerHTML = '<td colspan="7" class="p-2 text-center text-gray-500">Aucun équipement à afficher</td>';
                    tbody.appendChild(emptyRow);
                }
            }

            async function enregistrerTableau() {
                console.log('[Create] Bouton Enregistrer le tableau cliqué');
                const tableauId = document.getElementById('tableau-id').value.trim();
                const currentIsSiteMain = document.getElementById('tableau-issitemain').checked;
                isHTA = document.getElementById('tableau-isHTA').checked;
                const htaData = collectHTAData();
                console.log('[Create] Tableau ID:', tableauId, 'Équipements:', equipements.length, 'issitemain:', currentIsSiteMain, 'isHTA:', isHTA, 'htaData:', htaData);
                if (!tableauId) {
                    console.log('[Create] Erreur: ID tableau vide');
                    showPopup('Veuillez entrer un identifiant pour le tableau.', '', () => {});
                    return;
                }
                if (!validateEquipementId(tableauId)) {
                    console.log('[Create] Erreur: ID tableau invalide', tableauId);
                    showPopup('L\'ID du tableau contient des caractères non autorisés. Utilisez lettres (y compris accentuées), chiffres, espaces, tirets, underscores ou deux-points.', '', () => {});
                    return;
                }
                if (isHTA && !htaData) {
                    console.log('[Create] Erreur: Données HTA invalides');
                    return;
                }
                if (equipements.length === 0) {
                    console.log('[Create] Erreur: Aucun équipement');
                    showPopup('Veuillez ajouter au moins un équipement.', '', () => {});
                    return;
                }
                try {
                    const disjoncteurs = equipements.filter(e => e.equipmentType === 'disjoncteur').map(d => ({
                        ...d,
                        icn: normalizeNumericValue(d.icn, 'icn'),
                        ics: normalizeNumericValue(d.ics, 'ics'),
                        in: normalizeNumericValue(d.in, 'in'),
                        ir: normalizeNumericValue(d.ir, 'ir'),
                        triptime: normalizeNumericValue(d.triptime, 'triptime'),
                        section: normalizeNumericValue(d.section, 'section')
                    }));
                    const autresEquipements = equipements.filter(e => e.equipmentType !== 'disjoncteur').map(e => ({
                        ...e,
                        puissance: e.equipmentType === 'transformateur' ? normalizeNumericValue(e.puissance, 'transformerPower') : e.puissance,
                        tension: e.equipmentType === 'cellule_mt' ? normalizeNumericValue(e.tension, 'tension') : e.tension,
                        tension_primaire: e.equipmentType === 'transformateur' ? normalizeNumericValue(e.tension_primaire, 'tension_primaire') : e.tension_primaire,
                        tension_secondaire: e.equipmentType === 'transformateur' ? normalizeNumericValue(e.tension_secondaire, 'tension_secondaire') : e.tension_secondaire,
                        courant: e.equipmentType === 'cellule_mt' ? normalizeNumericValue(e.courant, 'courant') : e.courant,
                        pouvoir_coupure: e.equipmentType === 'cellule_mt' ? normalizeNumericValue(e.pouvoir_coupure, 'pouvoir_coupure') : e.pouvoir_coupure,
                        section: e.equipmentType === 'cable_gaine' ? normalizeNumericValue(e.section, 'cable_section') : e.section,
                        longueur: e.equipmentType === 'cable_gaine' ? normalizeNumericValue(e.longueur, 'longueur') : e.longueur,
                        courant_admissible: e.equipmentType === 'cable_gaine' ? normalizeNumericValue(e.courant_admissible, 'courant_admissible') : e.courant_admissible
                    }));
                    console.log('[Create] Envoi requête POST /api/tableaux', { id: tableauId, disjoncteurs: disjoncteurs.length, autresEquipements: autresEquipements.length, issitemain: currentIsSiteMain, isHTA, htaData });
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const response = await fetch('/api/tableaux', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: tableauId, disjoncteurs, issitemain: currentIsSiteMain, isHTA, htaData, autresEquipements }),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    const data = await response.json();
                    console.log('[Create] Réponse serveur:', data);
                    if (response.ok) {
                        showPopup('Tableau enregistré avec succès !', '', () => {
                            console.log('[Create] Tableau enregistré, redirection vers view.html');
                            window.location.href = 'view.html';
                        });
                    } else {
                        console.log('[Create] Erreur serveur:', data.error);
                        showPopup('Erreur lors de l\'enregistrement: ' + data.error, '', () => {});
                    }
                } catch (error) {
                    console.error('[Create] Erreur enregistrement:', error);
                    showPopup('Erreur lors de l\'enregistrement: ' + error.message, '', () => {});
                }
            }

            window.onload = () => {
                console.log('[Create] Initialisation page create à', new Date().toLocaleString('fr-FR'));
                if (window.location.protocol === 'file:') {
                    showPopup('Erreur : Veuillez exécuter cette page via un serveur web (ex. http://localhost:3000/create.html) pour accéder à l\'API.', '', () => {});
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
