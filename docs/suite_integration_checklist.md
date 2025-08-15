
# Checklist d’intégration — Nouvelle suite d’applications (ex : electrical-safety)

## 1) Modèle d’accès (tiers)
- Définir les niveaux (0=Free, 1=Personal, 2=Pro).
- Cartographier les sous-cards (apps) → niveau minimum requis par app.
  ```js
  // Exemple dans public/js/dashboard.js
  const ACCESS_POLICY = {
    'ELECTRICAL_SAFETY': { tiers: { 'App A':0, 'App B':1, 'App C':2 } }
  };
  ```

## 2) Cartes & routes front
- Ajouter la **carte principale** sur le dashboard (à l’image d’ATEX).
- Générer dynamiquement les **sous-cards** (3 apps) avec data-href = `app.html?account_id=...`.
- Gating via `applyLicensingGating(minTier)` (utilise ACCESS_POLICY).

## 3) Garde d’accès des pages statiques
- En haut de chaque page protégée :
  ```html
  <html lang="fr" data-suite="ELECTRICAL_SAFETY" data-min-tier="1" data-redirect="subscription_electrical_safety.html">
  <script src="js/app_guard.js" defer></script>
  ```
- Option : alias `license_guard.js` si rétro compat nécessaire.

## 4) Abonnement / Licences (backend)
- Réutiliser `routes/subscriptions.js` et `routes/licenses.js` tels quels.
- Appeler les endpoints avec `appCode` = `ELECTRICAL_SAFETY`.
- Page de souscription dédiée (copier `subscription_atex.html/js` et renommer).

## 5) Invites & sièges
- Réutiliser `/api/accounts/invite?account_id=...` (augmente sièges + assignation).
- Owner/Admin peuvent inviter, Member non.

## 6) Multi-espaces
- Ne rien changer : `/api/accounts` (création), `/api/accounts/mine` (liste), `localStorage` (sélection), déjà gérés.

## 7) Owner-only
- Les POST `/subscriptions/:appCode` exigent `role === 'owner'` — rien à changer.
- Côté UI, désactiver les boutons si l’utilisateur n’est pas owner.

## 8) Affichage Owner(s)
- `/api/subscriptions/:appCode?account_id=...` renvoie `owners: [{email,name}, ...]`.
- Afficher sur la page d’abonnement : “Owner : …”.

## 9) Tests
- Création d’espace → redirection vers souscription → plan Pro → retour dashboard → cartes déverrouillées.
- Switch entre espaces via sélecteur → vérifie que la sélection **persiste**.
- Page protégée directement (URL) → redirection vers souscription si le tier est insuffisant.
