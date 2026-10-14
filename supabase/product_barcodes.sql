-- ============================================
-- Dietética Vishal - Múltiples códigos por producto
-- Ejecutar en Supabase SQL Editor
-- Un producto puede tener EAN unidad, EAN caja/pack y código interno
-- ============================================

CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  barcode_type TEXT DEFAULT 'EAN-13',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(barcode)
);

CREATE INDEX IF NOT EXISTS idx_barcodes_product ON product_barcodes(product_id);
CREATE INDEX IF NOT EXISTS idx_barcodes_code ON product_barcodes(barcode);

-- Migrar códigos existentes como primarios
INSERT INTO product_barcodes (product_id, barcode, barcode_type, is_primary)
SELECT id, barcode, 'EAN-13', true
FROM products
WHERE barcode IS NOT NULL AND barcode <> ''
ON CONFLICT (barcode) DO NOTHING;

-- RLS (lectura abierta, escritura autenticada)
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

-- Verificación
SELECT COUNT(*) AS total_alias FROM product_barcodes;
