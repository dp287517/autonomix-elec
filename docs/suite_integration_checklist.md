
# Checklist — Ajouter une nouvelle suite (ex: electrical-safety)
1) ACCESS_POLICY: définir tiers et mapping sous-cards.
2) Dashboard: carte principale + sous-cards; lien "Gérer l’abonnement" avec ?account_id=:id.
3) Garde: data-suite / data-min-tier sur pages + `app_guard.js` (bloque 403 et siège manquant).
4) API: réutiliser `/subscriptions` et `/licenses` avec `appCode` de la suite.
5) Invitation: `/accounts/invite` (owner/admin), message clair si 403.
6) Owners: `/accounts/:id/owners` (auth requis, même si non-membre) pour contacter le propriétaire.
7) Paiement: brancher `startCheckout({tier, accountId})` dans `subscription_*.js`.
8) Tests: création espace → plan → gating; changement d’espace → persiste; non-membre → tout verrouillé.
