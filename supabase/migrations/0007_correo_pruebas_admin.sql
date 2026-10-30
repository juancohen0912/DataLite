-- Aviso por correo al asignar, prorrogar, recortar o terminar una prueba. La base decide destinatario y contenido;
-- solo el administrador puede pedirlo y máximo un correo por prueba cada 60 segundos.
alter table private.dl_grants add column last_mail_at timestamptz;

create function public.dl_admin_claim_grant_mail(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare adm text := private.dl_require_admin(); g private.dl_grants;
begin
  select * into g from private.dl_grants where id = p_id for update;
  if g.id is null then raise exception 'No encontramos esa prueba.' using errcode = 'P0001'; end if;
  if g.last_mail_at > now() - interval '60 seconds' then return null; end if;
  update private.dl_grants set last_mail_at = now() where id = g.id;
  return jsonb_build_object('email', g.email, 'kind', g.kind, 'ends_at', g.ends_at, 'active', g.ends_at > now(),
    'org', (select jsonb_build_object('name', o.name, 'seats', o.seats) from public.dl_orgs o where o.id = g.org_id),
    'admin_email', adm);
end $$;

revoke all on function public.dl_admin_claim_grant_mail(uuid) from public, anon;
grant execute on function public.dl_admin_claim_grant_mail(uuid) to authenticated;
