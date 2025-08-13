-- 001b_verify.sql
-- Vérifications rapides pour la partie licences

-- 1) Nouvelles tables
SELECT 'apps' AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='apps'
UNION ALL
SELECT 'app_plans' AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='app_plans'
UNION ALL
SELECT 'app_pages' AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='app_pages'
UNION ALL
SELECT 'license_assignments' AS table, COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='license_assignments';

-- 2) Colonnes ajoutées à subscriptions
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='subscriptions'
  AND column_name IN ('app_code','tier','scope','seats_total','payer_user_id','payer_account_id')
ORDER BY column_name;

-- 3) Exemples d'initialisation (à exécuter manuellement au besoin):
-- INSERT INTO public.apps (code, name) VALUES ('ATEX','ATEX Control'), ('EPD','EPD Manager') ON CONFLICT (code) DO NOTHING;
-- INSERT INTO public.app_plans (app_code, tier, name) VALUES
--   ('ATEX',1,'Niveau 1'),('ATEX',2,'Niveau 2'),('ATEX',3,'Niveau 3'),
--   ('EPD',1,'Niveau 1'),('EPD',2,'Niveau 2'),('EPD',3,'Niveau 3')
-- ON CONFLICT DO NOTHING;
-- INSERT INTO public.app_pages (page_slug, app_code, min_tier) VALUES
--   ('atex-control','ATEX',1),
--   ('epd','EPD',2)
-- ON CONFLICT DO NOTHING;
