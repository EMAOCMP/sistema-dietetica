-- ============================================
-- Dietética Vishal - Schema Improvements
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- 1. COLUMNAS FALTANTES EN SALES (fix error PGRST204)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_number TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS net_amount NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS iva_amount NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_doc TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_iva_cond TEXT DEFAULT 'CF';

-- Customer reference (opcional, se enlaza después de crear customers)
-- ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID;
-- ALTER TABLE sales ADD FOREIGN KEY (customer_id) REFERENCES customers(id);

-- 2. CATEGORÍAS
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES categories(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migrar categorías existentes desde products
INSERT INTO categories (name, description)
SELECT DISTINCT category, 'Migrado desde productos' 
FROM products 
WHERE category IS NOT NULL 
AND category NOT IN (SELECT name FROM categories);

-- 3. UNIDADES DE MEDIDA
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO units (code, name) VALUES
  ('unit', 'Unidad'),
  ('kg', 'Kilogramo'),
  ('l', 'Litro'),
  ('g', 'Gramo'),
  ('ml', 'Mililitro')
ON CONFLICT (code) DO NOTHING;

-- 4. MÉTODOS DE PAGO
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  requires_reference BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO payment_methods (code, name) VALUES
  ('cash', 'Efectivo'),
  ('transfer', 'Transferencia'),
  ('card', 'Tarjeta')
ON CONFLICT (code) DO NOTHING;

-- 5. TIPOS DE DESPACHO
CREATE TABLE IF NOT EXISTS dispatch_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  default_fee NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO dispatch_types (code, name) VALUES
  ('pickup', 'Retira en local'),
  ('delivery', 'Envío a domicilio')
ON CONFLICT (code) DO NOTHING;

-- 6. CONDICIONES IVA
CREATE TABLE IF NOT EXISTS iva_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

INSERT INTO iva_conditions (code, name, description) VALUES
  ('CF', 'Consumidor Final', 'No requiere CUIT'),
  ('RI', 'Responsable Inscripto', 'Requiere CUIT y factura A'),
  ('MONOTRIBUTO', 'Monotributo', 'Requiere CUIT'),
  ('EXENTO', 'Exento', 'Exento de IVA')
ON CONFLICT (code) DO NOTHING;

-- 7. CLIENTES
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  doc_type TEXT,
  doc_number TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  iva_condition_id UUID REFERENCES iva_conditions(id),
  discount_pct NUMERIC DEFAULT 0,
  credit_limit NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Migrar clientes existentes desde sales
INSERT INTO customers (name, doc_number, phone)
SELECT DISTINCT customer_name, customer_doc, NULL
FROM sales
WHERE customer_name IS NOT NULL 
AND customer_name != 'Cliente General'
AND customer_name NOT IN (SELECT name FROM customers);

-- Enlazar sales.customer_id (después de migrar)
-- ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
-- UPDATE sales SET customer_id = customers.id FROM customers WHERE customers.name = sales.customer_name;

-- 8. LOTES Y VENCIMIENTOS
CREATE TABLE IF NOT EXISTS product_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC,
  supplier_id UUID,
  received_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id, batch_number)
);

-- Índice para alertas de vencimiento
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date) WHERE quantity > 0;
CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id);

-- FK supplier después de crear suppliers
-- ALTER TABLE product_batches ADD FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

-- 9. PROVEEDORES
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  cuit TEXT,
  payment_terms_days INT DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enlazar supplier_id en products y batches
-- ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
-- ALTER TABLE product_batches ADD FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

-- 10. ÓRDENES DE COMPRA
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
  expected_date DATE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  received_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity_ordered NUMERIC NOT NULL,
  quantity_received NUMERIC DEFAULT 0,
  unit_cost NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_order ON purchase_order_items(order_id);

-- 11. AUDITORÍA
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  user_id UUID REFERENCES profiles(id),
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at DESC);

-- Función trigger de auditoría
CREATE OR REPLACE FUNCTION audit_trigger() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    TG_TABLE_NAME,
    COALESCE((NEW.id)::text::uuid, (OLD.id)::text::uuid, NULL),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    current_setting('app.current_user_id', true)::uuid
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Si falla (ej: no hay user_id), no bloquear la operación
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar auditoría a tablas críticas (opcional, comentar si no se quiere)
-- DROP TRIGGER IF EXISTS trg_audit_sales ON sales;
-- CREATE TRIGGER trg_audit_sales AFTER INSERT OR UPDATE OR DELETE ON sales
-- FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- DROP TRIGGER IF EXISTS trg_audit_products ON products;
-- CREATE TRIGGER trg_audit_products AFTER INSERT OR UPDATE OR DELETE ON products
-- FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- 12. TRIGGERS ÚTILES

-- Stock automático en ventas
CREATE OR REPLACE FUNCTION update_stock_on_sale() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - NEW.quantity)
    WHERE id = NEW.product_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE products SET stock_quantity = stock_quantity + OLD.quantity
    WHERE id = OLD.product_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_sale ON sale_items;
CREATE TRIGGER trg_stock_sale
AFTER INSERT OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION update_stock_on_sale();

-- Updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 13. ÍNDICES DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);

-- Búsqueda full-text en español para productos
CREATE INDEX IF NOT EXISTS idx_products_name_search ON products USING gin(to_tsvector('spanish', name));

-- 14. RLS POLICIES (descomentar si se quiere activar)
-- ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY sales_all ON sales USING (true) WITH CHECK (true);

-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY products_all ON products USING (true) WITH CHECK (true);

-- ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY customers_all ON customers USING (true) WITH CHECK (true);

-- ============================================
-- VERIFICACIÓN
-- ============================================
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- ORDER BY table_name;
