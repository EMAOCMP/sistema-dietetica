-- ============================================
-- Dietética Vishal - VERIFICACIÓN DE CORRECTIVOS
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es de SOLO LECTURA: no modifica ningún dato.
--
-- Salida: 3 result sets
--   1) Detalle control por control (con semáforo)
--   2) Resumen por estado
--   3) Semáforo final
--
--   🟢 OK     → correcto
--   🟡 AVISO  → funciona, conviene revisarlo
--   🔴 FALLA  → falta aplicar algo
--   ⚪ INFO   → dato informativo
-- ============================================

DROP TABLE IF EXISTS _verif;
CREATE TEMP TABLE _verif (
  orden   int,
  seccion text,
  chequeo text,
  estado  text,
  detalle text
);

DO $verif$
DECLARE
  r   record;
  cnt int;
  msg text;
BEGIN

-- ==========================================================
-- 1) ESQUEMA - tablas del modelo
-- ==========================================================
  FOR r IN SELECT * FROM (VALUES
    ('products'),('sales'),('sale_items'),('profiles'),('customers'),('suppliers'),
    ('locations'),('inventory'),('inventory_movements'),('stock_movements'),
    ('product_barcodes'),('product_batches'),('product_price_history'),
    ('stock_receipts'),('stock_receipt_items'),('payments'),('sale_counters'),
    ('cash_closes'),('expenses'),('user_settings'),('user_onboarding_progress'),
    ('categories'),('units'),('payment_methods'),('dispatch_types'),('iva_conditions'),
    ('purchase_orders'),('purchase_order_items'),('audit_logs')
  ) v(tbl) LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      INSERT INTO _verif VALUES (100, 'ESQUEMA', 'Tabla ' || r.tbl, 'OK', 'presente');
    ELSE
      INSERT INTO _verif VALUES (100, 'ESQUEMA', 'Tabla ' || r.tbl, 'FALLA', 'falta crearla');
    END IF;
  END LOOP;

-- ==========================================================
-- 2) ESQUEMA - funciones (RPC)
-- ==========================================================
  FOR r IN SELECT * FROM (VALUES
    ('user_role'),('create_sale'),('cancel_sale'),('adjust_stock'),('add_stock'),
    ('confirm_stock_receipt'),('transfer_stock'),('next_stock_receipt_number'),
    ('create_mp_pending_sale'),('finalize_mp_sale'),('cancel_mp_sale'),
    ('merge_onboarding_progress'),('normalize_barcode'),('audit_trigger')
  ) v(fn) LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = r.fn
    ) THEN
      INSERT INTO _verif VALUES (200, 'ESQUEMA', 'RPC ' || r.fn, 'OK', 'instalada');
    ELSE
      INSERT INTO _verif VALUES (200, 'ESQUEMA', 'RPC ' || r.fn, 'FALLA', 'falta ejecutar el SQL que la crea');
    END IF;
  END LOOP;

-- create_sale debe aceptar idempotencia + ticket
-- Se busca en el cuerpo de la función (pg_proc.prosrc) para no depender
-- de pg_get_function_definition(), que no existe en el Postgres de Supabase.
  SELECT count(*) INTO cnt FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'create_sale'
     AND p.prosrc LIKE '%p_idempotency_key%'
     AND p.prosrc LIKE '%p_receipt_number%';
  INSERT INTO _verif VALUES (201, 'ESQUEMA', 'create_sale con idempotencia + ticket',
    CASE WHEN cnt > 0 THEN 'OK' ELSE 'FALLA' END,
    CASE WHEN cnt > 0 THEN 'acepta p_idempotency_key y p_receipt_number'
         ELSE 'falta la version v3 (escaner_v3_transaccional.sql)' END);

-- cancel_sale debe validar el rol
-- OJO: se usa pg_proc.prosrc (columna del catalogo) y NO pg_get_function_definition(),
-- que no esta disponible en el Postgres de Supabase.
  SELECT count(*) INTO cnt FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'cancel_sale'
     AND p.prosrc LIKE '%admin%'
     AND p.prosrc LIKE '%supervisor%';
  INSERT INTO _verif VALUES (202, 'SEGURIDAD', 'cancel_sale valida rol admin/supervisor',
    CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
    CASE WHEN cnt > 0 THEN 'rechaza a los vendedores'
         ELSE 'no valida el rol: cualquiera podria anular ventas' END);

