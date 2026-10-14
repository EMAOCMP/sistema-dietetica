-- ¿products tiene updated_at?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products' AND table_schema = 'public'
  AND column_name = 'updated_at';

-- ¿qué hace el trigger de products?
SELECT pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'update_updated_at';
