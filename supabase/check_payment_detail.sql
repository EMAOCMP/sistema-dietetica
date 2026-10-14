-- ============================================
-- CHECKLIST: todo lo necesario para detalle de pago
-- ============================================

-- 1. Columnas de detalle en sales (las 8 nuevas)
SELECT 'sales.' || v.c AS item,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
FROM (VALUES ('transfer_bank'), ('transfer_account'), ('transfer_ref'),
  ('card_type'), ('card_brand'), ('card_last4'),
  ('card_auth'), ('card_installments')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'sales' AND c.column_name = v.c
  AND c.table_schema = 'public'

UNION ALL

-- 2. Columnas base que usa el flujo (tienen que existir)
SELECT 'sales.' || v.c AS item,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
FROM (VALUES ('payment_method'), ('dispatch_type'), ('notes'),
  ('receipt_number'), ('net_amount'), ('iva_amount'),
  ('customer_doc'), ('customer_iva_cond'), ('status')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'sales' AND c.column_name = v.c
  AND c.table_schema = 'public'

UNION ALL

-- 3. Columnas de customers para autocompletado
SELECT 'customers.' || v.c AS item,
  CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
FROM (VALUES ('name'), ('phone'), ('doc_number')) AS v(c)
LEFT JOIN information_schema.columns AS c
  ON c.table_name = 'customers' AND c.column_name = v.c
  AND c.table_schema = 'public'

ORDER BY item;
