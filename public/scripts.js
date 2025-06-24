i18next.init({
    lng: localStorage.getItem('language') || 'fr',
    resources: {
        fr: {
            translation: {
                title: "Autonomix Elec - Accueil",
                welcome: "Bienvenue sur Autonomix Elec",
                description: "Cet outil vous permet de gérer vos tableaux électriques facilement.",
                how_to_use: "Comment utiliser l'outil",
                nav_home: "Accueil",
                nav_create: "Créer un tableau",
                nav_view: "Voir les tableaux",
                nav_selectivity: "Sélectivité",
                nav_obsolescence: "Obsolescence",
                nav_fault_level: "Évaluation du Niveau de Défaut",
                nav_hazards: "Évaluation des Risques",
                nav_maintenance: "Organigramme Maintenance",
                nav_emergency: "Urgence Distribution",
                nav_reports: "Rapports",
                nav_safety: "Programme de Sécurité Électrique",
                instruction_1: "Consultez cette page pour comprendre l'outil.",
                instruction_2: "Allez à la page <a href='create.html' class='text-blue-400 hover:underline'>Créer un tableau</a> pour ajouter un nouveau tableau électrique.",
                instruction_3: "Entrez les informations du tableau, comme son identifiant (ex. 27-9-G) et les disjoncteurs associés.",
                instruction_4: "Utilisez l'API OpenAI pour récupérer automatiquement les caractéristiques des disjoncteurs en entrant la marque et la référence.",
                instruction_5: "Enregistrez le tableau dans la base de données.",
                instruction_6: "Consultez la page <a href='view.html' class='text-blue-400 hover:underline'>Voir les tableaux</a> pour modifier ou supprimer un tableau existant.",
                instruction_7: "Visitez la page <a href='selectivity.html' class='text-blue-400 hover:underline'>Sélectivité</a> pour analyser la sélectivité entre les disjoncteurs et tableaux.",
                instruction_8: "Consultez la page <a href='obsolescence.html' class='text-blue-400 hover:underline'>Obsolescence</a> pour suivre la durée de vie des disjoncteurs et planifier les remplacements.",
                instruction_9: "Accédez à la page <a href='fault_level_assessment.html' class='text-blue-400 hover:underline'>Évaluation du Niveau de Défaut</a> pour analyser les courants de court-circuit et compléter les données nécessaires.",
                instruction_10: "Explorez la page <a href='hazards_assessment.html' class='text-blue-400 hover:underline'>Évaluation des Risques</a> pour identifier les risques électriques (arcs, chocs, surchauffes) et mettre à jour les données manquantes.",
                instruction_11: "Consultez la page <a href='maintenance_chart.html' class='text-blue-400 hover:underline'>Organigramme Maintenance</a> pour visualiser la structure du département de maintenance.",
                instruction_12: "Utilisez la page <a href='distribution_emergency.html' class='text-blue-400 hover:underline'>Urgence Distribution</a> pour signaler et gérer les pannes électriques critiques.",
                instruction_13: "Générez des rapports détaillés via la page <a href='reports.html' class='text-blue-400 hover:underline'>Rapports</a> pour exporter vos analyses en PDF.",
                instruction_14: "Accédez à la page <a href='electrical_safety_program.html' class='text-blue-400 hover:underline'>Programme de Sécurité Électrique</a> pour gérer les procédures de sécurité, la maintenance préventive et les formations du personnel.",
                instruction_15: "Contrôle des Disjoncteurs"
            }
        },
        en: {
            translation: {
                title: "Autonomix Elec - Home",
                welcome: "Welcome to Autonomix Elec",
                description: "This tool allows you to manage your electrical panels easily.",
                how_to_use: "How to use the tool",
                nav_home: "Home",
                nav_create: "Create a Panel",
                nav_view: "View Panels",
                nav_selectivity: "Selectivity",
                nav_obsolescence: "Obsolescence",
                nav_fault_level: "Fault Level Assessment",
                nav_hazards: "Hazards Assessment",
                nav_maintenance: "Maintenance Chart",
                nav_emergency: "Distribution Emergency",
                nav_reports: "Reports",
                nav_safety: "Electrical Safety Program",
                instruction_1: "Visit this page to understand the tool.",
                instruction_2: "Go to the <a href='create.html' class='text-blue-400 hover:underline'>Create a Panel</a> page to add a new electrical panel.",
                instruction_3: "Enter the panel information, such as its identifier (e.g., 27-9-G) and associated breakers.",
                instruction_4: "Use the OpenAI API to automatically retrieve breaker characteristics by entering the brand and reference.",
                instruction_5: "Save the panel in the database.",
                instruction_6: "Visit the <a href='view.html' class='text-blue-400 hover:underline'>View Panels</a> page to edit or delete an existing panel.",
                instruction_7: "Go to the <a href='selectivity.html' class='text-blue-400 hover:underline'>Selectivity</a> page to analyze selectivity between breakers and panels.",
                instruction_8: "Check the <a href='obsolescence.html' class='text-blue-400 hover:underline'>Obsolescence</a> page to track breaker lifespan and plan replacements.",
                instruction_9: "Access the <a href='fault_level_assessment.html' class='text-blue-400 hover:underline'>Fault Level Assessment</a> page to analyze short-circuit currents and complete necessary data.",
                instruction_10: "Explore the <a href='hazards_assessment.html' class='text-blue-400 hover:underline'>Hazards Assessment</a> page to identify electrical risks (arcs, shocks, overheating) and update missing data.",
                instruction_11: "Check the <a href='maintenance_chart.html' class='text-blue-400 hover:underline'>Maintenance Chart</a> page to visualize the maintenance department structure.",
                instruction_12: "Use the <a href='distribution_emergency.html' class='text-blue-400 hover:underline'>Distribution Emergency</a> page to report and manage critical electrical outages.",
                instruction_13: "Generate detailed reports via the <a href='reports.html' class='text-blue-400 hover:underline'>Reports</a> page to export your analyses in PDF.",
                instruction_14: "Access the <a href='electrical_safety_program.html' class='text-blue-400 hover:underline'>Electrical Safety Program</a> page to manage safety procedures, preventive maintenance, and staff training.",
                instruction_15: "Breaker Control"
            }
        }
    }
}, function(err, t) {
    updateContent();

    document.getElementById('language-selector').addEventListener('change', function() {
        const selectedLang = this.value;
        if (!i18next.existsResourceBundle(selectedLang, 'translation')) {
            loadTranslations(selectedLang).then(translations => {
                i18next.addResourceBundle(selectedLang, 'translation', translations);
                i18next.changeLanguage(selectedLang, () => {
                    localStorage.setItem('language', selectedLang);
                    updateContent();
                    document.documentElement.lang = selectedLang;
                });
            }).catch(error => {
                console.error('Erreur lors du chargement des traductions:', error);
                alert('Erreur lors du changement de langue.');
            });
        } else {
            i18next.changeLanguage(selectedLang, () => {
                localStorage.setItem('language', selectedLang);
                updateContent();
                document.documentElement.lang = selectedLang;
            });
        }
    });
});

function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.innerHTML = i18next.t(key);
    });
    document.title = i18next.t('title');
}

async function loadTranslations(targetLang) {
    const frTranslations = i18next.getResourceBundle('fr', 'translation');
    const translations = {};
    for (const key in frTranslations) {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: frTranslations[key], targetLang })
        });
        const result = await response.json();
        if (result.error) {
            throw new Error(result.error);
        }
        translations[key] = result.translatedText;
    }
    return translations;
}