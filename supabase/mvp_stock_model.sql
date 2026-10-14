-- ============================================
-- Dietética Vishal - MVP Stock Model
-- Ejecutar en Supabase SQL Editor
-- Modelo paralelo (no rompe el actual):
--   locations || inventory || inventory_movements || product_barcodes v2
-- Backfill desde products.stock_quantity y products.barcode
-- RPCs transaccionales: add_stock() / adjust_stock()
-- Trigger: mantiene products.stock_quantity sincronizado con inventory (compat)
-- ============================================

BEGIN;

-- ============================================
-- 1. LOCATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'store',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name)
);

INSERT INTO locations (name, type)
SELECT 'Local principal', 'store'
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Local principal');

-- ============================================
-- 2. INVENTORY  (balance por producto + ubicación, decimal para kg)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) DEFAULT 0,
  lot_number TEXT,
  expiration_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (product_id, location_id)
);

-- Backfill: existencias actuales al Local principal
INSERT INTO inventory (product_id, location_id, quantity)
SELECT p.id, l.id, COALESCE(p.stock_quantity, 0)
FROM products p
CROSS JOIN locations l
WHERE l.name = 'Local principal'
ON CONFLICT (product_id, location_id) DO NOTHING;

-- ============================================
-- 3. INVENTORY_MOVEMENTS  (auditoría, solo-append)
-- ============================================
DROP TABLE IF EXISTS inventory_movements CASCADE;
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  type TEXT NOT NULL
    CHECK (type IN ('purchase','sale','adjustment','return','loss','initial','transfer_in','transfer_out')),
  quantity NUMERIC(12,3) NOT NULL,
  previous_quantity NUMERIC(12,3),
  new_quantity NUMERIC(12,3),
  reference_type TEXT,
  reference_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON inventory_movements(type);
CREATE INDEX IF NOT EXISTS idx_inv_mov_ref ON inventory_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created ON inventory_movements(created_at DESC);

-- Migrar historial desde stock_movements (defensivo: normaliza tipos desconocidos)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_movements') THEN
    INSERT INTO inventory_movements (product_id, quantity, type, created_at)
    SELECT product_id, quantity,
      CASE WHEN COALESCE(type,'adjustment') IN
        ('purchase','sale','adjustment','return','loss','initial','transfer_in','transfer_out')
      THEN COALESCE(type,'adjustment')
      ELSE 'adjustment' END,
      created_at
    FROM stock_movements;
  END IF;
END $$;

-- ============================================
-- 4. PRODUCT_BARCODES v2: barcode_normalized + active + UNIQUE
-- ============================================

-- Autosuficiente: crea la tabla si el archivo product_barcodes.sql
-- aún no se ejecutó (CREATE IF NOT EXISTS cubre el caso "ya existe")
CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  barcode_type TEXT DEFAULT 'EAN-13',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(barcode)
);

-- Migrar códigos existentes como primarios (idempotente)
INSERT INTO product_barcodes (product_id, barcode, barcode_type, is_primary)
SELECT id, barcode, 'EAN-13', true
FROM products
WHERE barcode IS NOT NULL AND barcode <> ''
ON CONFLICT (barcode) DO NOTHING;

