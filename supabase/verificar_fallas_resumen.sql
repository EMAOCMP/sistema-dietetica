-- ============================================
-- Dietética Vishal - RESUMEN DE FALLAS (UN SOLO RESULT SET)
--
-- Devuelve 1 fila y 1 columna con la lista de todo lo que falta.
-- Si dice "Ninguna", no hay nada pendiente.
-- Es de SOLO LECTURA.
-- ============================================

SELECT coalesce(
  string_agg(f.chk, E'\n' ORDER BY f.chk),
  'Ninguna: no hay controles en estado FALLA'
) AS "FALLAS_DETECTADAS"
FROM (
  -- Tablas que faltan
  SELECT 'TABLA FALTA: ' || x AS chk
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
  -- RPCs que faltan
  SELECT 'RPC FALTA: ' || x
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
  -- Columnas que faltan
  SELECT 'COLUMNA FALTA: ' || tbl || '.' || col
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
  -- Triggers que faltan
  SELECT 'TRIGGER FALTA: ' || x
  FROM (VALUES
    ('trg_audit_sales'),('trg_audit_products'),('trg_barcode_normalized'),
    ('trg_inventory_sync_product'),('trg_stock_sale'),
    ('trg_products_updated'),('trg_customers_updated')
  ) v(x)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = x AND NOT tgisinternal)

  UNION ALL
  -- Tablas objetivo sin RLS
  SELECT 'SIN RLS: ' || c.relname
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN ('categories','units','payment_methods','dispatch_types','iva_conditions',
      'product_batches','purchase_orders','purchase_order_items','audit_logs','product_price_history')

  UNION ALL
  -- create_sale sin idempotencia
  SELECT 'create_sale SIN idempotencia/ticket'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'create_sale'
      AND p.prosrc LIKE '%p_idempotency_key%'
      AND p.prosrc LIKE '%p_receipt_number%'
  )

  UNION ALL
  -- Tickets duplicados
  SELECT 'TICKET DUPLICADO: ' || receipt_number || ' (' || c::text || ' veces)'
  FROM (
    SELECT receipt_number, count(*) AS c FROM sales
     WHERE receipt_number IS NOT NULL
     GROUP BY receipt_number HAVING count(*) > 1
  ) d

  UNION ALL
  -- sale_items huerfanos
  SELECT 'SALE_ITEM HUERFANO: ' || si.product_id::text
  FROM sale_items si
  LEFT JOIN products p ON p.id = si.product_id
  WHERE p.id IS NULL

  UNION ALL
  -- Contador de tickets
  SELECT 'sale_counters.id=1 NO EXISTE'
  WHERE NOT EXISTS (SELECT 1 FROM sale_counters WHERE id = 1)
) f;
