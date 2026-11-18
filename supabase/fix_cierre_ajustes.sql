-- ============================================================
-- Cierre de caja: fecha de actualización y medio de pago válido
-- ------------------------------------------------------------
-- 1) cash_closes.updated_at: al re-guardar un cierre se actualiza
--    la marca, para detectar si entraron ventas/gastos después.
-- 2) expenses.payment_method acotado: un valor desconocido no
--    descuenta del cajón y el cierre daría sobrante sin explicación.
-- ============================================================

begin;

alter table public.cash_closes
  add column if not exists updated_at timestamptz not null default now();

-- Si algún gasto viejo tuviera otro valor, lo normalizamos antes del CHECK.
update public.expenses
   set payment_method = 'cash'
 where payment_method is null
    or payment_method not in ('cash', 'transfer', 'card', 'mercadopago');

alter table public.expenses
  drop constraint if exists expenses_payment_method_check;

alter table public.expenses
  add constraint expenses_payment_method_check
  check (payment_method in ('cash', 'transfer', 'card', 'mercadopago'));

commit;

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cash_closes'
      and column_name = 'updated_at') as columna_updated_at,
  (select count(*) from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_payment_method_check') as check_medio_pago,
  (select count(*) from public.expenses
    where payment_method not in ('cash', 'transfer', 'card', 'mercadopago')) as gastos_invalidos;
