-- ============================================================
-- DIAGNÓSTICO PRE-PRUEBA — Dietética Vishal
-- Solo lectura (no modifica nada). Pegar en SQL Editor y ejecutar.
-- Esperá que TODAS las filas digan ✅ OK antes de hacer las pruebas.
-- Cubre: Mercado Pago (link de pago) + Ingreso de mercadería.
-- ============================================================

SELECT orden, area, chequeo, estado, detalle
FROM (
  -- ===== MERCADO PAGO (flujo link + webhook) =====
  SELECT 1 AS orden, 'MP' AS area, 'Columnas mp_* en sales (espera 7)' AS chequeo,
         CASE WHEN COUNT(*) = 7 THEN '✅ OK'
              WHEN COUNT(*) >= 4 THEN '⚠️ FALTAN ' || (7 - COUNT(*)) || ' — correr mercado_pago.sql + mercado_pago_webhook.sql'
              ELSE '❌ FALTAN: ' || COUNT(*) || '/7' END AS estado,
         COALESCE(STRING_AGG(column_name, ', ' ORDER BY column_name), 'ninguna') AS detalle
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales'
    AND column_name IN ('mp_auth','mp_link','mp_preference_id','mp_status','mp_external_ref','mp_payment_id','mp_status_detail')

  UNION ALL
  SELECT 2, 'MP', 'Tabla sales (registrar venta)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA' END,
         'destino de cada venta'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'sales'

  UNION ALL
  SELECT 3, 'MP', 'RPC create_sale (guarda desde POS)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA' END,
         'RPC idempotente del checkout'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_sale'

  UNION ALL
  SELECT 4, 'MP', 'RPC cancel_sale (anular venta)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '⚠️ FALTA (opcional)' END,
         'para anular desde Historial'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_sale'

  -- ===== INGRESO DE MERCADERÍA =====
  UNION ALL
  SELECT 5, 'Ingreso', 'confirm_stock_receipt con ubicación',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK'
              ELSE '❌ SIN p_location_id — correr confirm_stock_receipt_ubicacion.sql' END,
         'RPC con 3er parámetro p_location_id'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_stock_receipt'
    AND 'p_location_id' = ANY(p.proargnames)

  UNION ALL
  SELECT 6, 'Ingreso', 'Tabla stock_receipts (cabecera)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA' END,
         'cabecera del ingreso'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_receipts'

  UNION ALL
  SELECT 7, 'Ingreso', 'Tabla stock_receipt_items (ítems)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA' END,
         'ítems del ingreso (borrado previo idempotente)'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'stock_receipt_items'

  UNION ALL
  SELECT 8, 'Ingreso', 'locations + "Local principal"',
         CASE WHEN to_regclass('public.locations') IS NULL THEN '❌ FALTA tabla locations'
              WHEN (SELECT COUNT(*) FROM locations WHERE name = 'Local principal') = 0
                   THEN '⚠️ SIN ubicación "Local principal"'
              ELSE '✅ OK' END,
         CASE WHEN to_regclass('public.locations') IS NULL THEN 'sin datos'
              ELSE (SELECT COUNT(*)::text || ' ubicación(es)' FROM locations) END

  UNION ALL
  SELECT 9, 'Ingreso', 'Tabla suppliers (autocomplete proveedor)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '⚠️ FALTA (autocomplete no aparecerá)' END,
         'autocompletado de proveedores en el ingreso'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'suppliers'

  -- ===== BASE / TICKETS =====
  UNION ALL
  SELECT 10, 'Base', 'sale_counters (n° de comprobante)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '⚠️ FALTA (tickets sin correlativo)' END,
         'correlativo de comprobantes POS'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'sale_counters'

  UNION ALL
  SELECT 11, 'Base', 'next_stock_receipt_number (N° ingreso)',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA' END,
         'genera el N° de ingreso de mercadería'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'next_stock_receipt_number'

  UNION ALL
  SELECT 12, 'Base', 'Tablas maestras (products/locations/inventory)',
         CASE WHEN (SELECT COUNT(*) FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name IN ('products','locations','inventory')) = 3
              THEN '✅ OK' ELSE '❌ FALTAN' END,
         'products, locations, inventory'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'products'

  -- ===== MERCADO PAGO (venta dirigida por pago) =====
  UNION ALL
  SELECT 13, 'MP', 'RPC create_mp_pending_sale',
         CASE WHEN COUNT(*) > 0 THEN '✅ OK' ELSE '❌ FALTA — correr mp_pending_sale_flow.sql' END,
         'crea la venta pendiente al generar el link'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_mp_pending_sale'

  UNION ALL
  SELECT 14, 'MP', 'RPC finalize_mp_sale / cancel_mp_sale',
         CASE WHEN COUNT(DISTINCT p.proname) = 2 THEN '✅ OK'
              ELSE '❌ FALTAN — correr mp_pending_sale_flow.sql' END,
         'finaliza (descuenta stock) o cancela la venta según el pago'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('finalize_mp_sale','cancel_mp_sale')

  UNION ALL
  SELECT 15, 'MP', 'Realtime en sales',
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = 'sales'
              ) THEN '✅ OK'
              ELSE '⚠️ NO — correr realtime_sales.sql (el POS usará polling)' END,
         'aviso instantáneo del pago en el POS'
) AS checks
ORDER BY orden;
