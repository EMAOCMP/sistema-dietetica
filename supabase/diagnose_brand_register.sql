-- 1. ¿La venta se guardó y con qué marca?
SELECT LEFT(id::text, 8) AS ticket, card_brand AS marca,
  created_at AS fecha
FROM sales
WHERE payment_method = 'card'
ORDER BY created_at DESC
LIMIT 3;

-- 2. ¿Está en el catálogo?
SELECT code, name FROM card_brands ORDER BY name;

-- 3. ¿RLS permite insertar? (policies de card_brands)
SELECT policyname, cmd AS operacion
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'card_brands';
