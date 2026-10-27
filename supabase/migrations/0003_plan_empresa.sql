-- DataLite · plan Empresa: espacio de equipo de 5 a 20 usuarios con pago anual.
-- Cada persona con cupo tiene todo lo de Pro. Los tableros guardados en el espacio de la empresa los ven y editan
-- todos sus miembros, sin invitarlos uno por uno. Quien solo mira tableros compartidos sigue sin pagar.
-- Precio por usuario y año: 16.900 × 12 de 5 a 9 usuarios y 14.900 × 12 de 10 a 20. Requiere 0001 y 0002.

-- ───────────────────────── Catálogo y precios ─────────────────────────
insert into public.dl_plans (id, name, price_cop, max_projects, max_members, max_data_mb, sort)
values ('empresa', 'DataLite Empresa', 16900, 50, 10, 25, 2)
on conflict (id) do nothing;

create function private.dl_seat_month_price(p_seats int) returns int
language sql immutable set search_path = '' as $$
  select case when p_seats between 5 and 9 then 16900 when p_seats between 10 and 20 then 14900 end;
$$;
create function private.dl_org_days() returns int language sql immutable set search_path = '' as $$ select 365 $$;
revoke all on function private.dl_seat_month_price(int), private.dl_org_days() from public, anon;
grant execute on function private.dl_seat_month_price(int), private.dl_org_days() to authenticated;

-- ───────────────────────── Empresas y miembros ─────────────────────────
create table public.dl_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  owner_id uuid not null references auth.users (id) on delete restrict,
  seats int not null check (seats between 5 and 20),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index dl_orgs_owner_idx on public.dl_orgs (owner_id);

-- Se invita por correo: la persona puede no tener cuenta todavía. Cada correo pertenece a una sola empresa.
create table public.dl_org_members (
  org_id uuid not null references public.dl_orgs (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('admin', 'member')),
  invited_at timestamptz not null default now(),
  primary key (org_id, email)
);
create unique index dl_org_members_email_idx on public.dl_org_members (email);

alter table public.dl_projects add column org_id uuid references public.dl_orgs (id) on delete set null;
create index dl_projects_org_idx on public.dl_projects (org_id) where org_id is not null;

alter table public.dl_payments add column purpose text not null default 'pro'
  check (purpose in ('pro', 'org_new', 'org_renew', 'org_seats'));
alter table public.dl_payments add column seats int check (seats between 5 and 20);
alter table public.dl_payments add column org_name text check (char_length(btrim(org_name)) between 2 and 120);

-- ───────────────────────── Ayudas ─────────────────────────
-- Empresa de quien consulta (activa o vencida) y su rol en ella
create function private.dl_my_org() returns public.dl_orgs
language sql stable security definer set search_path = '' as $$
  select o.* from public.dl_org_members m join public.dl_orgs o on o.id = m.org_id where m.email = private.dl_email();
$$;
create function private.dl_my_org_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.dl_org_members m where m.email = private.dl_email();
$$;
revoke all on function private.dl_my_org(), private.dl_my_org_role() from public, anon;
grant execute on function private.dl_my_org(), private.dl_my_org_role() to authenticated;

-- Pro también si la persona tiene cupo en una empresa vigente
create or replace function private.dl_is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dl_subscriptions s where s.user_id = p_user and s.period_end > now())
      or exists (select 1 from auth.users u join private.dl_admins a on a.email = lower(u.email)
                 where u.id = p_user and u.email_confirmed_at is not null)
      or exists (select 1 from auth.users u join public.dl_org_members m on m.email = lower(u.email)
                   join public.dl_orgs o on o.id = m.org_id
                 where u.id = p_user and u.email_confirmed_at is not null and o.period_end > now());
$$;

