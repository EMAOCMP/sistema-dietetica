-- ============================================================
-- Base limpia para empezar a operar el local
-- ------------------------------------------------------------
-- Borra SOLO los movimientos de la demo (ventas, caja, compras,
-- ingresos, ajustes y gastos) y deja el catálogo y los usuarios.
--
-- NO borra: products, suppliers, categories, units, locations,
-- profiles, audit_logs, product_barcodes.
--
-- Antes de correrlo: respaldo en
--   Desktop\Dietetica\Dietetica-Extras\respaldo-demo-13-11.json
-- ============================================================

begin;

-- Trazabilidad: los triggers de auditoría registran a EMANUEL.
set local request.jwt.claims = '{"sub":"ae5a1987-6cf3-4028-a965-f5644096a7a8","role":"authenticated"}';

-- Ventas
delete from public.payments;
delete from public.sale_items;
delete from public.sales;

-- Compras e ingresos de mercadería
delete from public.stock_movements;
delete from public.purchase_order_items;
delete from public.purchase_orders;
delete from public.stock_receipt_items;
delete from public.stock_receipts;

-- Stock: al borrar inventory, el trigger deja products.stock_quantity en 0
delete from public.inventory_movements;
delete from public.inventory;

-- Caja y gastos
delete from public.cash_closes;
delete from public.expenses;

-- Historial de precios de la demo (se vuelve a llenar al editar precios)
delete from public.product_price_history;

-- Numeración: la primera venta real es 0001-00000001,
-- el primer ingreso ING-000001 y la primera orden OC-000001.
update public.sale_counters set last_number = 0 where id = 1;
alter sequence public.stock_receipt_seq restart with 1;
alter sequence public.purchase_order_seq restart with 1;

commit;

-- Verificación posterior (todo debe dar 0)
select
  (select count(*) from public.sales)              as ventas,
  (select count(*) from public.sale_items)         as items_venta,
  (select count(*) from public.payments)           as pagos,
  (select count(*) from public.cash_closes)        as cierres,
  (select count(*) from public.expenses)           as gastos,
  (select count(*) from public.stock_receipts)     as ingresos,
  (select count(*) from public.purchase_orders)    as ordenes,
  (select count(*) from public.inventory_movements) as movimientos,
  (select count(*) from public.products)           as productos,
  (select coalesce(sum(stock_quantity), 0) from public.products) as stock_total,
  (select last_number from public.sale_counters)   as ultimo_ticket;