-- ==========================================================
-- 3) ESQUEMA - columnas clave
-- ==========================================================
  FOR r IN SELECT * FROM (VALUES
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
  ) v(tbl, col) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name::text = r.tbl
         AND column_name::text = r.col
    ) THEN
      INSERT INTO _verif VALUES (300, 'ESQUEMA', r.tbl || '.' || r.col, 'OK', 'existe');
    ELSE
      INSERT INTO _verif VALUES (300, 'ESQUEMA', r.tbl || '.' || r.col, 'FALLA', 'falta la columna');
    END IF;
  END LOOP;

-- ==========================================================
-- 4) ESQUEMA - triggers
-- ==========================================================
  FOR r IN SELECT * FROM (VALUES
    ('trg_audit_sales'),('trg_audit_products'),('trg_barcode_normalized'),
    ('trg_inventory_sync_product'),('trg_stock_sale'),
    ('trg_products_updated'),('trg_customers_updated')
  ) v(tg) LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = r.tg AND NOT tgisinternal) THEN
      INSERT INTO _verif VALUES (400, 'ESQUEMA', 'Trigger ' || r.tg, 'OK', 'activo');
    ELSE
      INSERT INTO _verif VALUES (400, 'ESQUEMA', 'Trigger ' || r.tg, 'FALLA', 'no esta activo');
    END IF;
  END LOOP;

-- ==========================================================
-- 5) SEGURIDAD - RLS
-- ==========================================================
  SELECT count(*), coalesce(string_agg(c.relname, ', '), '') INTO cnt, msg
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
     AND c.relname IN ('categories','units','payment_methods','dispatch_types','iva_conditions',
       'product_batches','purchase_orders','purchase_order_items','audit_logs','product_price_history');
  INSERT INTO _verif VALUES (500, 'SEGURIDAD', 'Tablas objetivo con RLS habilitado',
    CASE WHEN cnt = 0 THEN 'OK' ELSE 'FALLA' END,
    CASE WHEN cnt = 0 THEN 'las 10 tablas estan protegidas'
         ELSE cnt::text || ' sin RLS: ' || msg END);

  SELECT count(*), coalesce(string_agg(c.relname, ', '), '') INTO cnt, msg
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  INSERT INTO _verif VALUES (501, 'SEGURIDAD', 'Revision general de RLS (todas las tablas publicas)',
    CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
    CASE WHEN cnt = 0 THEN 'todas las tablas publicas tienen RLS'
         ELSE cnt::text || ' sin RLS: ' || msg END);

  SELECT count(*) INTO cnt FROM pg_policies WHERE schemaname::text = 'public';
  INSERT INTO _verif VALUES (502, 'SEGURIDAD', 'Policies activas en el schema public',
    CASE WHEN cnt >= 50 THEN 'OK' ELSE 'AVISO' END,
    cnt::text || ' policies (se esperaban 53+)');

  SELECT count(*) INTO cnt FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'user_role';
  INSERT INTO _verif VALUES (503, 'SEGURIDAD', 'Funcion user_role() disponible',
    CASE WHEN cnt > 0 THEN 'OK' ELSE 'FALLA' END,
    CASE WHEN cnt > 0 THEN 'las policies pueden consultar el rol'
         ELSE 'falta roles_permisos.sql' END);

  SELECT count(*) INTO cnt FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sales';
  INSERT INTO _verif VALUES (504, 'SEGURIDAD', 'Tabla sales en la publicacion realtime',
    CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
    CASE WHEN cnt > 0 THEN 'el POS recibe ventas en vivo'
         ELSE 'falta realtime_sales.sql (el polling de 3s lo compensa)' END);

  SELECT count(*) INTO cnt FROM pg_extension WHERE extname IN ('supabase_vault', 'vault');
  INSERT INTO _verif VALUES (505, 'SEGURIDAD', 'Extension vault habilitada (backup automatico)',
    CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
    CASE WHEN cnt > 0 THEN 'se puede guardar el BACKUP_TOKEN en Vault'
         ELSE 'habilitala en Dashboard > Database > Extensions' END);

