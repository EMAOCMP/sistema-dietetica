-- ============================================
-- DIAGNÓSTICO: trigger que rompe el INSERT en sales
-- ============================================

-- 1. Triggers sobre sales
SELECT trigger_name, event_manipulation AS evento,
  action_timing AS momento
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'sales'
ORDER BY trigger_name;

-- 2. Definición de las funciones de esos triggers
SELECT p.proname AS funcion,
  pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    SELECT DISTINCT substring(action_statement FROM 'EXECUTE FUNCTION ([a-z_]+)')
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'sales'
  );
