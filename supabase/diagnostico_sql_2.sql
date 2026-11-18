-- Diagnóstico 2/2 (SOLO LECTURA): código fuente de las funciones clave.
-- Ejecutar en SQL Editor y copiar la columna "codigo".
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS funcion,
       pg_get_functiondef(p.oid) AS codigo
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'create_purchase_order',
    'convert_purchase_order_to_receipt',
    'adjust_stock',
    'confirm_stock_receipt'
  )
ORDER BY 1;
