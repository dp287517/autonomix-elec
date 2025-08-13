-- 001_verify.sql
-- Vérifications rapides après migration

-- 1) Tables
SELECT 'accounts'              AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts'
UNION ALL
SELECT 'user_accounts'         AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='user_accounts'
UNION ALL
SELECT 'user_links'            AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='user_links'
UNION ALL
SELECT 'subscriptions'         AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='subscriptions';

-- 2) Colonnes ATEX
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='atex_equipments' AND column_name IN ('account_id','created_by')
ORDER BY column_name;

-- 3) Index
SELECT indexname
FROM pg_indexes
WHERE schemaname='public' AND indexname IN (
  'accounts_parent_idx',
  'user_accounts_user_idx',
  'user_accounts_account_idx',
  'subscriptions_account_idx',
  'subscriptions_user_idx',
  'atex_equipments_account_idx'
)
ORDER BY indexname;
