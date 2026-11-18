-- ============================================================
-- Catálogo de demostración — Dietética Vishal
-- 7 productos SIN stock + 1 proveedor de demo.
--
-- El stock NO se carga acá: entra por "Ingreso Mercadería" para
-- que quede el movimiento y el costo real.
--
-- Idempotente: si el barcode ya existe, no lo duplica.
-- Limpieza: supabase/reset_app_prueba.sql (borra todo lo operativo).
-- ============================================================
BEGIN;

INSERT INTO public.suppliers (name, phone, lead_time_days)
SELECT 'Distribuidora del Norte', '01155550001', 5
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers WHERE name = 'Distribuidora del Norte'
);

WITH prov AS (
  SELECT
    (SELECT id FROM public.suppliers WHERE name = 'Distribuidora del Norte') AS norte,
    (SELECT id FROM public.suppliers WHERE name = 'emanuel')                 AS emanuel
)
INSERT INTO public.products
  (barcode, name, category, unit_type,
   cost_price, wholesale_price, retail_price, min_stock, supplier_id)
SELECT v.barcode, v.name, v.category, v.unit_type,
       v.cost, v.wholesale, v.retail, v.min_stock,
       CASE v.prov
         WHEN 'norte' THEN COALESCE(prov.norte, prov.emanuel)
         ELSE COALESCE(prov.emanuel, prov.norte)
       END
FROM (VALUES
  ('7790001000011','Almendras Non Pareil','Frutos Secos',       'kg',   9000, 12000, 15000, 5, 'norte'),
  ('7790001000028','Nueces Mariposa',     'Frutos Secos',       'kg',  11000, 14500, 18000, 4, 'norte'),
  ('7790001000035','Maní Salado',         'Frutos Secos',       'kg',   3500,  5200,  6500, 6, 'norte'),
  ('7790001000042','Girasol Pelado',      'Semillas',           'kg',   2800,  4200,  5200, 4, 'norte'),
  ('7790001000059','Lentejas',            'Legumbres',          'kg',   2400,  3600,  4500, 6, 'emanuel'),
  ('7790001000066','Avena Instantánea',   'Cereales y Granola', 'kg',   1900,  2900,  3600, 6, 'emanuel'),
  ('7790001000073','Miel Pura 500 g',     'General',            'unit', 4200,  6200,  7800, 6, 'emanuel')
) AS v(barcode, name, category, unit_type, cost, wholesale, retail, min_stock, prov)
CROSS JOIN prov
ON CONFLICT (barcode) DO NOTHING;

COMMIT;

-- Control: 7 productos y stock total 0
SELECT count(*) AS productos,
       COALESCE(SUM(stock_quantity), 0) AS stock_total
FROM public.products
WHERE barcode LIKE '77900010000%';
