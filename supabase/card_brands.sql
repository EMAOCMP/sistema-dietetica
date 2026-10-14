-- ============================================
-- Dietética Vishal - Catálogo de marcas de tarjeta
-- Ejecutar en Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS card_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO card_brands (code, name) VALUES
  ('visa', 'Visa'),
  ('mastercard', 'Mastercard'),
  ('amex', 'American Express'),
  ('cabal', 'Cabal'),
  ('naranja', 'Naranja X'),
  ('uala', 'Ualá'),
  ('mercadopago', 'Mercado Pago'),
  ('nativa', 'Nativa'),
  ('otra', 'Otra')
ON CONFLICT (code) DO NOTHING;

-- Verificación
SELECT code, name FROM card_brands WHERE is_active ORDER BY name;