-- Función de normalización compartida (misma regla que el frontend):
--   trim → limpiar caracteres no válidos → uppercase para alfanuméricos
--   UPC-A (12 díg) → '0' + código (equivale EAN-13)
--   EAN-8 / EAN-13 quedan tal cual
CREATE OR REPLACE FUNCTION normalize_barcode(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN raw ~ '^\s*[0-9]{12}\s*$' THEN '0' || regexp_replace(raw, '\s', '', 'g')
    ELSE upper(regexp_replace(regexp_replace(raw, '[^A-Za-z0-9]', '', 'g'), '\s', '', 'g'))
  END;
$$;

ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS barcode_normalized TEXT;
ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Backfill del normalizado usando la misma regla
UPDATE product_barcodes SET barcode_normalized = normalize_barcode(barcode)
WHERE barcode_normalized IS NULL OR barcode_normalized = '';

-- Trigger: garantiza el normalizado en cada INSERT/UPDATE
CREATE OR REPLACE FUNCTION trg_set_barcode_normalized() RETURNS TRIGGER AS $$
BEGIN
  NEW.barcode_normalized := normalize_barcode(NEW.barcode);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_barcode_normalized ON product_barcodes;
CREATE TRIGGER trg_barcode_normalized
  BEFORE INSERT OR UPDATE OF barcode ON product_barcodes
  FOR EACH ROW EXECUTE FUNCTION trg_set_barcode_normalized();

-- Índice único global sobre el normalizado (evita el mismo código en dos productos)
-- Antes: limpiar colisiones (p.ej. '779...' y '0' + '779...' normalizan al mismo)
DELETE FROM product_barcodes a
USING product_barcodes b
WHERE a.id > b.id
  AND a.barcode_normalized IS NOT NULL
  AND a.barcode_normalized <> ''
  AND a.barcode_normalized = b.barcode_normalized;

DROP INDEX IF EXISTS ux_product_barcodes_normalized;
CREATE UNIQUE INDEX ux_product_barcodes_normalized
  ON product_barcodes(barcode_normalized)
  WHERE barcode_normalized IS NOT NULL AND barcode_normalized <> '';

CREATE INDEX IF NOT EXISTS idx_barcodes_active ON product_barcodes(active);

-- ============================================
-- 5. TRIGGER: sincronizar products.stock_quantity (compat con vistas actuales)
-- ============================================
CREATE OR REPLACE FUNCTION sync_products_stock() RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(quantity), 0)
      FROM inventory WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.product_id, OLD.product_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_sync_product ON inventory;
CREATE TRIGGER trg_inventory_sync_product
  AFTER INSERT OR UPDATE OR DELETE ON inventory
  FOR EACH ROW EXECUTE FUNCTION sync_products_stock();

