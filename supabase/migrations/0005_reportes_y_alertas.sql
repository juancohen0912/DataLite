-- DataLite 0005: acceso permanente a hojas conectadas, reportes programados y alertas.
-- Los permisos de Google/Microsoft llegan ya cifrados (AES-256-GCM) desde el servidor de Vercel:
-- la base nunca ve el token en claro y el navegador nunca recibe el texto cifrado.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ------------------------------------------------------------ Conexiones permanentes (solo servidor)
create table private.dl_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account text,
  token_enc text not null check (char_length(token_enc) < 8000),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table private.dl_connections enable row level security;
revoke all on private.dl_connections from public, anon, authenticated;

-- ------------------------------------------------------------ Programaciones (reportes y alertas)
create table public.dl_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dl_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('report', 'alert')),
  name text not null check (char_length(name) between 1 and 120),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday smallint check (weekday between 1 and 7),
  monthday smallint check (monthday between 1 and 28),
  hour smallint not null default 7 check (hour between 0 and 23),
  recipients text[] not null check (cardinality(recipients) between 1 and 10),
  channels text[] not null default '{email}' check (channels <@ array['email', 'whatsapp']),
  whatsapp text[] not null default '{}' check (cardinality(whatsapp) <= 5),
  rule jsonb check (rule is null or pg_column_size(rule) < 4000),
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_value numeric,
  last_triggered boolean not null default false,
  last_test_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'report' or rule is not null),
  check (frequency <> 'weekly' or weekday is not null),
  check (frequency <> 'monthly' or monthday is not null)
);
create index dl_schedules_due_idx on public.dl_schedules (next_run_at) where active;
create index dl_schedules_project_idx on public.dl_schedules (project_id);
create index dl_schedules_owner_idx on public.dl_schedules (owner_id);
alter table public.dl_schedules enable row level security;
revoke all on public.dl_schedules from public, anon, authenticated;

create table private.dl_schedule_runs (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.dl_schedules(id) on delete cascade,
  ran_at timestamptz not null default now(),
  status text not null,
  detail text
);
create index dl_schedule_runs_idx on private.dl_schedule_runs (schedule_id, ran_at desc);
alter table private.dl_schedule_runs enable row level security;
revoke all on private.dl_schedule_runs from public, anon, authenticated;

-- Bajas: schedule_id nulo = ningún reporte de DataLite a ese correo
create table private.dl_unsubscribes (
  email text not null,
  schedule_id uuid references public.dl_schedules(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index dl_unsubscribes_uq on private.dl_unsubscribes (email, coalesce(schedule_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table private.dl_unsubscribes enable row level security;
revoke all on private.dl_unsubscribes from public, anon, authenticated;

-- ------------------------------------------------------------ Próxima ejecución (hora de Colombia)
create function private.dl_next_run(p_freq text, p_weekday int, p_monthday int, p_hour int, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  loc timestamp := p_after at time zone 'America/Bogota';
  cand timestamp;
begin
  for i in 0..62 loop
    cand := (loc::date + i) + make_time(p_hour, 0, 0);
    continue when cand <= loc;
    if p_freq = 'daily'
       or (p_freq = 'weekly' and extract(isodow from cand) = p_weekday)
       or (p_freq = 'monthly' and extract(day from cand) = p_monthday) then
      return cand at time zone 'America/Bogota';
    end if;
  end loop;
  return null;
end $$;

-- ------------------------------------------------------------ Funciones para el dueño (con su sesión)
create function public.dl_connection_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.provider, jsonb_build_object('account', c.account, 'error', c.last_error, 'since', c.created_at)), '{}'::jsonb)
  from private.dl_connections c where c.user_id = (select auth.uid());
$$;

create function public.dl_disconnect(p_provider text) returns void
language sql security definer set search_path = '' as $$
  delete from private.dl_connections where user_id = (select auth.uid()) and provider = p_provider;
$$;

create function public.dl_list_schedules(p_project uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.dl_role(p_project) = 'owner' then coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'frequency', s.frequency, 'weekday', s.weekday,
      'monthday', s.monthday, 'hour', s.hour, 'recipients', s.recipients, 'channels', s.channels, 'rule', s.rule, 'active', s.active,
      'next_run_at', s.next_run_at, 'last_run_at', s.last_run_at, 'last_status', s.last_status, 'last_value', s.last_value) order by s.created_at)
    from public.dl_schedules s where s.project_id = p_project), '[]'::jsonb) end;
$$;

