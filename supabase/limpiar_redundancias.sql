-- ============================================
-- Limpieza de redundancias (detectadas por auditar_estructura.sql)
-- No cambia permisos ni resultados. Idempotente.
-- Ejecutar en SQL Editor.
-- ============================================

BEGIN;

-- 1) Índice duplicado: sales(created_at DESC) estaba dos veces
--    (idx_sales_created y idx_sales_created_at). Se conserva el segundo.
DROP INDEX IF EXISTS public.idx_sales_created;

-- 2) Policies redundantes en purchase_order_items:
--    - poi_select (cualquier autenticado) ya cubre
--      po_items_select (admin/supervisor).
--    - po_items_write (ALL, admin) ya cubre poi_delete (DELETE, admin).
DROP POLICY IF EXISTS po_items_select ON public.purchase_order_items;
DROP POLICY IF EXISTS poi_delete ON public.purchase_order_items;

COMMIT;

-- Resultado esperado: 4 policies (ALL, SELECT, INSERT y UPDATE).
-- Ningún DELETE específico: lo cubre po_items_write (ALL, admin).
SELECT cmd, policyname,
       CASE permissive WHEN 'PERMISSIVE' THEN 'permisiva' ELSE 'restrictiva' END AS tipo,
       COALESCE(qual, '-') AS condicion
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'purchase_order_items'
ORDER BY cmd, policyname;

-- Resultado esperado: una sola fila, idx_sales_created_at.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'sales'
  AND indexdef ILIKE '%(created_at desc)%'
ORDER BY indexname;
