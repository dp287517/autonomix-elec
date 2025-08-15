
# Playbook — Ajouter une nouvelle suite d'applications (ex: ELECTRICAL-SAFETY)

Ce document liste **exactement** ce qu’il faut faire pour ajouter une suite d’apps comme ATEX,
avec mêmes règles de licence (Free/Personal/Pro) et sous-cards.

---

## 1) Modèle de licence (tiers)
Par convention :
- `0 = Free`
- `1 = Personal`
- `2 = Pro`

Détermine **pour chaque sous-app** le **minTier** requis.
Exemple ELECTRICAL-SAFETY :
- Electrical Control → minTier **0**
- Risk Assessment → minTier **1**
- Procedures (SOP) → minTier **2**

> Si tu veux un modèle par siège (seatful) ou sans siège (seatless), utilise les tables existantes :
> - `subscriptions.scope='account'` + `seats_total IS NULL` → seatless (illimité)
> - `subscriptions.scope='account'` + `seats_total` (entier) → seatful (assignations via `license_assignments`).

---

## 2) Front — Dashboard
1. Dans `public/js/dashboard.js` :
   - Ajoute la suite et ses sous-apps dans `APPS` et `ACCESS_POLICY` :
     ```js
     const APPS = [
       // ... ATEX ...
       { key: 'Electrical Control', title: 'Electrical Control', href: 'electrical-control.html', group: 'ELECTRICAL', sub: '…' },
       { key: 'Electrical RA', title: 'Risk Assessment', href: 'electrical-ra.html', group: 'ELECTRICAL', sub: '…' },
       { key: 'Electrical SOP', title: 'Procedures (SOP)', href: 'electrical-sop.html', group: 'ELECTRICAL', sub: '…' },
     ];
     const ACCESS_POLICY = {
       'ATEX': { tiers: { 'ATEX Control':0, 'EPD':1, 'IS Loop':2 } },
       'ELECTRICAL': { tiers: { 'Electrical Control':0, 'Electrical RA':1, 'Electrical SOP':2 } }
     };
     ```
   - Crée une **carte principale** ELECTRICAL (copie de la carte ATEX) dans `public/dashboard.html`
     et un conteneur `<div id="electricalSubCards">` pour afficher les sous-cards.
   - Ajoute un `renderElectricalSubCards()` calqué sur `renderAtexSubCards()` et un `applyLicensingGating` partagé
     (ou paramétrable par `suiteCode`).

2. Gating (accès aux sous-pages) :
   - Mets ceci en haut de **chaque page** statique de la suite (ex: `electrical-ra.html`) :
     ```html
     <html lang="fr" data-suite="ELECTRICAL" data-min-tier="1" data-redirect="subscription_electrical.html">
     <script src="js/app_guard.js" defer></script>
     ```

3. Page d’abonnement de la suite (optionnel si tu veux séparer) :
   - Duplique `public/subscription_atex.html` → `public/subscription_electrical.html`
   - Dans `public/js/subscription_*.js`, remplace `APP = 'ATEX'` par `APP = 'ELECTRICAL'`.
   - Les endpoints **restent identiques** (seul `:appCode` change).

---

## 3) API — rien à recoder
Les routes existantes sont **génériques** et fonctionnent pour n’importe quel `appCode` :
- `GET /api/licenses/:appCode?account_id=...`
- `GET /api/subscriptions/:appCode?account_id=...`
- `POST /api/subscriptions/:appCode?account_id=...`
- `POST /api/accounts/invite?account_id=...` (optionnel pour attribuer des sièges sur un plan seatful)
- `GET /api/accounts/members/:appCode?account_id=...`

**Tu n’as pas besoin** d’ajouter de nouvelles routes pour une nouvelle suite.
Il suffit d’utiliser un `appCode` différent (ex: `ELECTRICAL`).

---

## 4) Règles d’owner/admin/membre (à retenir)
- **Changer le plan** : **owner uniquement** (POST /subscriptions/:appCode)
- **Supprimer l’espace** : **owner uniquement** (DELETE /accounts/:id)
- **Inviter** : owner **ou** admin
- **Voir la licence** : tout le monde (en v7, /licenses renvoie 200 tier=0 si l’utilisateur n’est **pas** membre de l’espace pour ne pas casser l’UI)

---

## 5) Checklist “anti-oubli”
- [ ] Ajouter la suite + sous-apps dans `APPS` et `ACCESS_POLICY` du dashboard.
- [ ] Créer la **carte principale** + le conteneur de sous-cards.
- [ ] Brancher le **toggle** d’affichage (clic sur la carte principale).
- [ ] Protéger les pages statiques de la suite via `app_guard.js` + `data-suite`/`data-min-tier`/`data-redirect`.
- [ ] Dupliquer la page d’abonnement si tu veux un écran dédié par suite (`subscription_<suite>.html` + JS).
- [ ] Vérifier owner-only sur changement de plan (c’est natif côté API).
- [ ] Tester : Free → Personal → Pro (les sous-cards doivent se dégriser progressivement).
- [ ] Tester l’invitation (si plan seatful, les sièges augmentent automatiquement + assignation).

---

## 6) Notes
- Si tu veux que certaines suites soient **seatless** (pas de sièges), crée la souscription avec `seats_total = NULL`.
- Si tu veux **copier** un plan d’un espace à un autre, réutilise la logique de copie existante (ex: ATEX) côté front
  en appelant `POST /subscriptions/:appCode` avec le bon `account_id` et le `tier` voulu.
