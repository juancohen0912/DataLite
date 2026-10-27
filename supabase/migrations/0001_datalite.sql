-- DataLite · proyectos en la nube, permisos para compartir y planes de pago con Wompi.
-- Proyecto Supabase propio de DataLite (reutiliza el proyecto del piloto BlindApp, cancelado).
-- Todo lo de DataLite usa el prefijo dl_. Seguridad: RLS en todas las tablas; las escrituras pasan por
-- funciones que validan permisos, plan y límites. El navegador nunca decide montos, roles ni cupos.

-- ───────────────────────── Base: esquema privado, administradores y BlindApp cancelado ─────────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Administradores de la plataforma (activan planes manualmente y pueden probar Pro)
create table private.dl_admins (email text primary key check (email = lower(btrim(email))));
alter table private.dl_admins enable row level security;
revoke all on private.dl_admins from public, anon, authenticated;
insert into private.dl_admins (email) values ('juan.cohen0912@gmail.com');

create function private.dl_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u join private.dl_admins a on a.email = lower(u.email)
                 where u.id = (select auth.uid()) and u.email_confirmed_at is not null);
$$;
revoke all on function private.dl_is_admin() from public, anon;
grant execute on function private.dl_is_admin() to authenticated;

-- Las tablas del piloto BlindApp (cancelado, sin datos) quedan sin acceso desde la API
do $$ declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename = any (array[
    'cuentas','consentimientos','preferencias','diccionarios_pii','dispositivos','perfiles','fotos_privadas','salas','pares_historicos',
    'propuestas_diarias','bloqueos','reportes','evidencias','billeteras','movimientos','eventos_outbox','mensajes'])
  loop execute format('revoke all on public.%I from anon, authenticated', t); end loop;
end $$;

-- ───────────────────────── Catálogo de planes ─────────────────────────
create table public.dl_plans (
  id text primary key check (id ~ '^[a-z]+$'),
  name text not null,
  price_cop int not null check (price_cop > 0),
  max_projects int not null check (max_projects > 0),
  max_members int not null check (max_members >= 0),
  max_data_mb int not null check (max_data_mb between 1 and 25),
  sort int not null default 0,
  active boolean not null default true
);
insert into public.dl_plans (id, name, price_cop, max_projects, max_members, max_data_mb, sort)
values ('pro', 'DataLite Pro', 19900, 50, 10, 25, 1);

alter table public.dl_plans enable row level security;
revoke all on public.dl_plans from anon, authenticated;
grant select on public.dl_plans to anon, authenticated;
create policy "dl planes: lectura pública" on public.dl_plans for select to anon, authenticated using (active);

-- ───────────────────────── Consentimiento para DataLite (Ley 1581 de 2012) ─────────────────────────
-- Registro de la versión de la política aceptada (al registrarse o, si cambia, al volver a aceptarla).
create table public.dl_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  accepted_at timestamptz not null default now()
);
alter table public.dl_consents enable row level security;
revoke all on public.dl_consents from anon, authenticated;
grant select on public.dl_consents to authenticated;
create policy "dl consentimiento propio: leer" on public.dl_consents for select to authenticated using (user_id = (select auth.uid()));

-- Quien se registra desde DataLite marcó la casilla de aceptación: se guarda la versión aceptada
create function private.dl_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'signup_app', '') = 'datalite'
     and char_length(coalesce(new.raw_user_meta_data ->> 'consent_version', '')) between 1 and 40 then
    insert into public.dl_consents (user_id, consent_version) values (new.id, new.raw_user_meta_data ->> 'consent_version')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.dl_handle_new_user() from public, anon, authenticated;
create trigger dl_on_auth_user_created after insert on auth.users for each row execute function private.dl_handle_new_user();