-- Rol en un proyecto: dueño; miembro de la empresa del proyecto (edita); o invitado individual
create or replace function private.dl_role(p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p.owner_id = (select auth.uid()) then 'owner'
              when p.org_id is not null and exists (select 1 from public.dl_org_members om
                                                      where om.org_id = p.org_id and om.email = private.dl_email()) then 'editor'
              else (select m.role from public.dl_project_members m where m.project_id = p.id and m.email = private.dl_email()) end
    from public.dl_projects p where p.id = p_project;
$$;

-- Quien tiene o tuvo cupo de empresa no recibe la prueba individual
create or replace function private.dl_trial_available(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.dl_trials t where t.user_id = p_user)
     and not exists (select 1 from public.dl_subscriptions s where s.user_id = p_user)
     and not exists (select 1 from public.dl_payments p where p.user_id = p_user and p.applied_at is not null)
     and not exists (select 1 from auth.users u join public.dl_org_members m on m.email = lower(u.email) where u.id = p_user);
$$;

-- Lectura: los miembros ven su empresa y la lista de miembros; las escrituras van por funciones
alter table public.dl_orgs enable row level security;
revoke all on public.dl_orgs from anon, authenticated;
grant select on public.dl_orgs to authenticated;
create policy "dl empresa: sus miembros leen" on public.dl_orgs for select to authenticated
  using (exists (select 1 from public.dl_org_members m where m.org_id = dl_orgs.id and m.email = private.dl_email()));

alter table public.dl_org_members enable row level security;
revoke all on public.dl_org_members from anon, authenticated;
grant select on public.dl_org_members to authenticated;
create policy "dl miembros de empresa: la misma empresa lee" on public.dl_org_members for select to authenticated
  using (org_id = (select o.id from private.dl_my_org() o));

-- ───────────────────────── Funciones para la app ─────────────────────────
create function public.dl_org_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when o.id is null then null else jsonb_build_object(
    'id', o.id, 'name', o.name, 'role', private.dl_my_org_role(), 'seats', o.seats,
    'used', (select count(*) from public.dl_org_members m where m.org_id = o.id),
    'period_end', o.period_end, 'active', o.period_end > now(),
    'owner_email', (select lower(u.email) from auth.users u where u.id = o.owner_id),
    'month_price', private.dl_seat_month_price(o.seats),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role,
                   'has_account', exists (select 1 from auth.users u where lower(u.email) = m.email)) order by m.role, m.invited_at), '[]'::jsonb)
                  from public.dl_org_members m where m.org_id = o.id)
  ) end
  from (select (private.dl_my_org()).*) o;
$$;

create function public.dl_org_invite(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  org public.dl_orgs := private.dl_my_org();
  em text := lower(btrim(coalesce(p_email, '')));
begin
  if (select auth.uid()) is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if org.id is null or private.dl_my_org_role() <> 'admin' then raise exception 'Solo el administrador de la empresa puede invitar.' using errcode = 'P0001'; end if;
  if org.period_end <= now() then raise exception 'El plan Empresa venció. Renuévalo para invitar personas.' using errcode = 'P0001', hint = 'pro'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'Escribe un correo válido.' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('dl_org:' || org.id::text));
  if exists (select 1 from public.dl_org_members where email = em) then
    raise exception 'Ese correo ya pertenece a una empresa en DataLite.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.dl_org_members where org_id = org.id) >= org.seats then
    raise exception 'Usaste los % cupos del plan. Agrega cupos para invitar a más personas.', org.seats using errcode = 'P0001', hint = 'limit';
  end if;
  insert into public.dl_org_members (org_id, email, role) values (org.id, em, 'member');
end $$;

