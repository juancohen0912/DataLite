-- DataLite · acceso gratis con cuenta (opción A) y prueba de Pro por 14 días (opción C).
-- Analizar sigue sin cuenta. Descargar exige cuenta: el plan gratis tiene 3 descargas por mes calendario
-- (hora de Colombia); Pro, la prueba y los administradores no tienen límite. Cada cuenta puede activar una
-- sola prueba de 14 días. Requiere 0001_datalite.sql.

-- ───────────────────────── Parámetros ─────────────────────────
create function private.dl_free_exports() returns int language sql immutable set search_path = '' as $$ select 3 $$;
create function private.dl_trial_days() returns int language sql immutable set search_path = '' as $$ select 14 $$;
-- Inicio del mes en curso en hora de Colombia
create function private.dl_month_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
$$;
revoke all on function private.dl_free_exports(), private.dl_trial_days(), private.dl_month_start() from public, anon;
grant execute on function private.dl_free_exports(), private.dl_trial_days(), private.dl_month_start() to authenticated;

-- ───────────────────────── Registro de descargas ─────────────────────────
-- Solo el tipo y la fecha: nunca el contenido ni el nombre del archivo.
create table public.dl_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pptx', 'xlsx', 'pdf', 'png')),
  created_at timestamptz not null default now()
);
create index dl_exports_user_idx on public.dl_exports (user_id, created_at desc);
alter table public.dl_exports enable row level security;
revoke all on public.dl_exports from anon, authenticated;
grant select on public.dl_exports to authenticated;
create policy "dl descargas propias: leer" on public.dl_exports for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────── Pruebas de Pro ─────────────────────────
create table public.dl_trials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null
);
alter table public.dl_trials enable row level security;
revoke all on public.dl_trials from anon, authenticated;
grant select on public.dl_trials to authenticated;
create policy "dl prueba propia: leer" on public.dl_trials for select to authenticated using (user_id = (select auth.uid()));

-- La prueba se ofrece a quien nunca tuvo Pro (ni prueba, ni pago aplicado, ni plan activado a mano).
create function private.dl_trial_available(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.dl_trials t where t.user_id = p_user)
     and not exists (select 1 from public.dl_subscriptions s where s.user_id = p_user)
     and not exists (select 1 from public.dl_payments p where p.user_id = p_user and p.applied_at is not null);
$$;
revoke all on function private.dl_trial_available(uuid) from public, anon;
grant execute on function private.dl_trial_available(uuid) to authenticated;

-- ───────────────────────── Funciones para la app ─────────────────────────
-- Registra una descarga y dice si se permite. Las descargas se generan en el navegador; este conteo es el
-- límite del plan gratis, no una barrera criptográfica.
create function public.dl_use_export(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pro boolean;
  used int;
  lim int := private.dl_free_exports();
begin
  if uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if p_kind is null or p_kind not in ('pptx', 'xlsx', 'pdf', 'png') then raise exception 'tipo de descarga no válido'; end if;
  if not exists (select 1 from public.dl_consents where user_id = uid) then
    raise exception 'Acepta la política de privacidad de DataLite para continuar.' using errcode = 'P0001', hint = 'consent';
  end if;
  -- Una sola transacción por cuenta a la vez: dos clics simultáneos no se saltan el límite
  perform pg_advisory_xact_lock(hashtext('dl_exports:' || uid::text));
  if (select count(*) from public.dl_exports where user_id = uid and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Hiciste demasiadas descargas seguidas. Espera unos minutos.' using errcode = 'P0001', hint = 'rate';
  end if;
  pro := private.dl_is_pro(uid);
  used := (select count(*) from public.dl_exports where user_id = uid and created_at >= private.dl_month_start());
  if not pro and used >= lim then
    return jsonb_build_object('allowed', false, 'pro', false, 'used', used, 'limit', lim,
                              'trial_available', private.dl_trial_available(uid));
  end if;
  insert into public.dl_exports (user_id, kind) values (uid, p_kind);
  return jsonb_build_object('allowed', true, 'pro', pro, 'used', used + 1, 'limit', lim);
end $$;

-- Activa la prueba de Pro (una por cuenta)
create function public.dl_start_trial() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ends timestamptz := now() + make_interval(days => private.dl_trial_days());
begin
  if uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if not exists (select 1 from public.dl_consents where user_id = uid) then
    raise exception 'Acepta la política de privacidad de DataLite para continuar.' using errcode = 'P0001', hint = 'consent';
  end if;
  perform pg_advisory_xact_lock(hashtext('dl_trial:' || uid::text));
  if not private.dl_trial_available(uid) then
    raise exception 'La prueba gratis es una por cuenta y ya la usaste.' using errcode = 'P0001', hint = 'trial_used';
  end if;
  insert into public.dl_trials (user_id, ends_at) values (uid, ends);
  insert into public.dl_subscriptions (user_id, plan_id, period_start, period_end) values (uid, 'pro', now(), ends);
  return jsonb_build_object('ends_at', ends);
end $$;

-- Estado de la cuenta: igual que antes, más descargas del mes y prueba
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
      -- Prueba en curso y sin pagos aplicados después
      'active', exists (select 1 from public.dl_trials t join public.dl_subscriptions s on s.user_id = t.user_id
                         where t.user_id = (select auth.uid()) and s.period_end > now() and s.period_end = t.ends_at),
      'ends_at', (select t.ends_at from public.dl_trials t where t.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.dl_use_export(text), public.dl_start_trial() from public, anon;
grant execute on function public.dl_use_export(text), public.dl_start_trial() to authenticated;
