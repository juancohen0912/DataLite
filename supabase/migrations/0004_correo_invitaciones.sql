-- DataLite 0004: correo de aviso a las personas invitadas a un proyecto.
-- El servidor (api/compartir/notificar) solo envía el correo si esta función lo autoriza:
-- el que llama es el dueño con plan vigente, la persona está invitada y no se superan los límites anti abuso.

create table private.dl_invite_mails (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.dl_projects(id) on delete cascade,
  email text not null,
  sender uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index dl_invite_mails_sender_idx on private.dl_invite_mails (sender, sent_at desc);
create index dl_invite_mails_target_idx on private.dl_invite_mails (project_id, email, sent_at desc);
alter table private.dl_invite_mails enable row level security;
revoke all on private.dl_invite_mails from public, anon, authenticated;

-- Reserva el envío. Devuelve {send:false} si ya se avisó a esa persona hace poco (no es un error para la interfaz).
create function public.dl_claim_invite_email(p_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.dl_require_pro();
  em text := lower(btrim(coalesce(p_email, '')));
  r text;
  claim bigint;
  p public.dl_projects;
begin
  if private.dl_role(p_id) is distinct from 'owner' then raise exception 'Solo el dueño puede avisar a sus invitados.'; end if;
  select m.role into r from public.dl_project_members m where m.project_id = p_id and m.email = em;
  if r is null then raise exception 'Esa persona no está invitada a este proyecto.'; end if;
  if exists (select 1 from private.dl_invite_mails where project_id = p_id and email = em and sent_at > now() - interval '12 hours') then
    return jsonb_build_object('send', false, 'reason', 'recent');
  end if;
  if (select count(*) from private.dl_invite_mails where sender = uid and sent_at > now() - interval '24 hours') >= 40 then
    raise exception 'Enviaste muchas invitaciones hoy. Comparte el enlace tú mismo o intenta mañana.' using hint = 'limit';
  end if;
  select * into p from public.dl_projects where id = p_id;
  insert into private.dl_invite_mails (project_id, email, sender) values (p_id, em, uid) returning id into claim;
  return jsonb_build_object('send', true, 'claim', claim, 'project_id', p.id, 'project_name', p.name,
                            'owner_email', private.dl_email(), 'role', r);
end $$;

-- Si el correo no salió, el servidor libera la reserva para poder reintentar (solo el mismo dueño y en los primeros minutos).
create function public.dl_release_invite_email(p_claim bigint) returns void
language sql security definer set search_path = '' as $$
  delete from private.dl_invite_mails where id = p_claim and sender = (select auth.uid()) and sent_at > now() - interval '10 minutes';
$$;

revoke all on function public.dl_claim_invite_email(uuid, text), public.dl_release_invite_email(bigint) from public, anon;
grant execute on function public.dl_claim_invite_email(uuid, text), public.dl_release_invite_email(bigint) to authenticated;
