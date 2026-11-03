-- ============================================
-- Dietética Vishal - POST-FIX DE SEGURIDAD Y CORRECTITUD
-- Ejecutar en Supabase SQL Editor (después de schema_improvements.sql,
-- mvp_stock_model.sql, ventas_ingresos_model.sql y roles_permisos.sql).
--
-- Qué corrige:
--   1. cash_closes.mp_total: columna para el importe cobrado con Mercado Pago
--      (antes esas ventas no sumaban en ningún medio de pago del cierre).
--   2. RLS en las tablas maestras que quedaban SIN Row Level Security
--      (categories, units, payment_methods, dispatch_types, iva_conditions,
--       product_batches, purchase_orders, purchase_order_items, audit_logs).
--   3. Triggers de auditoría: existían comentados, por lo que audit_logs
--      nunca se escribía.
--   4. product_price_history: la usa el frontend (ProductsView) pero nunca
--      se creó en el repositorio.
-- ============================================

BEGIN;

-- ------------------------------------------------------------
-- 1) cash_closes: columna para Mercado Pago
-- ------------------------------------------------------------
ALTER TABLE cash_closes ADD COLUMN IF NOT EXISTS mp_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2) RLS en las tablas que quedaban abiertas
-- ------------------------------------------------------------

-- Tablas maestras de solo lectura para cualquier autenticado.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categories_select" ON categories;
CREATE POLICY "categories_select" ON categories FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "categories_write" ON categories;
CREATE POLICY "categories_write" ON categories FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "units_select" ON units;
CREATE POLICY "units_select" ON units FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "units_write" ON units;
CREATE POLICY "units_write" ON units FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_methods_select" ON payment_methods;
CREATE POLICY "payment_methods_select" ON payment_methods FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "payment_methods_write" ON payment_methods;
CREATE POLICY "payment_methods_write" ON payment_methods FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

ALTER TABLE dispatch_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dispatch_types_select" ON dispatch_types;
CREATE POLICY "dispatch_types_select" ON dispatch_types FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "dispatch_types_write" ON dispatch_types;
CREATE POLICY "dispatch_types_write" ON dispatch_types FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

ALTER TABLE iva_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iva_conditions_select" ON iva_conditions;
CREATE POLICY "iva_conditions_select" ON iva_conditions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "iva_conditions_write" ON iva_conditions;
CREATE POLICY "iva_conditions_write" ON iva_conditions FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

-- Lotes: lectura para todos, escritura admin/supervisor.
ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "batches_select" ON product_batches;
CREATE POLICY "batches_select" ON product_batches FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "batches_insert" ON product_batches;
CREATE POLICY "batches_insert" ON product_batches FOR INSERT WITH CHECK (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "batches_update" ON product_batches;
CREATE POLICY "batches_update" ON product_batches FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "batches_delete" ON product_batches;
CREATE POLICY "batches_delete" ON product_batches FOR DELETE USING (user_role() = 'admin');

-- Órdenes de compra: lectura admin/supervisor, escritura admin.
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_select" ON purchase_orders;
CREATE POLICY "po_select" ON purchase_orders FOR SELECT USING (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "po_insert" ON purchase_orders;
CREATE POLICY "po_insert" ON purchase_orders FOR INSERT WITH CHECK (user_role() = 'admin');
DROP POLICY IF EXISTS "po_update" ON purchase_orders;
CREATE POLICY "po_update" ON purchase_orders FOR UPDATE USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');
DROP POLICY IF EXISTS "po_delete" ON purchase_orders;
CREATE POLICY "po_delete" ON purchase_orders FOR DELETE USING (user_role() = 'admin');

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_items_select" ON purchase_order_items;
CREATE POLICY "po_items_select" ON purchase_order_items FOR SELECT USING (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "po_items_write" ON purchase_order_items;
CREATE POLICY "po_items_write" ON purchase_order_items FOR ALL USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

-- Bitácora de auditoría: solo lectura admin, escritura por trigger.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (user_role() = 'admin');
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT WITH CHECK (true);

-- ------------------------------------------------------------
-- 3) Triggers de auditoría (estaban comentados en schema_improvements.sql)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_sales ON sales;
CREATE TRIGGER trg_audit_sales
  AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_products ON products;
CREATE TRIGGER trg_audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- trg_customers_updated: faltaba (el updated_at de clientes no se actualizaba solo).
-- Requiere la función update_updated_at() de schema_improvements.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname = 'update_updated_at')
     AND to_regclass('public.customers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
    CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) product_price_history (la usa ProductsView, no existía)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cost_price NUMERIC(12,2),
  wholesale_price NUMERIC(12,2),
  retail_price NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(product_id, created_at DESC);

ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_history_select" ON product_price_history;
CREATE POLICY "price_history_select" ON product_price_history FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "price_history_insert" ON product_price_history;
CREATE POLICY "price_history_insert" ON product_price_history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "price_history_update" ON product_price_history;
CREATE POLICY "price_history_update" ON product_price_history FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "price_history_delete" ON product_price_history;
CREATE POLICY "price_history_delete" ON product_price_history FOR DELETE USING (user_role() = 'admin');

COMMIT;

-- ---------- Verificación ----------
-- Tablas sin RLS (debería dar 0 filas):
--   SELECT c.relname FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND NOT c.relrowsecurity
--     AND c.relname IN ('categories','units','payment_methods','dispatch_types',
--                        'iva_conditions','product_batches','purchase_orders',
--                        'purchase_order_items','audit_logs','product_price_history');
--
-- Policies creadas en este script:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('categories','units','payment_methods','dispatch_types',
--                        'iva_conditions','product_batches','purchase_orders',
--                        'purchase_order_items','audit_logs','product_price_history')
--   ORDER BY tablename, policyname;
