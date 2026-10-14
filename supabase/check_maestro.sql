-- ============================================
-- CHEQUEO MAESTRO - Dietética Vishal
-- Todo OK = la app tiene que funcionar
-- ============================================

-- 1. Columnas updated_at (las que rompen la venta)
SELECT 'products.updated_at' AS item,
  CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'FALTA - correr ALTER' END AS estado
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'updated_at' AND table_schema = 'public'
UNION ALL
SELECT 'customers.updated_at',
  CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'FALTA - correr ALTER' END
FROM information_schema.columns
WHERE table_name = 'customers' AND column_name = 'updated_at' AND table_schema = 'public'

UNION ALL

-- 2. Columnas de detalle de pago en sales
SELECT 'sales.' || v.c,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END
FROM (VALUES ('transfer_bank'), ('transfer_account'), ('transfer_ref'),
  ('card_type'), ('card_brand'), ('card_last4'),
  ('card_auth'), ('card_installments')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'sales' AND c.column_name = v.c
  AND c.table_schema = 'public'

UNION ALL

-- 3. Columnas base del flujo de venta en sales
SELECT 'sales.' || v.c,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END
FROM (VALUES ('payment_method'), ('dispatch_type'), ('notes'),
  ('receipt_number'), ('net_amount'), ('iva_amount'),
  ('customer_doc'), ('customer_iva_cond'), ('status'),
  ('customer_id'), ('user_id'), ('total_amount'), ('profit_amount')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'sales' AND c.column_name = v.c
  AND c.table_schema = 'public'

UNION ALL

-- 4. Columnas que usa el descuento de stock en products
SELECT 'products.' || v.c,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END
FROM (VALUES ('stock_quantity'), ('min_stock'), ('cost_price'),
  ('wholesale_price'), ('retail_price'), ('is_active')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'products' AND c.column_name = v.c
  AND c.table_schema = 'public'

UNION ALL

-- 5. Triggers activos que tocan el flujo de venta
SELECT 'trigger:' || trigger_name || ' ON ' || event_object_table,
  'ACTIVO' AS estado
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('sales', 'sale_items', 'products', 'stock_movements')

ORDER BY item;
