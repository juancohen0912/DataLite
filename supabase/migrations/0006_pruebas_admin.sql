-- DataLite · pruebas gratis asignadas por el administrador (Pro o Empresa), con prórroga y recorte.
-- Seguridad: todas las funciones verifican private.dl_is_admin() (correo confirmado en private.dl_admins) dentro de la base;
-- el navegador no puede escribir las tablas. Cada acción queda en un registro de auditoría. Requiere 0001–0005.

-- ───────────────────────── Tablas ─────────────────────────
create table private.dl_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  kind text not null check (kind in ('pro', 'empresa')),
  org_id uuid references public.dl_orgs (id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  note text check (char_length(note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at <= starts_at + interval '366 days')
);
create index dl_grants_user_idx on private.dl_grants (user_id, ends_at desc);
alter table private.dl_grants enable row level security;
revoke all on private.dl_grants from public, anon, authenticated;

create table private.dl_admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_email text not null,
  action text not null,
  grant_id uuid,
  target_email text,
  detail jsonb
);
alter table private.dl_admin_audit enable row level security;
revoke all on private.dl_admin_audit from public, anon, authenticated;

-- ───────────────────────── Ayudas ─────────────────────────
create function private.dl_require_admin() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.dl_is_admin() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return private.dl_email();
end $$;

create function private.dl_audit(p_action text, p_grant uuid, p_email text, p_detail jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.dl_admin_audit (admin_email, action, grant_id, target_email, detail)
  values (coalesce(private.dl_email(), 'desconocido'), p_action, p_grant, p_email, p_detail);
$$;

-- Prueba Pro vigente otorgada por el administrador
create function private.dl_grant_active(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.dl_grants g where g.user_id = p_user and g.kind = 'pro' and g.ends_at > now() and g.starts_at <= now());
$$;

revoke all on function private.dl_require_admin(), private.dl_audit(text, uuid, text, jsonb), private.dl_grant_active(uuid) from public, anon;
grant execute on function private.dl_require_admin(), private.dl_grant_active(uuid) to authenticated;

-- Pro: suscripción pagada, administrador, cupo de empresa vigente o prueba asignada vigente
create or replace function private.dl_is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dl_subscriptions s where s.user_id = p_user and s.period_end > now())
      or private.dl_grant_active(p_user)
      or exists (select 1 from auth.users u join private.dl_admins a on a.email = lower(u.email)
                 where u.id = p_user and u.email_confirmed_at is not null)
      or exists (select 1 from auth.users u join public.dl_org_members m on m.email = lower(u.email)
                   join public.dl_orgs o on o.id = m.org_id
                 where u.id = p_user and u.email_confirmed_at is not null and o.period_end > now());
$$;

-- Quien recibió una prueba asignada no toma además la prueba automática
create or replace function private.dl_trial_available(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.dl_trials t where t.user_id = p_user)
     and not exists (select 1 from private.dl_grants g where g.user_id = p_user)
     and not exists (select 1 from public.dl_subscriptions s where s.user_id = p_user)
     and not exists (select 1 from public.dl_payments p where p.user_id = p_user and p.applied_at is not null)
     and not exists (select 1 from auth.users u join public.dl_org_members m on m.email = lower(u.email) where u.id = p_user);
$$;

