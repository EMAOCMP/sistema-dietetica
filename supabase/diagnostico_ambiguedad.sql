-- DIAGNÓSTICO: ¿de dónde sale "column reference product_id is ambiguous"?
-- Solo lectura. Ejecutar en SQL Editor.

-- 1) Triggers sobre las tablas que toca la confirmación del ingreso.
SELECT c.relname AS tabla, t.tgname AS trigger, p.proname AS funcion,
       p.prosrc ~* '(^|[^[:alnum:]_.])product_id([^[:alnum:]_]|$)' AS usa_product_id_sin_calificar
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('inventory','inventory_movements','stock_receipts',
                    'stock_receipt_items','products')
ORDER BY 1, 2;

-- 2) Funciones plpgsql con variable/parámetro product_id y uso sin calificar.
--    Ese es el patrón exacto que produce el error.
SELECT p.oid::regprocedure AS firma,
       array_to_string(p.proargnames, ', ') AS parametros,
       t.line
FROM pg_proc p
CROSS JOIN LATERAL unnest(string_to_array(p.prosrc, E'\n'))
     WITH ORDINALITY AS t(line, n)
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
  AND (
    'product_id' = ANY(COALESCE(p.proargnames, '{}'))
    OR p.prosrc ~* 'product_id\s+(uuid|text|numeric|int|integer|bigint)'
  )
  AND t.line ~* '(^|[^[:alnum:]_.])product_id([^[:alnum:]_]|$)'
  AND t.line NOT LIKE '%--%'
ORDER BY 1, t.n;
