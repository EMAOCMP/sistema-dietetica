-- ============================================================
-- Caja real: fondo inicial, ingresos y retiros de efectivo
-- ------------------------------------------------------------
-- El efectivo esperado pasa a ser:
--   fondo + ventas en efectivo + ingresos - retiros - gastos en efectivo
-- Los gastos salen de public.expenses con payment_method = 'cash'.
-- ============================================================

begin;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  type text not null check (type in ('opening', 'in', 'out')),
  amount numeric(12,2) not null check (amount > 0),
  note text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Un solo fondo inicial por día.
create unique index if not exists cash_movements_one_opening
  on public.cash_movements (business_date) where type = 'opening';

create index if not exists cash_movements_date_idx
  on public.cash_movements (business_date);

alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select using (auth.uid() is not null);

drop policy if exists cash_movements_insert on public.cash_movements;
create policy cash_movements_insert on public.cash_movements
  for insert with check (user_role() in ('admin', 'supervisor'));

drop policy if exists cash_movements_update on public.cash_movements;
create policy cash_movements_update on public.cash_movements
  for update using (user_role() in ('admin', 'supervisor'))
  with check (user_role() in ('admin', 'supervisor'));

drop policy if exists cash_movements_delete on public.cash_movements;
create policy cash_movements_delete on public.cash_movements
  for delete using (user_role() in ('admin', 'supervisor'));

alter table public.cash_closes
  add column if not exists opening_float numeric(12,2) not null default 0,
  add column if not exists cash_in numeric(12,2) not null default 0,
  add column if not exists cash_out numeric(12,2) not null default 0,
  add column if not exists cash_expenses numeric(12,2) not null default 0;

commit;

select
  to_regclass('public.cash_movements') is not null as tabla_creada,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cash_closes'
      and column_name in ('opening_float', 'cash_in', 'cash_out', 'cash_expenses')) as columnas_nuevas,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'cash_movements') as politicas;
