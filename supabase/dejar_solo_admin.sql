-- ============================================================
-- Dejar UN SOLO usuario: nekrok22k@gmail.com como admin
-- ------------------------------------------------------------
-- Borra el resto de usuarios de Authentication y sus perfiles.
-- Borra también la auditoría de esos usuarios: si no, la FK
-- audit_logs.user_id -> profiles.id impide borrar el perfil.
-- IRREVERSIBLE.
-- ============================================================

begin;

do $$
declare
  v_email constant text := 'nekrok22k@gmail.com';
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'No existe el usuario %. Crearlo primero en Authentication > Users.', v_email;
  end if;

  -- La auditoría del usuario demo no se puede conservar sin su perfil.
  delete from public.audit_logs
  where user_id is not null and user_id <> v_id;

  -- Perfiles, sesiones, identidades y ajustes caen por cascade.
  delete from auth.users where id <> v_id;

  -- Asegurar login sin "Email not confirmed".
  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_id;

  update public.profiles
  set role = 'admin', email = v_email
  where id = v_id;
end $$;

commit;

-- Verificación: una sola fila
select u.email, u.email_confirmed_at, p.role, p.full_name,
       (select count(*) from auth.users) as usuarios_totales,
       (select count(*) from public.profiles) as perfiles
from auth.users u
left join public.profiles p on p.id = u.id;
