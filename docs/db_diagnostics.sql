
-- db_diagnostics.sql — requêtes utiles pour Neon (Postgres)

-- 1) Aperçu des utilisateurs
SELECT id, email, name, created_at
FROM public.users
ORDER BY id;

-- 2) Espaces (accounts)
SELECT id, name, created_at
FROM public.accounts
ORDER BY id;

-- 3) Rôles par espace
SELECT ua.user_id, u.email, ua.account_id, a.name AS account_name, ua.role
FROM public.user_accounts ua
JOIN public.users u ON u.id = ua.user_id
JOIN public.accounts a ON a.id = ua.account_id
ORDER BY ua.account_id, ua.user_id;

-- 4) Abonnements (compte + utilisateur)
SELECT id, account_id, user_id, app_code, scope, tier, seats_total, status, started_at, ends_at
FROM public.subscriptions
ORDER BY account_id, app_code, id;

-- 5) Assignations de sièges
SELECT la.subscription_id, s.account_id, s.app_code, s.tier, la.user_id, u.email, la.assigned_at
FROM public.license_assignments la
JOIN public.subscriptions s ON s.id = la.subscription_id
JOIN public.users u ON u.id = la.user_id
ORDER BY la.subscription_id, la.user_id;

-- 6) Vérifier les abonnements actifs par compte
SELECT account_id, app_code,
       MAX(CASE WHEN status='active' THEN tier ELSE NULL END) AS active_tier,
       MAX(CASE WHEN status='active' THEN seats_total ELSE NULL END) AS active_seats
FROM public.subscriptions
WHERE scope='account'
GROUP BY account_id, app_code
ORDER BY account_id, app_code;

-- 7) Repérer des abonnements actifs sans owner dans l’espace
SELECT s.account_id, s.app_code, s.id AS subscription_id
FROM public.subscriptions s
LEFT JOIN LATERAL (
  SELECT 1 FROM public.user_accounts ua WHERE ua.account_id = s.account_id AND ua.role='owner' LIMIT 1
) own ON true
WHERE s.status='active' AND own IS NULL;

-- 8) Repérer des assignations sans abonnement correspondant
SELECT la.*
FROM public.license_assignments la
LEFT JOIN public.subscriptions s ON s.id = la.subscription_id
WHERE s.id IS NULL;

-- 9) Repérer des `user_accounts` orphelins (utilisateur ou compte supprimé)
SELECT ua.*
FROM public.user_accounts ua
LEFT JOIN public.users u ON u.id = ua.user_id
LEFT JOIN public.accounts a ON a.id = ua.account_id
WHERE u.id IS NULL OR a.id IS NULL;

-- 10) Nettoyage (EXEMPLE — à exécuter avec prudence)
-- Supprimer les assignations orphelines:
-- DELETE FROM public.license_assignments la
-- USING public.subscriptions s
-- WHERE la.subscription_id = s.id IS NULL;

-- Annuler tous les anciens abonnements actifs d'un compte/app (exemple pour account_id=42, app_code='ATEX'):
-- UPDATE public.subscriptions
-- SET status='canceled', ends_at=NOW()
-- WHERE account_id=42 AND app_code='ATEX' AND status='active';

-- Créer/forcer un abonnement Pro (exemple):
-- INSERT INTO public.subscriptions(account_id, app_code, scope, tier, seats_total, status)
-- VALUES (42, 'ATEX', 'account', 2, 1, 'active');

-- Assigner un siège à un user (exemple):
-- INSERT INTO public.license_assignments(subscription_id, user_id) VALUES (<sub_id>, <user_id>) ON CONFLICT DO NOTHING;
