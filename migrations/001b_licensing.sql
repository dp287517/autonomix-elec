-- 001b_licensing.sql
-- AutonomiX — Étape 1B : Modèle de licences multi‑apps avec niveaux (1..3),
-- sièges (seat-based), payeur (admin/owner) et rattachement compte ou utilisateur.

BEGIN;

-- ===== Applications (produits) : ex. ATEX, EPD, etc. =====
CREATE TABLE IF NOT EXISTS public.apps (
  code TEXT PRIMARY KEY,        -- ex: 'ATEX', 'EPD'
  name TEXT NOT NULL            -- ex: 'ATEX Control', 'EPD Manager'
);

-- ===== Plans par application (tiers 1..3) =====
CREATE TABLE IF NOT EXISTS public.app_plans (
  app_code TEXT NOT NULL REFERENCES public.apps(code) ON DELETE CASCADE,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  name TEXT NOT NULL,           -- ex: 'Niveau 1', 'Niveau 2', 'Niveau 3'
  PRIMARY KEY (app_code, tier)
);

-- ===== Pages / fonctionnalités et niveau minimal requis =====
-- Permet de dire: 'atex-control.html' -> min_tier=1 pour app 'ATEX'
--                  'epd.html'         -> min_tier=2 pour app 'EPD'
CREATE TABLE IF NOT EXISTS public.app_pages (
  page_slug TEXT PRIMARY KEY,   -- ex: 'atex-control', 'epd'
  app_code TEXT NOT NULL REFERENCES public.apps(code) ON DELETE CASCADE,
  min_tier SMALLINT NOT NULL CHECK (min_tier BETWEEN 1 AND 3)
);

-- ===== Subscriptions : on étend la table existante =====
-- Ajout de colonnes nécessaires au modèle d'abonnement/licences
ALTER TABLE IF EXISTS public.subscriptions
  ADD COLUMN IF NOT EXISTS app_code TEXT REFERENCES public.apps(code) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tier SMALLINT CHECK (tier BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS scope TEXT CHECK (scope IN ('account','user')), -- qui est détenteur?
  ADD COLUMN IF NOT EXISTS seats_total INTEGER CHECK (seats_total IS NULL OR seats_total >= 0),
  ADD COLUMN IF NOT EXISTS payer_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payer_account_id BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL;

-- Index utiles
CREATE INDEX IF NOT EXISTS subscriptions_app_idx    ON public.subscriptions(app_code);
CREATE INDEX IF NOT EXISTS subscriptions_tier_idx   ON public.subscriptions(tier);
CREATE INDEX IF NOT EXISTS subscriptions_scope_idx  ON public.subscriptions(scope);
CREATE INDEX IF NOT EXISTS subscriptions_payer_u_idx ON public.subscriptions(payer_user_id);
CREATE INDEX IF NOT EXISTS subscriptions_payer_a_idx ON public.subscriptions(payer_account_id);

-- ===== Affectations de sièges (licences utilisateur) =====
-- Quand une souscription est "scope=account" et 'seats_total' > 0, on assigne des utilisateurs.
CREATE TABLE IF NOT EXISTS public.license_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  UNIQUE(subscription_id, user_id)
);

-- Vue pratique: quelles entitlements a un user pour une app donnée ?
-- (facultatif: les vues matérialisées peuvent venir plus tard)
-- Ici on laisse au backend la logique d'agrégation.

COMMIT;