-- ───────────────────────── Suscripción (30 días por pago) y pagos ─────────────────────────
create table public.dl_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null references public.dl_plans (id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.dl_subscriptions enable row level security;
revoke all on public.dl_subscriptions from anon, authenticated;
grant select on public.dl_subscriptions to authenticated;
create policy "dl suscripción propia: leer" on public.dl_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create table public.dl_payments (
  reference text primary key check (reference ~ '^DL-[0-9A-Za-z-]{10,60}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.dl_plans (id),
  amount_in_cents bigint not null check (amount_in_cents > 0),
  currency text not null default 'COP',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR')),
  wompi_transaction_id text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dl_payments_user_idx on public.dl_payments (user_id, created_at desc);
alter table public.dl_payments enable row level security;
revoke all on public.dl_payments from anon, authenticated;
grant select on public.dl_payments to authenticated;
create policy "dl pagos propios: leer" on public.dl_payments for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────── Proyectos y miembros ─────────────────────────
create table public.dl_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 1048576),
  has_data boolean not null default false,
  data_bytes int not null default 0 check (data_bytes between 0 and 26214400),
  row_count int not null default 0 check (row_count >= 0),
  version int not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index dl_projects_owner_idx on public.dl_projects (owner_id, updated_at desc);

-- Se invita por correo: la persona puede no tener cuenta todavía
create table public.dl_project_members (
  project_id uuid not null references public.dl_projects (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('viewer', 'editor')),
  edit_requested_at timestamptz,
  invited_at timestamptz not null default now(),
  primary key (project_id, email)
);
create index dl_members_email_idx on public.dl_project_members (email);

-- ───────────────────────── Ayudas de permisos ─────────────────────────
-- Correo verificado de quien hace la consulta (desde auth.users, no desde datos editables por el usuario)
create function private.dl_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

create function private.dl_is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dl_subscriptions s where s.user_id = p_user and s.period_end > now())
      or exists (select 1 from auth.users u join private.dl_admins a on a.email = lower(u.email)
                 where u.id = p_user and u.email_confirmed_at is not null);
$$;

-- 'owner' | 'editor' | 'viewer' | null
create function private.dl_role(p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p.owner_id = (select auth.uid()) then 'owner'
              else (select m.role from public.dl_project_members m where m.project_id = p.id and m.email = private.dl_email()) end
    from public.dl_projects p where p.id = p_project;
$$;

-- Editar exige permiso (dueño o editor invitado) y que el dueño tenga el plan vigente: solo paga el creador
create function private.dl_can_edit(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.dl_role(p.id) in ('owner', 'editor') and private.dl_is_pro(p.owner_id)
                     from public.dl_projects p where p.id = p_project), false);
$$;

-- Ruta de Storage válida: <uuid del proyecto>/data.bin
create function private.dl_object_project(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/data\.bin$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

revoke all on function private.dl_email(), private.dl_is_pro(uuid), private.dl_role(uuid), private.dl_can_edit(uuid), private.dl_object_project(text) from public, anon;
grant execute on function private.dl_email(), private.dl_is_pro(uuid), private.dl_role(uuid), private.dl_can_edit(uuid), private.dl_object_project(text) to authenticated;

-- Lectura: dueño y miembros. Todas las escrituras van por funciones.
alter table public.dl_projects enable row level security;
revoke all on public.dl_projects from anon, authenticated;
grant select on public.dl_projects to authenticated;
create policy "dl proyectos: dueño y miembros leen" on public.dl_projects for select to authenticated
  using (private.dl_role(id) is not null);

alter table public.dl_project_members enable row level security;
revoke all on public.dl_project_members from anon, authenticated;
grant select on public.dl_project_members to authenticated;
create policy "dl miembros: dueño ve todos, cada quien su fila" on public.dl_project_members for select to authenticated
  using (private.dl_role(project_id) = 'owner' or email = private.dl_email());

-- ───────────────────────── Storage privado para los datos de cada proyecto ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('datalite', 'datalite', false, 26214400, array['application/octet-stream'])
on conflict (id) do nothing;

create policy "datalite: leer si es miembro" on storage.objects for select to authenticated
  using (bucket_id = 'datalite' and private.dl_role(private.dl_object_project(name)) is not null);
create policy "datalite: subir si puede editar" on storage.objects for insert to authenticated
  with check (bucket_id = 'datalite' and private.dl_can_edit(private.dl_object_project(name)));
create policy "datalite: reemplazar si puede editar" on storage.objects for update to authenticated
  using (bucket_id = 'datalite' and private.dl_can_edit(private.dl_object_project(name)))
  with check (bucket_id = 'datalite' and private.dl_can_edit(private.dl_object_project(name)));
create policy "datalite: borrar solo el dueño" on storage.objects for delete to authenticated
  using (bucket_id = 'datalite' and private.dl_role(private.dl_object_project(name)) = 'owner');

-- ───────────────────────── Funciones para la app ─────────────────────────
create function public.dl_account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', private.dl_email(),
    'admin', private.dl_is_admin(),
    'pro', private.dl_is_pro((select auth.uid())),
    'consent_version', (select c.consent_version from public.dl_consents c where c.user_id = (select auth.uid())),
    'plan', (select jsonb_build_object('id', s.plan_id, 'name', p.name, 'period_end', s.period_end)
               from public.dl_subscriptions s join public.dl_plans p on p.id = s.plan_id
              where s.user_id = (select auth.uid()) and s.period_end > now()),
    'projects', (select count(*) from public.dl_projects where owner_id = (select auth.uid())),
    'limits', (select jsonb_build_object('max_projects', max_projects, 'max_members', max_members, 'max_data_mb', max_data_mb)
                 from public.dl_plans where id = 'pro'),
    'pending_requests', (select count(*) from public.dl_project_members m join public.dl_projects p on p.id = m.project_id
                          where p.owner_id = (select auth.uid()) and m.role = 'viewer' and m.edit_requested_at is not null)
  );
$$;

create function public.dl_accept_terms(p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'no autenticado'; end if;
  if p_version is null or char_length(p_version) not between 1 and 40 then raise exception 'versión no válida'; end if;
  insert into public.dl_consents (user_id, consent_version) values ((select auth.uid()), p_version)
  on conflict (user_id) do update set consent_version = excluded.consent_version, accepted_at = now();
end $$;

-- Requisitos comunes para crear o compartir
create function private.dl_require_pro() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if not exists (select 1 from public.dl_consents where user_id = uid) then
    raise exception 'Acepta la política de privacidad de DataLite para continuar.' using errcode = 'P0001', hint = 'consent';
  end if;
  if not private.dl_is_pro(uid) then
    raise exception 'Necesitas DataLite Pro para esta acción.' using errcode = 'P0001', hint = 'pro';
  end if;
  return uid;
end $$;
revoke all on function private.dl_require_pro() from public, anon;
grant execute on function private.dl_require_pro() to authenticated;

create function public.dl_create_project(p_name text, p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.dl_require_pro();
  lim int := (select max_projects from public.dl_plans where id = 'pro');
  new_id uuid;
begin
  if (select count(*) from public.dl_projects where owner_id = uid) >= lim then
    raise exception 'Llegaste al máximo de % proyectos. Borra alguno para crear otro.', lim using hint = 'limit';
  end if;
  insert into public.dl_projects (owner_id, name, state, updated_by)
  values (uid, btrim(p_name), coalesce(p_state, '{}'::jsonb), uid)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'version', 1);
end $$;

-- Guarda con control de versión: si otra persona guardó antes, se rechaza en lugar de sobrescribir.
create function public.dl_save_project(
  p_id uuid, p_name text, p_state jsonb, p_expected_version int, p_has_data boolean, p_data_bytes int, p_row_count int
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pr public.dl_projects;
  role text;
  max_mb int := (select max_data_mb from public.dl_plans where id = 'pro');
begin
  if uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  select * into pr from public.dl_projects where id = p_id for update;
  if not found then raise exception 'El proyecto no existe o no tienes acceso.' using hint = 'notfound'; end if;
  role := private.dl_role(p_id);
  if role is null then raise exception 'El proyecto no existe o no tienes acceso.' using hint = 'notfound'; end if;
  if not private.dl_can_edit(p_id) then
    raise exception 'No tienes permiso para editar este proyecto.' using hint = case when role = 'viewer' then 'viewer' else 'owner_not_pro' end;
  end if;
  if pr.version <> p_expected_version then
    raise exception 'Alguien guardó cambios en este proyecto mientras lo editabas. Ábrelo de nuevo para ver la versión más reciente.' using hint = 'conflict';
  end if;
  if coalesce(p_data_bytes, 0) > max_mb * 1048576 then
    raise exception 'Los datos superan el máximo de % MB por proyecto.', max_mb using hint = 'limit';
  end if;
  update public.dl_projects
     set name = case when role = 'owner' and btrim(coalesce(p_name, '')) <> '' then btrim(p_name) else name end,
         state = coalesce(p_state, state),
         has_data = coalesce(p_has_data, has_data),
         data_bytes = coalesce(p_data_bytes, data_bytes),
         row_count = coalesce(p_row_count, row_count),
         version = version + 1, updated_at = now(), updated_by = uid
   where id = p_id;
  return pr.version + 1;
end $$;

create function public.dl_delete_project(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.dl_role(p_id) is distinct from 'owner' then raise exception 'Solo el dueño puede borrar el proyecto.'; end if;
  delete from public.dl_projects where id = p_id;
end $$;

create function public.dl_get_project(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'state', p.state, 'version', p.version, 'role', private.dl_role(p.id),
    'can_edit', private.dl_can_edit(p.id), 'owner_email', (select lower(u.email) from auth.users u where u.id = p.owner_id),
    'has_data', p.has_data, 'data_bytes', p.data_bytes, 'row_count', p.row_count, 'updated_at', p.updated_at,
    'edit_requested', (select m.edit_requested_at is not null from public.dl_project_members m where m.project_id = p.id and m.email = private.dl_email()))
  from public.dl_projects p where p.id = p_id and private.dl_role(p.id) is not null;
$$;

create function public.dl_list_projects() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'role', private.dl_role(p.id), 'updated_at', p.updated_at, 'row_count', p.row_count,
      'owner_email', (select lower(u.email) from auth.users u where u.id = p.owner_id),
      'members', case when p.owner_id = (select auth.uid()) then (select count(*) from public.dl_project_members m where m.project_id = p.id) end,
      'requests', case when p.owner_id = (select auth.uid()) then (select count(*) from public.dl_project_members m where m.project_id = p.id and m.role = 'viewer' and m.edit_requested_at is not null) end
    ) as x
    from public.dl_projects p
    where p.owner_id = (select auth.uid())
       or exists (select 1 from public.dl_project_members m where m.project_id = p.id and m.email = private.dl_email())
    limit 200
  ) t;
$$;

create function public.dl_list_members(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.dl_role(p_id) = 'owner' then
    coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role, 'edit_requested_at', m.edit_requested_at,
                                                 'has_account', exists (select 1 from auth.users u where lower(u.email) = m.email))
                               order by m.invited_at)
                from public.dl_project_members m where m.project_id = p_id), '[]'::jsonb)
  end;