-- ============================================
-- 6. RPC transaccional: add_stock()  (ingreso / purchase / initial)
--    Frontend manda { product_id, quantity, cost, lot, expiration }
--    El backend: valida → bloquea → prev → new → UPDATE → INSERT movement
-- ============================================
CREATE OR REPLACE FUNCTION add_stock(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_cost_price NUMERIC DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_lot_number TEXT DEFAULT NULL,
  p_expiration_date DATE DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'manual',
  p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE(product_id UUID, new_quantity NUMERIC, previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_loc UUID;
  v_prev NUMERIC;
  v_new NUMERIC;
BEGIN
  -- valida usuario
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  -- resuelve ubicación (default Local principal)
  v_loc := p_location_id;
  IF v_loc IS NULL THEN
    SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;
  END IF;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'No existe ubicación de stock';
  END IF;

  -- asegura renglón de inventory
  INSERT INTO inventory (product_id, location_id, quantity, lot_number, expiration_date)
  VALUES (p_product_id, v_loc, 0, p_lot_number, p_expiration_date)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  -- bloqueo + saldo actual
  SELECT quantity INTO v_prev
  FROM inventory
  WHERE product_id = p_product_id AND location_id = v_loc
  FOR UPDATE;

  v_new := v_prev + p_quantity;

  -- actualiza saldo
  UPDATE inventory
    SET quantity = v_new,
        lot_number = COALESCE(p_lot_number, lot_number),
        expiration_date = COALESCE(p_expiration_date, expiration_date),
        updated_at = now()
  WHERE product_id = p_product_id AND location_id = v_loc;

  -- auditoría (solo-append)
  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id)
  VALUES
    (p_product_id, v_loc, 'purchase', p_quantity, v_prev, v_new,
     p_reference_type, p_reference_id, auth.uid());

  -- costo unitario opcional
  IF p_cost_price IS NOT NULL THEN
    UPDATE products SET cost_price = p_cost_price, updated_at = now()
    WHERE id = p_product_id;
  END IF;

  RETURN QUERY SELECT p_product_id, v_new, v_prev;
END;
$$;

-- ============================================
-- 7. RPC transaccional: adjust_stock()  (ajuste / correction)
--    quantity puede ser positivo o negativo; valida que no quede negativo
-- ============================================
CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_location_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'adjustment',
  p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE(product_id UUID, new_quantity NUMERIC, previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_loc UUID;
  v_prev NUMERIC;
  v_new NUMERIC;
  v_type TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  v_loc := p_location_id;
  IF v_loc IS NULL THEN
    SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;
  END IF;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'No existe ubicación de stock';
  END IF;

  INSERT INTO inventory (product_id, location_id, quantity)
  VALUES (p_product_id, v_loc, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT quantity INTO v_prev
  FROM inventory
  WHERE product_id = p_product_id AND location_id = v_loc
  FOR UPDATE;

  v_new := v_prev + p_quantity;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente: actual %', v_prev;
  END IF;

  v_type := CASE
    WHEN p_quantity > 0 AND COALESCE(p_reference_type,'adjustment') = 'loss' THEN 'loss'
    ELSE 'adjustment'
  END;

  UPDATE inventory
    SET quantity = v_new, updated_at = now()
  WHERE product_id = p_product_id AND location_id = v_loc;

  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id)
  VALUES
    (p_product_id, v_loc, v_type, p_quantity, v_prev, v_new,
     p_reference_type, p_reference_id, auth.uid());

  RETURN QUERY SELECT p_product_id, v_new, v_prev;
END;
$$;

-- ============================================
-- 8. RLS (authenticated para MVP)
--    lectura: productos/locations/inventory/movements
--    escritura directa: NINGUNA en inventory ni movements (solo RPCs)
-- ============================================
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "locations_read" ON locations;
CREATE POLICY "locations_read" ON locations FOR SELECT USING (true);

-- product_barcodes: lectura abierta, escritura autenticada (el front inserta alias)
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "barcodes_select" ON product_barcodes;
CREATE POLICY "barcodes_select" ON product_barcodes
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "barcodes_insert" ON product_barcodes;
CREATE POLICY "barcodes_insert" ON product_barcodes
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "barcodes_update" ON product_barcodes;
CREATE POLICY "barcodes_update" ON product_barcodes
  FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "barcodes_delete" ON product_barcodes;
CREATE POLICY "barcodes_delete" ON product_barcodes
  FOR DELETE USING (true);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_read" ON inventory;
CREATE POLICY "inventory_read" ON inventory FOR SELECT USING (true);

DROP POLICY IF EXISTS "inventory_write" ON inventory;
CREATE POLICY "inventory_write" ON inventory FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "inventory_update" ON inventory;
CREATE POLICY "inventory_update" ON inventory FOR UPDATE USING (false);
DROP POLICY IF EXISTS "inventory_delete" ON inventory;
CREATE POLICY "inventory_delete" ON inventory FOR DELETE USING (false);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movements_read" ON inventory_movements;
CREATE POLICY "movements_read" ON inventory_movements FOR SELECT USING (true);

DROP POLICY IF EXISTS "movements_write" ON inventory_movements;
CREATE POLICY "movements_write" ON inventory_movements FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "movements_update" ON inventory_movements;
CREATE POLICY "movements_update" ON inventory_movements FOR UPDATE USING (false);
DROP POLICY IF EXISTS "movements_delete" ON inventory_movements;
CREATE POLICY "movements_delete" ON inventory_movements FOR DELETE USING (false);

-- Revisión de permisos en los RPCs (Solo el rol autenticado los ejecuta)
REVOKE ALL ON FUNCTION add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

-- ============================================
-- Verificación
-- ============================================
SELECT 'locations' AS tabla, COUNT(*) FROM locations
UNION ALL SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'product_barcodes', COUNT(*) FROM product_barcodes;