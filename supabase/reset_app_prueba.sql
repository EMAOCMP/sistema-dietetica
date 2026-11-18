-- ============================================================
-- RESET COMPLETO para probar la app de cero
-- Borra: ventas, cobros, ingresos, compras, movimientos, stock,
--        productos, clientes, gastos, cierres y auditoría.
-- Conserva: usuarios/perfiles, configuración (ubicaciones, medios
--           de pago, categorías, unidades, IVA, despachos, tarjetas,
--           cuentas de transferencia, MP) y proveedores.
-- Deja la numeración en 1. Irreversible.
-- Ejecutar en SQL Editor. Sirve aunque falte alguna tabla.
-- ============================================================
BEGIN;

-- 1) Conteo previo
SELECT 'ANTES' AS momento,
       (SELECT count(*) FROM public.products)        AS productos,
       (SELECT count(*) FROM public.sales)           AS ventas,
       (SELECT count(*) FROM public.stock_receipts)  AS ingresos,
       (SELECT count(*) FROM public.purchase_orders) AS ordenes;

-- 2) Borrado de datos operativos.
--    TRUNCATE ... CASCADE resuelve las FKs entre estas tablas y no
--    dispara triggers de fila (evita stock fantasma en products).
--    Solo trunca las tablas que existan: si alguna no está, no falla.
DO $$
DECLARE
  v_targets text[] := ARRAY[
    'payments','sale_items','sales',
    'stock_receipt_items','stock_receipts',
    'purchase_order_items','purchase_orders',
    'inventory_movements','inventory','stock_movements',
    'product_barcodes','product_batches','product_price_history',
    'expenses','cash_closes','audit_logs','customers','products',
    'user_onboarding_progress','onboarding_progress'
  ];
  v_list text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_list
    FROM unnest(v_targets) AS t(name)
    JOIN pg_class c     ON c.relname = t.name
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind = 'r';

  IF v_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;

-- 3) Numeración desde cero: ticket 1, OC-000001, ING-000001
UPDATE public.sale_counters SET last_number = 0 WHERE id = 1;
ALTER SEQUENCE IF EXISTS public.purchase_order_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS public.stock_receipt_seq RESTART WITH 1;

-- 4) OPCIONAL: si querés probar también el alta de proveedores,
--    descomentá esta línea. Por defecto se conservan.
-- DELETE FROM public.suppliers;

-- 5) Verificación: todo debe dar 0
SELECT 'DESPUES' AS momento,
       (SELECT count(*) FROM public.products)        AS productos,
       (SELECT count(*) FROM public.sales)           AS ventas,
       (SELECT count(*) FROM public.stock_receipts)  AS ingresos,
       (SELECT count(*) FROM public.purchase_orders) AS ordenes,
       (SELECT count(*) FROM public.inventory)       AS inventario,
       (SELECT count(*) FROM public.customers)       AS clientes;

COMMIT;

-- ============================================================
-- QUEDA LISTO
--   Configuración y usuarios intactos.
--   Si además querés dejar un solo usuario admin, corré después
--   supabase/dejar_solo_admin.sql
-- ============================================================