-- ==========================================================
-- 6) DATOS - integridad (cada bloque es independiente:
--    si falta una tabla, no corta el resto)
-- ==========================================================
  BEGIN
    SELECT count(*) INTO cnt FROM (
      SELECT receipt_number FROM sales
       WHERE receipt_number IS NOT NULL
       GROUP BY receipt_number HAVING count(*) > 1
    ) d;
    INSERT INTO _verif VALUES (600, 'DATOS', 'Tickets correlativos duplicados',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'FALLA' END,
      CASE WHEN cnt = 0 THEN 'ninguno' ELSE cnt::text || ' numeros repetidos' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (600, 'DATOS', 'Tickets correlativos duplicados', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM sales WHERE receipt_number IS NULL;
    INSERT INTO _verif VALUES (601, 'DATOS', 'Ventas sin ticket correlativo',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt = 0 THEN 'todas tienen ticket'
           ELSE cnt::text || ' sin ticket (las offline anteriores al fix)' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (601, 'DATOS', 'Ventas sin ticket correlativo', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM sales WHERE status IN ('pending_payment', 'pending');
    INSERT INTO _verif VALUES (602, 'DATOS', 'Ventas Mercado Pago atascadas',
      CASE WHEN cnt = 0 THEN 'OK' WHEN cnt < 5 THEN 'AVISO' ELSE 'FALLA' END,
      CASE WHEN cnt = 0 THEN 'ninguna'
           ELSE cnt::text || ' ventas esperando el webhook (revisar MP_WEBHOOK_SECRET)' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (602, 'DATOS', 'Ventas Mercado Pago atascadas', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt
      FROM sale_items si
      LEFT JOIN products p ON p.id = si.product_id
     WHERE p.id IS NULL;
    INSERT INTO _verif VALUES (603, 'DATOS', 'sale_items huerfanos (producto inexistente)',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'FALLA' END,
      CASE WHEN cnt = 0 THEN 'ninguno' ELSE cnt::text || ' items con producto borrado' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (603, 'DATOS', 'sale_items huerfanos (producto inexistente)', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM sales WHERE total_amount IS NULL OR total_amount <= 0;
    INSERT INTO _verif VALUES (604, 'DATOS', 'Ventas con total <= 0',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt = 0 THEN 'ninguna' ELSE cnt::text || ' ventas con total 0 o nulo' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (604, 'DATOS', 'Ventas con total <= 0', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt
      FROM products p
      LEFT JOIN (
        SELECT product_id, sum(quantity) AS q FROM inventory GROUP BY product_id
      ) i ON i.product_id = p.id
     WHERE abs(coalesce(p.stock_quantity, 0) - coalesce(i.q, 0)) > 0.01;
    INSERT INTO _verif VALUES (605, 'DATOS', 'Descuadre stock: products vs inventory',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt = 0 THEN 'coinciden'
           ELSE cnt::text || ' productos con stock distinto (ajustar con un conteo fisico)' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (605, 'DATOS', 'Descuadre stock: products vs inventory', 'AVISO', 'falta la tabla inventory (mvp_stock_model.sql)');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM products WHERE stock_quantity IS NULL OR stock_quantity < 0;
    INSERT INTO _verif VALUES (606, 'DATOS', 'Productos con stock nulo o negativo',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt = 0 THEN 'ninguno' ELSE cnt::text || ' productos' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (606, 'DATOS', 'Productos con stock nulo o negativo', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM sale_counters WHERE id = 1;
    INSERT INTO _verif VALUES (607, 'DATOS', 'Contador de tickets inicializado',
      CASE WHEN cnt > 0 THEN 'OK' ELSE 'FALLA' END,
      CASE WHEN cnt > 0 THEN 'sale_counters.id=1 existe'
           ELSE 'falta: la app no podria asignar tickets' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (607, 'DATOS', 'Contador de tickets inicializado', 'FALLA', 'falta la tabla sale_counters');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM locations WHERE name = 'Local principal';
    INSERT INTO _verif VALUES (608, 'DATOS', 'Ubicacion por defecto "Local principal"',
      CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt > 0 THEN 'existe'
           ELSE 'sin ella, el ingreso de stock no tiene destino' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (608, 'DATOS', 'Ubicacion por defecto "Local principal"', 'AVISO', 'falta la tabla locations');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM audit_logs;
    INSERT INTO _verif VALUES (609, 'AUDITORIA', 'Filas registradas en audit_logs',
      CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt > 0 THEN cnt::text || ' movimientos auditados (el trigger funciona)'
           ELSE '0: el trigger recien se activo; hace una venta o edita un producto para comprobarlo' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (609, 'AUDITORIA', 'Filas registradas en audit_logs', 'AVISO', 'falta la tabla audit_logs');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM profiles;
    SELECT coalesce(string_agg(t.role || ': ' || t.c::text, ' | '), '') INTO msg
      FROM (SELECT role, count(*) AS c FROM profiles GROUP BY role) t;
    INSERT INTO _verif VALUES (610, 'DATOS', 'Usuarios y roles asignados',
      CASE WHEN cnt > 0 THEN 'INFO' ELSE 'AVISO' END,
      CASE WHEN cnt > 0 THEN cnt::text || ' perfiles - ' || msg
           ELSE 'no hay perfiles: el primer usuario se crea como vendedor' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (610, 'DATOS', 'Usuarios y roles asignados', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);
    INSERT INTO _verif VALUES (611, 'DATOS', 'Usuarios de auth sin fila en profiles',
      CASE WHEN cnt = 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt = 0 THEN 'todos tienen perfil'
           ELSE cnt::text || ' usuarios sin perfil (se loguean como vendedor)' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (611, 'DATOS', 'Usuarios de auth sin fila en profiles', 'AVISO', 'no se pudo verificar');
  END;

  BEGIN
    SELECT count(*) INTO cnt FROM card_brands WHERE is_active;
    INSERT INTO _verif VALUES (612, 'DATOS', 'Marcas de tarjeta cargadas',
      CASE WHEN cnt > 0 THEN 'OK' ELSE 'AVISO' END,
      CASE WHEN cnt > 0 THEN cnt::text || ' marcas activas'
           ELSE 'sin marcas: se pueden elegir a mano en el POS' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _verif VALUES (612, 'DATOS', 'Marcas de tarjeta cargadas', 'AVISO', 'falta la tabla card_brands');
  END;

END $verif$;

-- ==========================================================
-- SALIDA
-- ==========================================================

-- 1) Detalle
SELECT
  CASE estado
    WHEN 'OK'    THEN '🟢 OK'
    WHEN 'AVISO' THEN '🟡 AVISO'
    WHEN 'FALLA' THEN '🔴 FALLA'
    ELSE              '⚪ INFO'
  END AS estado,
  seccion,
  chequeo,
  detalle
FROM _verif
ORDER BY orden, seccion, chequeo;

-- 2) Resumen
SELECT
  CASE estado
    WHEN 'OK'    THEN '🟢 OK'
    WHEN 'AVISO' THEN '🟡 AVISO'
    WHEN 'FALLA' THEN '🔴 FALLA'
    ELSE              '⚪ INFO'
  END AS estado,
  count(*) AS cantidad
FROM _verif
GROUP BY estado
ORDER BY CASE estado WHEN 'FALLA' THEN 1 WHEN 'AVISO' THEN 2 WHEN 'OK' THEN 3 ELSE 4 END;

-- 3) Semáforo final
SELECT
  CASE
    WHEN (SELECT count(*) FROM _verif WHERE estado = 'FALLA') > 0
      THEN '🔴 HAY FALLAS: ' || (SELECT count(*) FROM _verif WHERE estado = 'FALLA')::text || ' control(es) pendientes'
    WHEN (SELECT count(*) FROM _verif WHERE estado = 'AVISO') > 0
      THEN '🟡 TODO FUNCIONA, con ' || (SELECT count(*) FROM _verif WHERE estado = 'AVISO')::text || ' aviso(s) a revisar'
    ELSE '🟢 TODO OK'
  END AS resultado,
  (SELECT count(*) FROM _verif WHERE estado = 'OK')    AS controles_ok,
  (SELECT count(*) FROM _verif WHERE estado = 'AVISO') AS avisos,
  (SELECT count(*) FROM _verif WHERE estado = 'FALLA') AS fallas;
