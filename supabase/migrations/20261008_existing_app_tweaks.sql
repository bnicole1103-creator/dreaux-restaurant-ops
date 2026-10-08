begin;

alter table public.reservations
  add column if not exists assigned_server_id uuid references public.profiles(id),
  add column if not exists edit_version integer not null default 1;

create or replace function public.reservation_bump_edit_version()
returns trigger language plpgsql set search_path='' as $$
begin
  new.edit_version := old.edit_version + 1;
  return new;
end;
$$;
revoke all on function public.reservation_bump_edit_version() from public,anon,authenticated;
drop trigger if exists reservation_bump_edit_version on public.reservations;
create trigger reservation_bump_edit_version before update on public.reservations
  for each row execute function public.reservation_bump_edit_version();

create table if not exists public.reservation_edit_audit (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  reservation_id uuid not null references public.reservations(id),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  before_record jsonb not null,
  after_record jsonb not null
);
alter table public.reservation_edit_audit enable row level security;
revoke all on public.reservation_edit_audit from public,anon,authenticated;

create or replace function public.reservation_edit(
  p_location_id uuid,
  p_reservation_id uuid,
  p_version integer,
  p_party_size integer,
  p_table_id uuid,
  p_server_id uuid,
  p_notes text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  old_row public.reservations%rowtype;
  new_row public.reservations%rowtype;
  table_label text;
begin
  if auth.uid() is null
    or public.closeout_is_member(p_location_id) is not true then
    raise exception 'Location access required.' using errcode='42501';
  end if;
  select * into old_row from public.reservations
    where id=p_reservation_id and location_id=p_location_id for update;
  if not found then raise exception 'Reservation not found.'; end if;
  if p_version is distinct from old_row.edit_version then
    raise exception 'This reservation changed. Refresh the list and reopen Edit.';
  end if;
  if p_party_size is null or p_party_size not between 1 and 500
    or length(coalesce(p_notes,''))>4000 then
    raise exception 'Enter a party size from 1 to 500 and notes up to 4000 characters.';
  end if;
  if p_table_id is not null then
    select table_name into table_label from public.floor_tables
      where id=p_table_id and location_id=p_location_id;
    if not found then raise exception 'Choose a table at this location.'; end if;
  end if;
  if p_server_id is not null and not exists(
    select 1 from public.location_memberships m join public.profiles p on p.id=m.user_id
    where m.location_id=p_location_id and m.user_id=p_server_id
      and m.status='active' and p.is_active
  ) then raise exception 'Choose an active employee at this location.'; end if;
  update public.reservations set party_size=p_party_size,
    table_id=p_table_id,table_name=table_label,assigned_server_id=p_server_id,
    notes=nullif(btrim(p_notes),''),edit_version=edit_version+1
    where id=p_reservation_id returning * into new_row;
  insert into public.reservation_edit_audit(location_id,reservation_id,changed_by,before_record,after_record)
    values(p_location_id,p_reservation_id,auth.uid(),to_jsonb(old_row),to_jsonb(new_row));
  return to_jsonb(new_row);
end;
$$;
revoke all on function public.reservation_edit(uuid,uuid,integer,integer,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reservation_edit(uuid,uuid,integer,integer,uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
