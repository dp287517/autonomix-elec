-- 001_multitenant.sql
-- AutonomiX — Étape 1 : Modèle multi-tenant (Neon/Postgres)
-- Crée les tables de comptes, les liens utilisateur<->compte, la hiérarchie optionnelle,
-- les abonnements et ajoute account_id/created_by sur atex_equipments.
-- Sûr à rejouer (IF NOT EXISTS) et emballé dans une transaction.

BEGIN;

-- ===== Comptes (tenants) =====
CREATE TABLE IF NOT EXISTS public.accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  parent_account_id BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_parent_idx ON public.accounts(parent_account_id);

-- ===== Liens utilisateur <-> compte (rôle) =====
CREATE TABLE IF NOT EXISTS public.user_accounts (
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id),
  CONSTRAINT user_accounts_role_chk CHECK (role IN ('owner','admin','member'))
);

CREATE INDEX IF NOT EXISTS user_accounts_user_idx ON public.user_accounts(user_id);
CREATE INDEX IF NOT EXISTS user_accounts_account_idx ON public.user_accounts(account_id);

-- ===== Hiérarchie utilisateur -> utilisateur (optionnel) =====
CREATE TABLE IF NOT EXISTS public.user_links (
  manager_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  child_user_id   BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (manager_user_id, child_user_id)
);

-- ===== Abonnements (par compte et/ou par utilisateur) =====
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|trialing|past_due|canceled
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS subscriptions_account_idx ON public.subscriptions(account_id);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON public.subscriptions(user_id);

-- ===== Données ATEX : rattachement au compte + auteur =====
ALTER TABLE IF EXISTS public.atex_equipments
  ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES public.accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS atex_equipments_account_idx ON public.atex_equipments(account_id);

COMMIT;