create function public.dl_save_schedule(
  p_id uuid, p_project uuid, p_kind text, p_name text, p_frequency text, p_weekday int, p_monthday int, p_hour int,
  p_recipients text[], p_rule jsonb, p_active boolean, p_channels text[] default '{email}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.dl_require_pro();
  rec text[];
  e text;
  sid uuid;
begin
  if private.dl_role(p_project) is distinct from 'owner' then raise exception 'Solo el dueño del proyecto puede programar reportes y alertas.'; end if;
  if not exists (select 1 from public.dl_projects p where p.id = p_project and p.state ? 'source' and jsonb_typeof(p.state->'source') = 'object') then
    raise exception 'Este proyecto no está conectado a Google Sheets ni a Excel en línea. Conéctalo, guarda y vuelve a intentarlo.' using hint = 'source';
  end if;
  if p_kind not in ('report', 'alert') then raise exception 'Tipo no válido.'; end if;
  if p_frequency not in ('daily', 'weekly', 'monthly') then raise exception 'Frecuencia no válida.'; end if;
  if p_hour is null or p_hour not between 0 and 23 then raise exception 'Hora no válida.'; end if;
  if p_frequency = 'weekly' and (p_weekday is null or p_weekday not between 1 and 7) then raise exception 'Elige el día de la semana.'; end if;
  if p_frequency = 'monthly' and (p_monthday is null or p_monthday not between 1 and 28) then raise exception 'Elige un día del mes entre 1 y 28.'; end if;
  if p_kind = 'alert' and (p_rule is null or jsonb_typeof(p_rule) <> 'object' or (p_rule->>'op') not in ('gt', 'lt') or (p_rule->>'threshold') is null) then
    raise exception 'Completa la condición de la alerta.';
  end if;
  if p_channels is null or not (p_channels <@ array['email', 'whatsapp']) or cardinality(p_channels) = 0 then raise exception 'Canal no válido.'; end if;
  -- Correos: minúsculas, sin repetidos, máximo 10
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into rec from unnest(coalesce(p_recipients, '{}')) x where btrim(x) <> '';
  if cardinality(rec) = 0 then raise exception 'Agrega al menos un correo.'; end if;
  if cardinality(rec) > 10 then raise exception 'Máximo 10 correos por programación.'; end if;
  foreach e in array rec loop
    if e !~ '^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[a-z]{2,}$' or char_length(e) > 254 then raise exception 'Correo no válido: %', e; end if;
  end loop;
  if p_id is null then
    if (select count(*) from public.dl_schedules where owner_id = uid) >= 10 then
      raise exception 'Puedes tener máximo 10 reportes y alertas. Borra uno para crear otro.' using hint = 'limit';
    end if;
    insert into public.dl_schedules (project_id, owner_id, kind, name, frequency, weekday, monthday, hour, recipients, channels, rule, active, next_run_at)
    values (p_project, uid, p_kind, left(btrim(p_name), 120), p_frequency, case when p_frequency = 'weekly' then p_weekday end,
            case when p_frequency = 'monthly' then p_monthday end, p_hour, rec, p_channels, case when p_kind = 'alert' then p_rule end, coalesce(p_active, true),
            private.dl_next_run(p_frequency, p_weekday, p_monthday, p_hour, now()))
    returning id into sid;
  else
    update public.dl_schedules set name = left(btrim(p_name), 120), frequency = p_frequency,
      weekday = case when p_frequency = 'weekly' then p_weekday end, monthday = case when p_frequency = 'monthly' then p_monthday end,
      hour = p_hour, recipients = rec, channels = p_channels, rule = case when kind = 'alert' then p_rule end, active = coalesce(p_active, active),
      next_run_at = private.dl_next_run(p_frequency, p_weekday, p_monthday, p_hour, now()), last_triggered = false
    where id = p_id and project_id = p_project and owner_id = uid
    returning id into sid;
    if sid is null then raise exception 'No encontramos esa programación.'; end if;
  end if;
  return sid;
end $$;

create function public.dl_delete_schedule(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.dl_schedules where id = p_id and owner_id = (select auth.uid());
$$;

revoke all on function public.dl_connection_status(), public.dl_disconnect(text), public.dl_list_schedules(uuid),
  public.dl_save_schedule(uuid, uuid, text, text, text, int, int, int, text[], jsonb, boolean, text[]), public.dl_delete_schedule(uuid) from public, anon;
grant execute on function public.dl_connection_status(), public.dl_disconnect(text), public.dl_list_schedules(uuid),
  public.dl_save_schedule(uuid, uuid, text, text, text, int, int, int, text[], jsonb, boolean, text[]), public.dl_delete_schedule(uuid) to authenticated;

-- ------------------------------------------------------------ Funciones del servidor (service_role)
create function public.dl_store_connection(p_user uuid, p_provider text, p_account text, p_token text) returns void
language sql security definer set search_path = '' as $$
  insert into private.dl_connections (user_id, provider, account, token_enc) values (p_user, p_provider, left(p_account, 254), p_token)
  on conflict (user_id, provider) do update set account = excluded.account, token_enc = excluded.token_enc, last_error = null, updated_at = now();
$$;

create function public.dl_update_connection(p_user uuid, p_provider text, p_token text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update private.dl_connections set token_enc = coalesce(p_token, token_enc), last_error = left(p_error, 300), updated_at = now()
  where user_id = p_user and provider = p_provider;
$$;

-- Datos que necesita el servidor para ejecutar una programación (sin exponer nada al navegador)
create function private.dl_schedule_payload(s public.dl_schedules) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'name', s.name, 'frequency', s.frequency, 'rule', s.rule, 'channels', s.channels, 'whatsapp', s.whatsapp,
    'last_triggered', s.last_triggered, 'last_status', s.last_status,
    'recipients', (select coalesce(jsonb_agg(r), '[]'::jsonb) from unnest(s.recipients) r
                   where not exists (select 1 from private.dl_unsubscribes u where u.email = r and (u.schedule_id is null or u.schedule_id = s.id))),
    'project', jsonb_build_object('id', p.id, 'name', p.name, 'state', p.state),
    'owner', jsonb_build_object('id', s.owner_id, 'email', (select lower(u.email) from auth.users u where u.id = s.owner_id), 'pro', private.dl_is_pro(s.owner_id)),
    'token', (select c.token_enc from private.dl_connections c where c.user_id = s.owner_id and c.provider = p.state->'source'->>'type'))
  from public.dl_projects p where p.id = s.project_id;
$$;

create function public.dl_claim_due_schedules(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; s public.dl_schedules;
begin
  for s in select * from public.dl_schedules where active and next_run_at <= now() order by next_run_at limit least(greatest(p_limit, 1), 50) for update skip locked loop
    update public.dl_schedules set next_run_at = private.dl_next_run(s.frequency, s.weekday, s.monthday, s.hour, now()), last_run_at = now() where id = s.id;
    out := out || jsonb_build_array(private.dl_schedule_payload(s));
  end loop;
  return out;
end $$;

-- «Enviar ahora» desde el tablero: el servidor ya validó la sesión; máximo una prueba cada 5 minutos
create function public.dl_claim_test(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.dl_schedules;
begin
  select * into s from public.dl_schedules where id = p_id and owner_id = p_user for update;
  if s.id is null then raise exception 'No encontramos esa programación.'; end if;
  if s.last_test_at > now() - interval '5 minutes' then raise exception 'Espera unos minutos antes de enviar otra prueba.' using hint = 'limit'; end if;
  update public.dl_schedules set last_test_at = now() where id = s.id;
  return private.dl_schedule_payload(s);
end $$;

create function public.dl_finish_schedule(p_id uuid, p_status text, p_value numeric, p_triggered boolean, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.dl_schedules set last_status = left(p_status, 40), last_value = p_value,
    last_triggered = coalesce(p_triggered, last_triggered) where id = p_id;
  insert into private.dl_schedule_runs (schedule_id, status, detail) values (p_id, left(p_status, 40), left(p_detail, 500));
  -- El registro se conserva mientras exista la programación (se borra en cascada con ella).
end $$;

create function public.dl_unsubscribe(p_schedule uuid, p_email text, p_all boolean) returns void
language sql security definer set search_path = '' as $$
  insert into private.dl_unsubscribes (email, schedule_id)
  select lower(btrim(p_email)), case when p_all then null else p_schedule end
  on conflict do nothing;
$$;

revoke all on function public.dl_store_connection(uuid, text, text, text), public.dl_update_connection(uuid, text, text, text),
  public.dl_claim_due_schedules(int), public.dl_claim_test(uuid, uuid), public.dl_finish_schedule(uuid, text, numeric, boolean, text),
  public.dl_unsubscribe(uuid, text, boolean), private.dl_schedule_payload(public.dl_schedules), private.dl_next_run(text, int, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.dl_store_connection(uuid, text, text, text), public.dl_update_connection(uuid, text, text, text),
  public.dl_claim_due_schedules(int), public.dl_claim_test(uuid, uuid), public.dl_finish_schedule(uuid, text, numeric, boolean, text),
  public.dl_unsubscribe(uuid, text, boolean) to service_role;

-- Clave de la tarea horaria: se genera dentro de Vault (nunca sale de la base) y el servidor la verifica aquí.
-- select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'datalite_cron_key', 'Clave de la tarea horaria de reportes de DataLite');
create function public.dl_check_cron_key(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_key, '') <> '' and exists (
    select 1 from vault.decrypted_secrets s where s.name = 'datalite_cron_key' and s.decrypted_secret = p_key);
$$;
revoke all on function public.dl_check_cron_key(text) from public, anon, authenticated;
grant execute on function public.dl_check_cron_key(text) to service_role;

-- ------------------------------------------------------------ Tarea horaria (minuto 5 de cada hora)
-- La clave vive solo en Supabase Vault ('datalite_cron_key'); el servidor la valida con dl_check_cron_key.
select cron.schedule('datalite-reportes', '5 * * * *', $cron$
  select net.http_post(
    url := 'https://data-lite.vercel.app/api/reportes/cron',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'datalite_cron_key'), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
