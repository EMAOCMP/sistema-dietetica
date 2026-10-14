-- ============================================
-- Dietética Vishal - ROLES Y PERMISOS (RLS por rol) v2
-- Ejecutar en Supabase SQL Editor.
-- Roles: admin (todo) | supervisor (gestiona, no usuarios) | vendedor (todo MENOS borrar/ubicaciones/usuarios).
-- Vendedor SÍ: POS, productos (alta/edición), ingresos, clientes, proveedores.
-- Vendedor NO: DELETE nada, dar de baja/reactivar (is_active), cancelar ingresos,
--   anular ventas, ubicaciones, usuarios.
-- IMPORTANTE: borra TODAS las policies de las tablas alcanzadas y las recrea.
-- ============================================

BEGIN;

-- ============================================
-- 0. Helper: rol del usuario actual (bypass RLS por SECURITY DEFINER)
--    Sin perfil → 'vendedor' (mínimo privilegio, el POS sigue andando).
-- ============================================
CREATE OR REPLACE FUNCTION user_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'vendedor');
$$;

REVOKE ALL ON FUNCTION user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION user_role() TO service_role;

-- ============================================
-- 1. Wipe: borra todas las policies de las tablas del modelo
-- ============================================
DO $$
DECLARE
  t TEXT;
  p RECORD;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'products','product_barcodes','suppliers','customers','locations',
    'inventory','inventory_movements','stock_receipts','stock_receipt_items',
    'sales','sale_items','payments','stock_movements','card_brands','profiles'
  ]) LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ============================================
-- 2. PRODUCTS — ver todos; alta/edición todos; baja/reactivar admin+supervisor;
--    borrar admin. (Vendedor: solo active→active, no toca is_active.)
-- ============================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select" ON products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (user_role() IN ('admin','supervisor','vendedor'));
CREATE POLICY "products_update_admin" ON products FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "products_update_vendedor" ON products FOR UPDATE USING (user_role() = 'vendedor' AND is_active = true) WITH CHECK (user_role() = 'vendedor' AND is_active = true);
CREATE POLICY "products_delete" ON products FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 3. PRODUCT_BARCODES — ver todos; escribir todos (parte de editar producto)
-- ============================================
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "barcodes_select" ON product_barcodes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "barcodes_write" ON product_barcodes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "barcodes_update" ON product_barcodes FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "barcodes_delete" ON product_barcodes FOR DELETE USING (auth.uid() IS NOT NULL);

-- ============================================
-- 4. SUPPLIERS — ver todos; alta/edición todos; borrar admin
-- ============================================
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_select" ON suppliers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 5. CUSTOMERS — ver todos; alta todos; editar admin+supervisor; borrar admin
-- ============================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_select" ON customers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "customers_insert" ON customers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "customers_update" ON customers FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "customers_delete" ON customers FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 6. LOCATIONS — ver todos; escribir solo admin
-- ============================================
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locations_select" ON locations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "locations_write" ON locations FOR INSERT WITH CHECK (user_role() = 'admin');
CREATE POLICY "locations_update" ON locations FOR UPDATE USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');
CREATE POLICY "locations_delete" ON locations FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 7. INVENTORY / INVENTORY_MOVEMENTS — lectura todos; SIN escritura
--    directa (solo RPCs SECURITY DEFINER: add_stock/adjust_stock/
--    confirm_stock_receipt/create_sale).
-- ============================================
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory_select" ON inventory FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements_select" ON inventory_movements FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- 8. STOCK_RECEIPTS + ITEMS — ver todos; crear/confirmar todos;
--    cancelar y borrar admin+supervisor (vendedor no cancela).
-- ============================================
ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipts_select" ON stock_receipts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "receipts_insert" ON stock_receipts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "receipts_update_admin" ON stock_receipts FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "receipts_update_vendedor" ON stock_receipts FOR UPDATE USING (user_role() = 'vendedor') WITH CHECK (user_role() = 'vendedor' AND status <> 'cancelled');
CREATE POLICY "receipts_delete" ON stock_receipts FOR DELETE USING (user_role() = 'admin');

ALTER TABLE stock_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipt_items_select" ON stock_receipt_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "receipt_items_insert" ON stock_receipt_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "receipt_items_update" ON stock_receipt_items FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "receipt_items_delete" ON stock_receipt_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- ============================================
-- 9. SALES — admin+supervisor todo; vendedor: ver/crear SOLO propias, sin anular.
-- ============================================
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_select_all" ON sales FOR SELECT USING (user_role() IN ('admin','supervisor'));
CREATE POLICY "sales_select_own" ON sales FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "sales_insert" ON sales FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sales_update_admin" ON sales FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "sales_delete" ON sales FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 10. SALE_ITEMS / PAYMENTS — ver+crear todos; editar admin+supervisor
-- ============================================
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_items_select" ON sale_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sale_items_insert" ON sale_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sale_items_update" ON sale_items FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "sale_items_delete" ON sale_items FOR DELETE USING (user_role() = 'admin');

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_select" ON payments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "payments_update" ON payments FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
CREATE POLICY "payments_delete" ON payments FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 11. STOCK_MOVEMENTS (legado) — ver+insertar todos (fallbacks);
--     sin UPDATE/DELETE salvo admin.
-- ============================================
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_mov_select" ON stock_movements FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stock_mov_insert" ON stock_movements FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "stock_mov_update" ON stock_movements FOR UPDATE USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');
CREATE POLICY "stock_mov_delete" ON stock_movements FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 12. CARD_BRANDS — ver todos; alta/edición todos (el POS auto-registra);
--     borrar admin.
-- ============================================
ALTER TABLE card_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "card_brands_select" ON card_brands FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "card_brands_write" ON card_brands FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "card_brands_update" ON card_brands FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "card_brands_delete" ON card_brands FOR DELETE USING (user_role() = 'admin');

-- ============================================
-- 13. PROFILES — ver todos; auto-alta propia; editar/borrar solo admin.
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');
CREATE POLICY "profiles_delete_admin" ON profiles FOR DELETE USING (user_role() = 'admin');

COMMIT;

-- Verificación: policies por tabla
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, cmd, policyname;
