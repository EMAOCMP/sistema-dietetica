-- AUDITORÍA DE ESTRUCTURA (SOLO LECTURA) · Dietética Vishal
-- Si no hay problemas, solo aparece la fila "9 RESUMEN". No modifica nada.
WITH req AS (
  SELECT unnest(ARRAY[
    'create_purchase_order','update_purchase_order','send_purchase_order',
    'cancel_purchase_order','convert_purchase_order_to_receipt',
    'mark_purchase_order_received','next_stock_receipt_number',
    'confirm_stock_receipt','delete_stock_receipt','adjust_stock','add_stock',
    'transfer_stock','compute_replenishment','create_sale','cancel_sale',
    'sales_history_summary','set_sale_phone']) AS nombre
),
lineas AS (
  -- 0) Funciones del circuito que faltan
  SELECT '0 FALTA FUNCION' AS seccion, r.nombre AS objeto, 'no existe' AS detalle
  FROM req r
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nombre)

  UNION ALL
  -- 1) Mismo nombre con más de una firma (sobrecargas)
  SELECT '1 FUNCION DUPLICADA', p.proname,
         count(*) || ' versiones: ' ||
         string_agg(pg_get_function_identity_arguments(p.oid), ' | '
                    ORDER BY pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  GROUP BY p.proname HAVING count(*) > 1

  UNION ALL
  -- 2) Columna de salida usada sin calificar (bug "reference is ambiguous")
  SELECT '2 FUNCION AMBIGUA',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'columna de salida usada sin calificar: ' || string_agg(DISTINCT m.nm, ', ')
  FROM pg_proc p
  CROSS JOIN LATERAL (SELECT unnest(p.proargnames) AS nm, unnest(p.proargmodes) AS md) m
  WHERE p.pronamespace = 'public'::regnamespace
    AND m.md IN ('t', 'o', 'b') AND m.nm IS NOT NULL
    AND (p.prosrc ~* ('(where|and|set)\s+'||m.nm||'\s*=') OR p.prosrc ~* ('on\s+conflict\s*\([^)]*\y'||m.nm||'\y'))
  GROUP BY p.oid, p.proname

  UNION ALL
  -- 3) Policies idénticas (misma tabla, comando, roles y condición)
  SELECT '3 POLICY DUPLICADA', pol.tablename || ' · ' || pol.cmd,
         string_agg(pol.policyname, ', ') || ' | roles=' ||
         COALESCE(array_to_string(pol.roles, ','), '-') || ' | ' || COALESCE(pol.qual, '-')
  FROM pg_policies pol WHERE pol.schemaname = 'public'
  GROUP BY pol.tablename, pol.cmd, pol.roles, pol.qual, pol.with_check, pol.permissive
  HAVING count(*) > 1

  UNION ALL
  -- 4) Policy ALL solapada con una específica (revisar, no siempre es error)
  SELECT '4 POLICY SOLAPADA', a.tablename || ' · ALL vs ' || b.cmd,
         a.policyname || ' (ALL) + ' || b.policyname || ' (' || b.cmd || ')'
  FROM pg_policies a
  JOIN pg_policies b ON b.schemaname = a.schemaname AND b.tablename = a.tablename
                    AND b.cmd <> 'ALL' AND b.policyname <> a.policyname
  WHERE a.schemaname = 'public' AND a.cmd = 'ALL'

  UNION ALL
  -- 5) Triggers repetidos (misma tabla, función, momento y eventos)
  SELECT '5 TRIGGER DUPLICADO', t.tgrelid::regclass || ' · ' || t.tgfoid::regproc,
         string_agg(t.tgname, ', ') || ' | ' || min(pg_get_triggerdef(t.oid))
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
  GROUP BY t.tgrelid, t.tgfoid, t.tgtype HAVING count(*) > 1

  UNION ALL
  -- 6) Índices repetidos (mismas columnas, unicidad y filtro)
  SELECT '6 INDICE DUPLICADO', i.indrelid::regclass::text,
         string_agg(c.relname, ', ') || ' sobre (' ||
         min(replace(i.indkey::text, ' ', ',')) || ')'
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid IN (SELECT oid FROM pg_class
                       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r')
  GROUP BY i.indrelid, i.indkey::text,
           COALESCE(pg_get_expr(i.indpred, i.indrelid), ''), i.indisunique
  HAVING count(*) > 1

  UNION ALL
  -- 7) Constraints repetidas (misma tabla, tipo y definición)
  SELECT '7 CONSTRAINT DUPLICADA', c.conrelid::regclass::text || ' · ' || c.contype::text,
         string_agg(c.conname, ', ') || ' | ' || pg_get_constraintdef(c.oid)
  FROM pg_constraint c
  WHERE c.connamespace = 'public'::regnamespace AND c.conrelid <> 0
  GROUP BY c.conrelid, c.contype, pg_get_constraintdef(c.oid) HAVING count(*) > 1

  UNION ALL
  -- 9) Resumen: siempre devuelve una fila
  SELECT '9 RESUMEN', 'objetos',
         'funciones=' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) ||
         ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') ||
         ' · triggers=' || (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) ||
         ' · indices=' || (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'i') ||
         ' · tablas=' || (SELECT count(*) FROM pg_class
                           WHERE relnamespace = 'public'::regnamespace AND relkind = 'r')
)
SELECT seccion, objeto, detalle FROM lineas ORDER BY seccion, objeto;
