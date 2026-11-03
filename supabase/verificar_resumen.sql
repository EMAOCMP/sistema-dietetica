-- ============================================
-- Dietética Vishal - RESUMEN COMPLETO (FALLAS + AVISOS)
--
-- Devuelve 1 fila y 2 columnas:
--   FALLAS_DETECTADAS -> lista de lo que falta (vacío = todo OK)
--   AVISOS_DETECTADOS -> lista de lo que conviene revisar
-- Es de SOLO LECTURA.
-- ============================================

WITH checks AS (
  -- =========================================================
  -- FALLAS
  -- =========================================================
  SELECT 'FALLA'::text AS estado, 'TABLA FALTA: ' || x AS chk
  FROM (VALUES
    ('products'),('sales'),('sale_items'),('profiles'),('customers'),('suppliers'),
    ('locations'),('inventory'),('inventory_movements'),('stock_movements'),
    ('product_barcodes'),('product_batches'),('product_price_history'),
    ('stock_receipts'),('stock_receipt_items'),('payments'),('sale_counters'),
    ('cash_closes'),('expenses'),('user_settings'),('user_onboarding_progress'),
    ('categories'),('units'),('payment_methods'),('dispatch_types'),('iva_conditions'),
    ('purchase_orders'),('purchase_order_items'),('audit_logs')
  ) v(x)
  WHERE to_regclass('public.' || x) IS NULL

  UNION ALL
  SELECT 'FALLA', 'RPC FALTA: ' || x
  FROM (VALUES
    ('user_role'),('create_sale'),('cancel_sale'),('adjust_stock'),('add_stock'),
    ('confirm_stock_receipt'),('transfer_stock'),('next_stock_receipt_number'),
    ('create_mp_pending_sale'),('finalize_mp_sale'),('cancel_mp_sale'),
    ('merge_onboarding_progress'),('normalize_barcode'),('audit_trigger')
  ) v(x)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = x
  )

  UNION ALL
  SELECT 'FALLA', 'COLUMNA FALTA: ' || tbl || '.' || col
  FROM (VALUES
    ('cash_closes','mp_total'),('cash_closes','cash_expected'),('cash_closes','card_total'),
    ('sales','receipt_number'),('sales','idempotency_key'),('sales','discount_amount'),
    ('sales','net_amount'),('sales','iva_amount'),('sales','status'),('sales','payment_method'),
    ('sales','dispatch_type'),('sales','customer_iva_cond'),
    ('sales','transfer_bank'),('sales','transfer_account'),('sales','transfer_ref'),
    ('sales','card_type'),('sales','card_brand'),('sales','card_last4'),('sales','card_auth'),
    ('sales','card_installments'),
    ('sales','mp_auth'),('sales','mp_link'),('sales','mp_preference_id'),('sales','mp_status'),
    ('sales','mp_external_ref'),('sales','mp_payment_id'),('sales','mp_status_detail'),
    ('sale_items','discount_amount'),('sale_items','cost_price_at_sale'),
    ('product_barcodes','barcode_normalized'),('product_barcodes','active'),
    ('inventory','quantity'),('inventory_movements','type'),('expenses','spent_on')
  ) v(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name::text = tbl
      AND column_name::text = col
  )

  UNION ALL
  SELECT 'FALLA', 'TRIGGER FALTA: ' || x
  FROM (VALUES
    ('trg_audit_sales'),('trg_audit_products'),('trg_barcode_normalized'),
    ('trg_inventory_sync_product'),('trg_stock_sale'),
    ('trg_products_updated'),('trg_customers_updated')
  ) v(x)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = x AND NOT tgisinternal)

  UNION ALL
  SELECT 'FALLA', 'SIN RLS: ' || c.relname
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN ('categories','units','payment_methods','dispatch_types','iva_conditions',
      'product_batches','purchase_orders','purchase_order_items','audit_logs','product_price_history')

  UNION ALL
  SELECT 'FALLA', 'create_sale SIN idempotencia/ticket'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'create_sale'
      AND p.prosrc LIKE '%p_idempotency_key%'
      AND p.prosrc LIKE '%p_receipt_number%'
  )

  UNION ALL
  SELECT 'FALLA', 'TICKET DUPLICADO: ' || receipt_number || ' (' || c::text || ' veces)'
  FROM (
    SELECT receipt_number, count(*) AS c FROM sales
     WHERE receipt_number IS NOT NULL
     GROUP BY receipt_number HAVING count(*) > 1
  ) d

  UNION ALL
  SELECT 'FALLA', 'SALE_ITEM HUERFANO: ' || si.product_id::text
  FROM sale_items si
  LEFT JOIN products p ON p.id = si.product_id
  WHERE p.id IS NULL

  UNION ALL
  SELECT 'FALLA', 'sale_counters.id=1 NO EXISTE'
  WHERE NOT EXISTS (SELECT 1 FROM sale_counters WHERE id = 1)

  -- =========================================================
  -- AVISOS
  -- =========================================================
  UNION ALL
  SELECT 'AVISO', 'Tablas sin RLS: ' || coalesce(string_agg(c.relname, ', '), '-')
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Policies activas: ' || count(*)::text || ' (se esperaban 53+)'
  FROM pg_policies WHERE schemaname::text = 'public'
  HAVING count(*) < 50

  UNION ALL
  SELECT 'AVISO', 'La tabla sales NO esta en la publicacion realtime (el polling de 3s lo compensa)'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sales'
  )

  UNION ALL
  SELECT 'AVISO', 'Extension vault no habilitada (necesaria para el backup automatico)'
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('supabase_vault', 'vault'))

  UNION ALL
  SELECT 'AVISO', 'cancel_sale NO valida el rol: cualquiera podria anular ventas'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'cancel_sale'
      AND p.prosrc LIKE '%admin%' AND p.prosrc LIKE '%supervisor%'
  )

  UNION ALL
  SELECT 'AVISO', 'Ventas sin ticket correlativo: ' || count(*)::text || ' (las offline anteriores al fix)'
  FROM sales WHERE receipt_number IS NULL
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Ventas Mercado Pago atascadas: ' || count(*)::text || ' (revisar MP_WEBHOOK_SECRET)'
  FROM sales WHERE status IN ('pending_payment', 'pending')
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Descuadre stock products vs inventory: ' || count(*)::text || ' productos'
  FROM products p
  LEFT JOIN (SELECT product_id, sum(quantity) q FROM inventory GROUP BY product_id) i
    ON i.product_id = p.id
  WHERE abs(coalesce(p.stock_quantity, 0) - coalesce(i.q, 0)) > 0.01
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Productos con stock nulo o negativo: ' || count(*)::text
  FROM products WHERE stock_quantity IS NULL OR stock_quantity < 0
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Falta la ubicacion "Local principal" (destino por defecto del ingreso de stock)'
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Local principal')

  UNION ALL
  SELECT 'AVISO', 'audit_logs vacio: el trigger recien se activo (hace una venta y volve a verificar)'
  WHERE NOT EXISTS (SELECT 1 FROM audit_logs)

  UNION ALL
  SELECT 'AVISO', 'Usuarios de auth sin fila en profiles: ' || count(*)::text || ' (se loguean como vendedor)'
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
  HAVING count(*) > 0

  UNION ALL
  SELECT 'AVISO', 'Sin marcas de tarjeta cargadas (se pueden elegir a mano en el POS)'
  WHERE NOT EXISTS (SELECT 1 FROM card_brands WHERE is_active)

  UNION ALL
  SELECT 'AVISO', 'Las 10 tablas objetivo tienen RLS pero hay otras publicas sin RLS (revisar roles_permisos.sql)'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
      AND c.relname IN ('categories','units','payment_methods','dispatch_types','iva_conditions',
        'product_batches','purchase_orders','purchase_order_items','audit_logs','product_price_history')
  )
    AND EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    )
)
SELECT
  coalesce(
    (SELECT string_agg(c.chk, E'\n' ORDER BY c.chk) FROM checks c WHERE c.estado = 'FALLA'),
    'Ninguna: no hay controles en estado FALLA'
  ) AS "FALLAS_DETECTADAS",
  coalesce(
    (SELECT string_agg(c.chk, E'\n' ORDER BY c.chk) FROM checks c WHERE c.estado = 'AVISO'),
    'Ninguno: todo en verde'
  ) AS "AVISOS_DETECTADOS";