-- El administrador quita a cualquiera menos al dueño; un miembro puede salirse.
create function public.dl_org_remove(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  org public.dl_orgs := private.dl_my_org();
  em text := lower(btrim(coalesce(p_email, '')));
  owner_email text;
begin
  if org.id is null then raise exception 'No perteneces a ninguna empresa.' using errcode = 'P0001'; end if;
  select lower(u.email) into owner_email from auth.users u where u.id = org.owner_id;
  if em = owner_email then raise exception 'El dueño del plan no se puede quitar.' using errcode = 'P0001'; end if;
  if private.dl_my_org_role() <> 'admin' and em <> private.dl_email() then
    raise exception 'Solo el administrador puede quitar personas.' using errcode = 'P0001';
  end if;
  delete from public.dl_org_members where org_id = org.id and email = em;
end $$;

create function public.dl_org_rename(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare org public.dl_orgs := private.dl_my_org();
begin
  if org.id is null or private.dl_my_org_role() <> 'admin' then raise exception 'Solo el administrador puede cambiar el nombre.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 120 then raise exception 'Escribe un nombre de 2 a 120 caracteres.' using errcode = 'P0001'; end if;
  update public.dl_orgs set name = btrim(p_name) where id = org.id;
end $$;

-- Mover un proyecto propio al espacio de la empresa (o sacarlo)
create function public.dl_set_project_org(p_id uuid, p_in_org boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare org public.dl_orgs := private.dl_my_org();
begin
  if private.dl_role(p_id) is distinct from 'owner' then raise exception 'Solo el dueño puede mover el proyecto.' using errcode = 'P0001'; end if;
  if p_in_org and (org.id is null or org.period_end <= now()) then
    raise exception 'Necesitas un plan Empresa vigente para guardar en el espacio del equipo.' using errcode = 'P0001', hint = 'pro';
  end if;
  update public.dl_projects set org_id = case when p_in_org then org.id end where id = p_id;
end $$;

-- Lista de proyectos: propios, compartidos conmigo y los del espacio de mi empresa
create or replace function public.dl_list_projects() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'role', private.dl_role(p.id), 'updated_at', p.updated_at, 'row_count', p.row_count,
      'owner_email', (select lower(u.email) from auth.users u where u.id = p.owner_id),
      'org', p.org_id is not null,
      'members', case when p.owner_id = (select auth.uid()) then (select count(*) from public.dl_project_members m where m.project_id = p.id) end,
      'requests', case when p.owner_id = (select auth.uid()) then (select count(*) from public.dl_project_members m where m.project_id = p.id and m.role = 'viewer' and m.edit_requested_at is not null) end
    ) as x
    from public.dl_projects p
    where p.owner_id = (select auth.uid())
       or exists (select 1 from public.dl_project_members m where m.project_id = p.id and m.email = private.dl_email())
       or (p.org_id is not null and p.org_id = (select o.id from private.dl_my_org() o))
    limit 300
  ) t;
$$;

-- Pagos: Pro como antes; Empresa nueva, renovación anual o más cupos (prorrateados por los días que faltan)
drop function public.dl_create_payment(text);
create function public.dl_create_payment(p_plan text, p_seats int default null, p_org_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pl public.dl_plans;
  org public.dl_orgs;
  ref text;
  purpose text := 'pro';
  amount bigint;
  used int;
begin
  if uid is null then raise exception 'no autenticado'; end if;
  if not exists (select 1 from public.dl_consents where user_id = uid) then raise exception 'Acepta la política de privacidad de DataLite para continuar.' using hint = 'consent'; end if;
  select * into pl from public.dl_plans where id = p_plan and active;
  if not found then raise exception 'plan no válido'; end if;
  if (select count(*) from public.dl_payments where user_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'demasiados intentos de pago';
  end if;

  if pl.id = 'pro' then
    amount := pl.price_cop::bigint * 100;
  else
    if p_seats is null or p_seats not between 5 and 20 then raise exception 'El plan Empresa es de 5 a 20 usuarios.' using errcode = 'P0001'; end if;
    org := private.dl_my_org();
    if org.id is null then
      if char_length(btrim(coalesce(p_org_name, ''))) not between 2 and 120 then raise exception 'Escribe el nombre de la empresa.' using errcode = 'P0001'; end if;
      purpose := 'org_new';
      amount := p_seats::bigint * private.dl_seat_month_price(p_seats) * 12 * 100;
    else
      if private.dl_my_org_role() <> 'admin' or org.owner_id <> uid then
        raise exception 'Solo el dueño del plan Empresa puede pagarlo.' using errcode = 'P0001';
      end if;
      used := (select count(*) from public.dl_org_members where org_id = org.id);
      if p_seats < used then raise exception 'Tienes % personas en el plan; quita algunas o elige al menos % cupos.', used, used using errcode = 'P0001'; end if;
      if org.period_end > now() and p_seats > org.seats and org.period_end - now() > interval '30 days' then
        -- Más cupos a mitad del año: solo los nuevos, por los días que faltan (redondeado a la centena)
        purpose := 'org_seats';
        amount := (round((p_seats - org.seats)::numeric * private.dl_seat_month_price(p_seats) * 12
                   * extract(epoch from org.period_end - now()) / extract(epoch from interval '365 days') / 100) * 100)::bigint * 100;
      else
        purpose := 'org_renew';
        amount := p_seats::bigint * private.dl_seat_month_price(p_seats) * 12 * 100;
      end if;
    end if;
  end if;

  ref := 'DL-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.dl_payments (reference, user_id, plan_id, amount_in_cents, purpose, seats, org_name)
  values (ref, uid, pl.id, amount, purpose, case when pl.id = 'empresa' then p_seats end,
          case when purpose = 'org_new' then btrim(p_org_name) end);
  return jsonb_build_object('reference', ref, 'amount_in_cents', amount, 'currency', 'COP', 'plan', pl.id, 'purpose', purpose, 'seats', p_seats);
end $$;

-- Aplicar pagos (solo el servidor, tras verificar con Wompi). Idempotente.
create or replace function public.dl_apply_payment(
  p_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint, p_currency text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  pay public.dl_payments;
  sub public.dl_subscriptions;
  org public.dl_orgs;
  owner_email text;
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

  if pay.plan_id = 'pro' then
    select * into sub from public.dl_subscriptions where user_id = pay.user_id for update;
    if found and sub.period_end > now() then
      update public.dl_subscriptions set period_end = sub.period_end + interval '30 days', plan_id = pay.plan_id, updated_at = now() where user_id = pay.user_id;
    else
      start_at := now();
      insert into public.dl_subscriptions (user_id, plan_id, period_start, period_end)
      values (pay.user_id, pay.plan_id, start_at, start_at + interval '30 days')
      on conflict (user_id) do update set plan_id = excluded.plan_id, period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
    end if;
  else
    select * into org from public.dl_orgs where owner_id = pay.user_id for update;
    if not found then
      select lower(u.email) into owner_email from auth.users u where u.id = pay.user_id;
      if exists (select 1 from public.dl_org_members where email = owner_email) then
        -- Pagó mientras otra empresa lo invitaba: el pago queda registrado y se resuelve a mano
        update public.dl_payments set applied_at = now() where reference = p_reference;
        return 'revisar_correo_en_otra_empresa';
      end if;
      insert into public.dl_orgs (name, owner_id, seats, period_start, period_end)
      values (coalesce(pay.org_name, 'Mi empresa'), pay.user_id, pay.seats, now(), now() + make_interval(days => private.dl_org_days()))
      returning * into org;
      insert into public.dl_org_members (org_id, email, role) values (org.id, owner_email, 'admin');
    elsif pay.purpose = 'org_seats' then
      update public.dl_orgs set seats = greatest(seats, pay.seats) where id = org.id;
    else
      update public.dl_orgs
         set seats = pay.seats,
             period_end = greatest(period_end, now()) + make_interval(days => private.dl_org_days())
       where id = org.id;
    end if;
  end if;
  update public.dl_payments set applied_at = now() where reference = p_reference;
  return 'aplicado';
end $$;

-- Estado de la cuenta: igual que en 0002, más la empresa
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
    'org', (select jsonb_build_object('id', o.id, 'name', o.name, 'role', private.dl_my_org_role(),
                                      'period_end', o.period_end, 'active', o.period_end > now())
              from private.dl_my_org() o where o.id is not null)
  );
$$;

revoke all on function public.dl_org_status(), public.dl_org_invite(text), public.dl_org_remove(text), public.dl_org_rename(text),
  public.dl_set_project_org(uuid, boolean), public.dl_create_payment(text, int, text) from public, anon;
grant execute on function public.dl_org_status(), public.dl_org_invite(text), public.dl_org_remove(text), public.dl_org_rename(text),
  public.dl_set_project_org(uuid, boolean), public.dl_create_payment(text, int, text) to authenticated;
