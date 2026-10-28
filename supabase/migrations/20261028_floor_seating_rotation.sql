begin;
-- Durable seating history; closed tables stay in the log. No direct client writes.
create table if not exists public.floor_seating_history_v1 (
 request_id uuid primary key, location_id uuid not null, shift_id uuid not null,
 session_id uuid not null unique, server_id uuid not null, server_name text not null,
 table_ids uuid[] not null, table_names text not null, party_size integer not null,
 source text not null check(source in ('walk_in','reservation')),
 reservation_id uuid, walkin_id uuid, seated_at timestamptz not null,
 actor_id uuid not null, payload jsonb not null
);
alter table public.floor_seating_history_v1 enable row level security;
revoke all on public.floor_seating_history_v1 from public, anon, authenticated;
create index if not exists floor_seating_history_shift_v1 on public.floor_seating_history_v1(location_id,shift_id,seated_at desc);

create or replace function public.floor_seat_and_rotate_v1(
 p_location_id uuid,p_shift_id uuid,p_table_ids uuid[],p_server_id uuid,
 p_guest_name text,p_guest_phone text,p_guest_email text,p_party_size integer,
 p_request_id uuid,p_source text,p_reservation_id uuid default null,
 p_walkin_id uuid default null,p_walkin_version integer default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 sid uuid; org uuid; counter_id uuid; server_label text; names text; ids uuid[];
 existing public.floor_seating_history_v1; data jsonb; service_date date;
begin
 if auth.uid() is null or public.walkin_can_manage(p_location_id) is not true then
  raise exception 'Seating access required.' using errcode='42501';
 end if;
 if p_request_id is null or p_server_id is null or p_source not in ('walk_in','reservation') or p_source is null then
  raise exception 'Choose a server and reservation or walk-in.';
 end if;
 select array_agg(distinct x order by x) into ids from unnest(p_table_ids) x where x is not null;
 data:=jsonb_build_object('tables',ids,'server',p_server_id,'size',p_party_size,'source',p_source,
  'reservation',p_reservation_id,'walkin',p_walkin_id,'name',p_guest_name,'phone',p_guest_phone,'email',p_guest_email);
 perform pg_advisory_xact_lock(hashtextextended('floor-seat-request:'||p_request_id::text,0));
 select * into existing from public.floor_seating_history_v1 where request_id=p_request_id;
 if found then
  if existing.location_id<>p_location_id or existing.shift_id<>p_shift_id or existing.payload is distinct from data then
   raise exception 'This seating request changed. Reopen the seating form.';
  end if;
  return existing.session_id;
 end if;
 select organization_id,shift_date into org,service_date from public.shifts
  where id=p_shift_id and location_id=p_location_id and status='open' for update;
 if not found then raise exception 'Open the shift before seating guests.'; end if;
 if p_source='reservation' then
  if p_reservation_id is null or p_walkin_id is not null then raise exception 'Choose the reservation.'; end if;
  perform 1 from public.reservations where id=p_reservation_id and location_id=p_location_id
   and reservation_date=service_date and status not in ('cancelled','canceled','no_show') for update;
  if not found then raise exception 'Reservation unavailable for this service date.'; end if;
  if exists(select 1 from public.floor_seating_history_v1 where reservation_id=p_reservation_id) then
   raise exception 'This reservation has already been seated.';
  end if;
 elsif p_reservation_id is not null then raise exception 'Choose reservation as the source.';
 end if;
 if p_walkin_id is not null then
  perform 1 from public.walkin_entries where id=p_walkin_id and location_id=p_location_id
   and status='waiting' and version=p_walkin_version for update;
  if not found then raise exception 'This walk-in changed or is already seated. Refresh the list.'; end if;
  sid:=public.floor_seat_walkin(p_location_id,p_walkin_id,p_walkin_version,p_shift_id,ids,p_server_id,p_guest_name,p_guest_phone,p_guest_email,p_party_size);
 else
  sid:=public.floor_seat_party(p_location_id,p_shift_id,ids,p_server_id,p_guest_name,p_guest_phone,p_guest_email,p_party_size);
 end if;
 -- A retried walk-in can return its existing session. Do not count it twice.
 if exists(select 1 from public.floor_seating_history_v1 where session_id=sid) then return sid; end if;
 select coalesce(nullif(p.full_name,''),'Team member') into server_label from public.profiles p where p.id=p_server_id;
 server_label:=coalesce(server_label,'Team member');
 select string_agg(t.table_name,', ' order by t.table_name) into names from public.floor_tables t where t.id=any(ids);
 perform pg_advisory_xact_lock(hashtextextended('floor-rotation:'||p_shift_id::text,0));
 select id into counter_id from public.rotation_counters where shift_id=p_shift_id and user_id=p_server_id order by slot_number limit 1 for update;
 if counter_id is null then
  insert into public.rotation_counters(organization_id,location_id,shift_id,user_id,slot_number,display_name,cover_count)
  select org,p_location_id,p_shift_id,p_server_id,coalesce(max(slot_number),0)+1,server_label,0
   from public.rotation_counters where shift_id=p_shift_id returning id into counter_id;
 end if;
 update public.rotation_counters set cover_count=coalesce(cover_count,0)+p_party_size where id=counter_id;
 insert into public.rotation_log(organization_id,location_id,shift_id,rotation_counter_id,user_id,display_name,table_id,table_name,covers_delta,action,created_by)
 values(org,p_location_id,p_shift_id,counter_id,p_server_id,server_label,ids[1],names,p_party_size,'seated',auth.uid());
 insert into public.floor_seating_history_v1(request_id,location_id,shift_id,session_id,server_id,server_name,table_ids,table_names,party_size,source,reservation_id,walkin_id,seated_at,actor_id,payload)
 select p_request_id,p_location_id,p_shift_id,sid,p_server_id,server_label,ids,names,p_party_size,p_source,p_reservation_id,p_walkin_id,s.seated_at,auth.uid(),data
 from public.table_sessions s where s.id=sid;
 return sid;
end; $$;

create or replace function public.floor_seating_history_load_v1(p_location_id uuid,p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.walkin_can_manage(p_location_id) is not true then
  raise exception 'Seating access required.' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.seated_at desc) from (
  select h.session_id,h.server_id,h.server_name,h.table_names,h.party_size,h.source,h.seated_at,
   s.closed_at,s.status from public.floor_seating_history_v1 h
   join public.table_sessions s on s.id=h.session_id
   where h.location_id=p_location_id and h.shift_id=p_shift_id order by h.seated_at desc limit 300
 ) x),'[]'::jsonb);
end; $$;
revoke all on function public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer),public.floor_seating_history_load_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer),public.floor_seating_history_load_v1(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
