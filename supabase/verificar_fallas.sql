-- ============================================
-- Dietética Vishal - DIAGNÓSTICO DE FALLAS
--
-- Ejecutar cuando verificar_correcivos.sql dé 🔴.
-- Cada bloque devuelve UNA fila SOLO si ese control falla.
-- Si un bloque no devuelve nada, ese control está OK.
--
-- Es de SOLO LECTURA.
-- ============================================

-- 1) Tablas faltantes (esperado: 0 filas)
SELECT 'FALLA · tabla' AS estado, 'Tabla ' || x AS chequeo
FROM (VALUES
  ('products'),('sales'),('sale_items'),('profiles'),('customers'),('suppliers'),
  ('locations'),('inventory'),('inventory_movements'),('stock_movements'),
  ('product_barcodes'),('product_batches'),('product_price_history'),
  ('stock_receipts'),('stock_receipt_items'),('payments'),('sale_counters'),
  ('cash_closes'),('expenses'),('user_settings'),('user_onboarding_progress'),
  ('categories'),('units'),('payment_methods'),('dispatch_types'),('iva_conditions'),
  ('purchase_orders'),('purchase_order_items'),('audit_logs')
) v(x)
WHERE to_regclass('public.' || x) IS NULL;

-- 2) RPCs faltantes (esperado: 0 filas)
SELECT 'FALLA · rpc' AS estado, 'RPC ' || x AS chequeo
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
);

-- 3) Columnas faltantes (esperado: 0 filas)
SELECT 'FALLA · columna' AS estado, tbl || '.' || col AS chequeo
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
);

-- 4) Triggers faltantes (esperado: 0 filas)
SELECT 'FALLA · trigger' AS estado, 'Trigger ' || x AS chequeo
FROM (VALUES
  ('trg_audit_sales'),('trg_audit_products'),('trg_barcode_normalized'),
  ('trg_inventory_sync_product'),('trg_stock_sale'),
  ('trg_products_updated'),('trg_customers_updated')
) v(x)
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = x AND NOT tgisinternal);

-- 5) Tablas objetivo sin RLS (esperado: 0 filas)
SELECT 'FALLA · RLS' AS estado, 'Tabla sin RLS: ' || c.relname AS chequeo
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  AND c.relname IN ('categories','units','payment_methods','dispatch_types','iva_conditions',
    'product_batches','purchase_orders','purchase_order_items','audit_logs','product_price_history');

-- 6) create_sale sin idempotencia/ticket (esperado: 0 filas)
SELECT 'FALLA · create_sale' AS estado,
       'create_sale no acepta p_idempotency_key / p_receipt_number' AS chequeo
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'create_sale'
    AND p.prosrc LIKE '%p_idempotency_key%'
    AND p.prosrc LIKE '%p_receipt_number%'
);

-- 7) Tickets correlativos duplicados (esperado: 0 filas)
SELECT 'FALLA · datos' AS estado,
       'Ticket ' || receipt_number || ' repetido ' || c::text || ' veces' AS chequeo
FROM (
  SELECT receipt_number, count(*) AS c FROM sales
   WHERE receipt_number IS NOT NULL
   GROUP BY receipt_number HAVING count(*) > 1
) d;

-- 8) sale_items huerfanos (esperado: 0 filas)
SELECT 'FALLA · datos' AS estado,
       'sale_item sin producto: ' || si.product_id::text AS chequeo
FROM sale_items si
LEFT JOIN products p ON p.id = si.product_id
WHERE p.id IS NULL;

-- 9) Contador de tickets sin inicializar (esperado: 0 filas)
SELECT 'FALLA · datos' AS estado,
       'sale_counters.id=1 no existe' AS chequeo
WHERE NOT EXISTS (SELECT 1 FROM sale_counters WHERE id = 1);