$$;

-- Compartir: solo el dueño con plan vigente. Ver es gratis para el invitado; editar requiere este permiso.
create function public.dl_share(p_id uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.dl_require_pro();
  em text := lower(btrim(coalesce(p_email, '')));
  lim int := (select max_members from public.dl_plans where id = 'pro');
begin
  if private.dl_role(p_id) is distinct from 'owner' then raise exception 'Solo el dueño puede compartir el proyecto.'; end if;
  if p_role not in ('viewer', 'editor') then raise exception 'Permiso no válido.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'Escribe un correo válido.'; end if;
  if em = private.dl_email() then raise exception 'Ya eres el dueño del proyecto.'; end if;
  if not exists (select 1 from public.dl_project_members where project_id = p_id and email = em)
     and (select count(*) from public.dl_project_members where project_id = p_id) >= lim then
    raise exception 'Puedes compartir cada proyecto con máximo % personas.', lim using hint = 'limit';
  end if;
  insert into public.dl_project_members (project_id, email, role) values (p_id, em, p_role)
  on conflict (project_id, email) do update
    set role = excluded.role,
        edit_requested_at = case when excluded.role = 'editor' then null else public.dl_project_members.edit_requested_at end;
end $$;

-- Quitar acceso: el dueño a cualquiera; un invitado puede salirse.
create function public.dl_unshare(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare em text := lower(btrim(coalesce(p_email, '')));
begin
  if private.dl_role(p_id) is distinct from 'owner' and em is distinct from private.dl_email() then
    raise exception 'No tienes permiso para quitar este acceso.';
  end if;
  delete from public.dl_project_members where project_id = p_id and email = em;
end $$;

-- Un lector pide permiso de edición; el dueño decide.
create function public.dl_request_edit(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.dl_project_members set edit_requested_at = now()
   where project_id = p_id and email = private.dl_email() and role = 'viewer'
     and (edit_requested_at is null or edit_requested_at < now() - interval '1 day');
  return found;
end $$;

-- Rechazar una solicitud sin cambiar el permiso
create function public.dl_dismiss_request(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.dl_role(p_id) is distinct from 'owner' then raise exception 'Solo el dueño puede responder solicitudes.'; end if;
  update public.dl_project_members set edit_requested_at = null where project_id = p_id and email = lower(btrim(p_email));
end $$;

-- ───────────────────────── Pagos ─────────────────────────
create function public.dl_create_payment(p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pl public.dl_plans;
  ref text;
begin
  if uid is null then raise exception 'no autenticado'; end if;
  if not exists (select 1 from public.dl_consents where user_id = uid) then raise exception 'Acepta la política de privacidad de DataLite para continuar.' using hint = 'consent'; end if;
  select * into pl from public.dl_plans where id = p_plan and active;
  if not found then raise exception 'plan no válido'; end if;
  if (select count(*) from public.dl_payments where user_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'demasiados intentos de pago';
  end if;
  ref := 'DL-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.dl_payments (reference, user_id, plan_id, amount_in_cents) values (ref, uid, pl.id, pl.price_cop::bigint * 100);
  return jsonb_build_object('reference', ref, 'amount_in_cents', pl.price_cop::bigint * 100, 'currency', 'COP', 'plan', pl.id);
end $$;

-- Solo el servidor (después de verificar con Wompi). Idempotente: un pago nunca activa dos periodos.
create function public.dl_apply_payment(
  p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint, p_currency text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  pay public.dl_payments;
  sub public.dl_subscriptions;
  start_at timestamptz;
begin
  select * into pay from public.dl_payments where reference = p_reference for update;
  if not found then return 'referencia_desconocida'; end if;
  if pay.applied_at is not null then return 'ya_aplicado'; end if;
  if p_status = 'APPROVED' and (p_amount_in_cents <> pay.amount_in_cents or p_currency <> pay.currency) then
    update public.dl_payments set status = 'ERROR', wompi_transaction_id = p_transaction_id, updated_at = now() where reference = p_reference;
    return 'monto_no_coincide';
  end if;
  update public.dl_payments
     set status = case when p_status in ('APPROVED', 'DECLINED', 'VOIDED', 'ERROR') then p_status else status end,
         wompi_transaction_id = p_transaction_id, updated_at = now()
   where reference = p_reference;
  if p_status <> 'APPROVED' then return 'estado_' || lower(p_status); end if;

  select * into sub from public.dl_subscriptions where user_id = pay.user_id for update;
  if found and sub.period_end > now() then
    update public.dl_subscriptions set period_end = sub.period_end + interval '30 days', plan_id = pay.plan_id, updated_at = now() where user_id = pay.user_id;
  else
    start_at := now();
    insert into public.dl_subscriptions (user_id, plan_id, period_start, period_end)
    values (pay.user_id, pay.plan_id, start_at, start_at + interval '30 days')
    on conflict (user_id) do update set plan_id = excluded.plan_id, period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
  end if;
  update public.dl_payments set applied_at = now() where reference = p_reference;
  return 'aplicado';
end $$;

-- Activación manual (pagos hechos por otro medio): solo el administrador de la plataforma.
create function public.dl_admin_activate_plan(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; ref text; amount bigint;
begin
  if not private.dl_is_admin() then raise exception 'no autorizado'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then return 'usuario_no_encontrado'; end if;
  select price_cop::bigint * 100 into amount from public.dl_plans where id = 'pro';
  ref := 'DL-MANUAL-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.dl_payments (reference, user_id, plan_id, amount_in_cents) values (ref, uid, 'pro', amount);
  return public.dl_apply_payment(ref, 'manual', 'APPROVED', amount, 'COP');
end $$;

-- ───────────────────────── Permisos de ejecución ─────────────────────────
revoke all on function public.dl_account_status(), public.dl_accept_terms(text), public.dl_create_project(text, jsonb),
  public.dl_save_project(uuid, text, jsonb, int, boolean, int, int), public.dl_delete_project(uuid), public.dl_get_project(uuid),
  public.dl_list_projects(), public.dl_list_members(uuid), public.dl_share(uuid, text, text), public.dl_unshare(uuid, text),
  public.dl_request_edit(uuid), public.dl_dismiss_request(uuid, text), public.dl_create_payment(text), public.dl_admin_activate_plan(text)
  from public, anon;
grant execute on function public.dl_account_status(), public.dl_accept_terms(text), public.dl_create_project(text, jsonb),
  public.dl_save_project(uuid, text, jsonb, int, boolean, int, int), public.dl_delete_project(uuid), public.dl_get_project(uuid),
  public.dl_list_projects(), public.dl_list_members(uuid), public.dl_share(uuid, text, text), public.dl_unshare(uuid, text),
  public.dl_request_edit(uuid), public.dl_dismiss_request(uuid, text), public.dl_create_payment(text), public.dl_admin_activate_plan(text)
  to authenticated;
revoke all on function public.dl_apply_payment(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.dl_apply_payment(text, text, text, bigint, text) to service_role;
