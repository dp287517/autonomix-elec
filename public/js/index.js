// public/js/index.js
(function () {
  // Met l'année au footer, sans inline
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // (Optionnel) init i18n local si tu veux traduire quelques libellés
  if (typeof i18next !== 'undefined') {
    i18next.init({
      fallbackLng: 'fr',
      resources: {
        fr: { translation: {
          "Accueil": "Accueil",
          "Créer un tableau": "Créer un tableau",
          "Voir les tableaux": "Voir les tableaux",
          "Sélectivité": "Sélectivité",
          "Obsolescence": "Obsolescence",
          "Niveau de Défaut": "Niveau de Défaut",
          "Risques": "Risques",
          "Urgence Distribution": "Urgence Distribution",
          "Rapports": "Rapports"
        } }
      }
    }).then(() => {
      // Exemple d’utilisation si besoin
      const navHome = document.getElementById('nav_home');
      if (navHome) navHome.textContent = i18next.t('Accueil');
    });
  }
})();
