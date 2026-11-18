-- ============================================================
-- Fecha real para las ventas sincronizadas desde modo offline
-- ------------------------------------------------------------
-- create_sale no recibe fecha: una venta de las 23:50 que
-- sincroniza 00:10 quedaba con fecha del día siguiente.
-- Esta función corrige created_at solo para el dueño de la venta,
-- con fecha pasada y dentro de los últimos 30 días.
-- ============================================================

begin;

create or replace function public.set_sale_created_at(
  p_sale_id uuid,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sale_id is null or p_created_at is null then
    return;
  end if;

  update public.sales
     set created_at = p_created_at
   where id = p_sale_id
     and user_id = auth.uid()
     and p_created_at <= now()
     and p_created_at > now() - interval '30 days';

  if not found then
    raise exception 'No se pudo ajustar la fecha de la venta %', p_sale_id;
  end if;
end;
$$;

revoke all on function public.set_sale_created_at(uuid, timestamptz) from public, anon;
grant execute on function public.set_sale_created_at(uuid, timestamptz) to authenticated, service_role;

commit;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_sale_created_at';
