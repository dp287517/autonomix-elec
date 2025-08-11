# Refactor Autonomix Elec (Express)

Ce refactor découpe votre gros `server.js` en modules **sans changer les endpoints**.

## Lancer en local

```bash
cp .env.example .env
# éditez .env pour DATABASE_URL et OPENAI_API_KEY
npm install
npm start
```

## Déployer sur Render
- Conservez le même repo GitHub.
- Render détectera `app.js` comme point d'entrée (ou configurez `Start Command: node app.js`).

## Structure

- `app.js` — point d'entrée Express
- `config/` — DB et initialisation des tables (`initDb()`)
- `routes/` — routes unitaires par domaine (tableaux, obsolescence, reports, maintenance, emergency, safety, projects, trades, translate)
- `utils/` — fonctions utilitaires (validation, calculs élec)
- `services/` — services de génération PDF et calculs d'obsolescence
- `middleware/` — logger & gestion d'erreurs

Tous les **chemins d'API** restent identiques:
- `/api/tableaux`, `/api/tableaux/:id`, `/api/equipements`, etc.
- `/api/obsolescence*`, `/api/selectivity`, `/api/arc-flash`, `/api/fault-level*`
- `/api/maintenance-org`, `/api/emergency-*`, `/api/safety-*`
- `/api/projects*`, `/api/project-*`
- `/trades*`
- `/api/translate`

## Conseils
- Testez localement avant de pousser.
- Si certains écrans front chargent des fichiers statiques, le répertoire `public/` reste servi par Express.