-- ───────────────────────── Funciones del administrador ─────────────────────────
-- Asigna una prueba de 15 a 30 días. Empresa: crea el espacio de equipo con la persona como administradora.
create function public.dl_admin_grant(p_email text, p_kind text, p_days int, p_seats int default 5, p_org_name text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  adm text := private.dl_require_admin();
  em text := lower(btrim(coalesce(p_email, '')));
  uid uuid;
  gid uuid;
  oid uuid;
  ends timestamptz;
begin
  if p_kind not in ('pro', 'empresa') then raise exception 'Tipo de prueba no válido.' using errcode = 'P0001'; end if;
  if p_days is null or p_days not between 15 and 30 then raise exception 'La prueba inicial debe ser de 15 a 30 días.' using errcode = 'P0001'; end if;
  select u.id into uid from auth.users u where lower(u.email) = em and u.email_confirmed_at is not null;
  if uid is null then
    raise exception 'No hay una cuenta confirmada con ese correo. Pídele que inicie sesión una vez en DataLite.' using errcode = 'P0001', hint = 'notfound';
  end if;
  perform pg_advisory_xact_lock(hashtext('dl_grant:' || uid::text));
  if exists (select 1 from private.dl_grants g where g.user_id = uid and g.kind = p_kind and g.ends_at > now()) then
    raise exception 'Esa persona ya tiene una prueba vigente de este tipo. Usa «Prorrogar».' using errcode = 'P0001';
  end if;
  ends := now() + make_interval(days => p_days);

  if p_kind = 'empresa' then
    if p_seats is null or p_seats not between 5 and 20 then raise exception 'Los cupos de empresa van de 5 a 20.' using errcode = 'P0001'; end if;
    if char_length(btrim(coalesce(p_org_name, ''))) not between 2 and 120 then raise exception 'Escribe el nombre de la empresa.' using errcode = 'P0001'; end if;
    if exists (select 1 from public.dl_orgs o where o.owner_id = uid) or exists (select 1 from public.dl_org_members m where m.email = em) then
      raise exception 'Esa persona ya pertenece a una empresa en DataLite.' using errcode = 'P0001';
    end if;
    insert into public.dl_orgs (name, owner_id, seats, period_start, period_end)
    values (btrim(p_org_name), uid, p_seats, now(), ends) returning id into oid;
    insert into public.dl_org_members (org_id, email, role) values (oid, em, 'admin');
  end if;

  insert into private.dl_grants (user_id, email, kind, org_id, ends_at, note, created_by)
  values (uid, em, p_kind, oid, ends, nullif(left(btrim(coalesce(p_note, '')), 300), ''), adm)
  returning id into gid;
  perform private.dl_audit('asignar', gid, em, jsonb_build_object('tipo', p_kind, 'dias', p_days, 'cupos', case when p_kind = 'empresa' then p_seats end));
  return jsonb_build_object('id', gid, 'ends_at', ends);
end $$;

-- Prorroga (días > 0) o recorta (días < 0). Si el recorte llega a hoy o antes, la prueba termina ya.
create function public.dl_admin_adjust_grant(p_id uuid, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  adm text := private.dl_require_admin();
  g private.dl_grants;
  ends timestamptz;
begin
  if p_days is null or p_days = 0 or p_days not between -366 and 366 then raise exception 'Indica un número de días entre -366 y 366.' using errcode = 'P0001'; end if;
  select * into g from private.dl_grants where id = p_id for update;
  if g.id is null then raise exception 'No encontramos esa prueba.' using errcode = 'P0001'; end if;
  if g.kind = 'empresa' and (g.org_id is null or exists (
       select 1 from public.dl_payments p where p.user_id = g.user_id and p.purpose like 'org_%' and p.applied_at > g.created_at)) then
    raise exception 'Esta empresa ya pagó o fue eliminada: su plan ya no se maneja como prueba.' using errcode = 'P0001';
  end if;
  -- Al prorrogar una prueba vencida, los días cuentan desde hoy
  ends := case when p_days > 0 then greatest(g.ends_at, now()) else g.ends_at end + make_interval(days => p_days);
  if ends <= now() then ends := now(); end if;
  if ends > g.starts_at + interval '366 days' then raise exception 'Una prueba no puede durar más de un año en total.' using errcode = 'P0001'; end if;
  update private.dl_grants set ends_at = ends, updated_at = now() where id = g.id;
  if g.kind = 'empresa' then update public.dl_orgs set period_end = ends where id = g.org_id; end if;
  perform private.dl_audit(case when p_days > 0 then 'prorrogar' else 'recortar' end, g.id, g.email, jsonb_build_object('dias', p_days, 'nuevo_fin', ends));
  return jsonb_build_object('id', g.id, 'ends_at', ends);
end $$;

-- Termina la prueba de inmediato
create function public.dl_admin_end_grant(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare adm text := private.dl_require_admin(); g private.dl_grants;
begin
  select * into g from private.dl_grants where id = p_id for update;
  if g.id is null then raise exception 'No encontramos esa prueba.' using errcode = 'P0001'; end if;
  if g.ends_at <= now() then return; end if;
  if g.kind = 'empresa' and g.org_id is not null and not exists (
       select 1 from public.dl_payments p where p.user_id = g.user_id and p.purpose like 'org_%' and p.applied_at > g.created_at) then
    update public.dl_orgs set period_end = now() where id = g.org_id;
  end if;
  update private.dl_grants set ends_at = now(), updated_at = now() where id = g.id;
  perform private.dl_audit('terminar', g.id, g.email, null);
end $$;

-- Lista de pruebas asignadas (las más recientes primero)
create function public.dl_admin_list_grants() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare adm text := private.dl_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'email', g.email, 'kind', g.kind, 'starts_at', g.starts_at, 'ends_at', g.ends_at, 'active', g.ends_at > now(),
      'note', g.note, 'created_by', g.created_by,
      'org', case when g.org_id is not null then (select jsonb_build_object('name', o.name, 'seats', o.seats,
               'used', (select count(*) from public.dl_org_members m where m.org_id = o.id)) from public.dl_orgs o where o.id = g.org_id) end,
      'paid', exists (select 1 from public.dl_payments p where p.user_id = g.user_id and p.applied_at > g.created_at))
    order by g.created_at desc)
    from (select * from private.dl_grants order by created_at desc limit 200) g), '[]'::jsonb);
end $$;

revoke all on function public.dl_admin_grant(text, text, int, int, text, text), public.dl_admin_adjust_grant(uuid, int),
  public.dl_admin_end_grant(uuid), public.dl_admin_list_grants() from public, anon;
grant execute on function public.dl_admin_grant(text, text, int, int, text, text), public.dl_admin_adjust_grant(uuid, int),
  public.dl_admin_end_grant(uuid), public.dl_admin_list_grants() to authenticated;

-- Estado de la cuenta: igual que en 0003, más la prueba asignada vigente
create or replace function public.dl_account_status() returns jsonb
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
                          where p.owner_id = (select auth.uid()) and m.role = 'viewer' and m.edit_requested_at is not null),
    'exports', jsonb_build_object(
      'used', (select count(*) from public.dl_exports e where e.user_id = (select auth.uid()) and e.created_at >= private.dl_month_start()),
      'limit', private.dl_free_exports()),
    'trial', jsonb_build_object(
      'available', private.dl_trial_available((select auth.uid())),
      'days', private.dl_trial_days(),
      'active', exists (select 1 from public.dl_trials t join public.dl_subscriptions s on s.user_id = t.user_id
                         where t.user_id = (select auth.uid()) and s.period_end > now() and s.period_end = t.ends_at),
      'ends_at', (select t.ends_at from public.dl_trials t where t.user_id = (select auth.uid()))),
    'grant', (select jsonb_build_object('kind', g.kind, 'ends_at', g.ends_at) from private.dl_grants g
               where g.user_id = (select auth.uid()) and g.ends_at > now() order by g.ends_at desc limit 1),
    'org', (select jsonb_build_object('id', o.id, 'name', o.name, 'role', private.dl_my_org_role(),
                                      'period_end', o.period_end, 'active', o.period_end > now())
              from private.dl_my_org() o where o.id is not null)
  );
$$;
