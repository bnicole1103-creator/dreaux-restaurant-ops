begin;
set local lock_timeout='5s';
-- Blank party size is unknown, never an invented guest count.
alter table public.reservations alter column party_size drop not null;
do $repair$
declare definition text;
begin
 select pg_get_functiondef(to_regprocedure('public.reservation_merge(uuid,jsonb)')) into definition;
 if definition is null then raise exception 'Install the reservation guestbook migration first.';end if;
 if definition ~* 'IF\s+r\.party_size\s+IS\s+NULL\s+OR\s+r\.party_size\s+NOT\s+BETWEEN\s+1\s+AND\s+500\s+THEN' then
  definition:=regexp_replace(definition,'IF\s+r\.party_size\s+IS\s+NULL\s+OR\s+r\.party_size\s+NOT\s+BETWEEN\s+1\s+AND\s+500\s+THEN','IF r.party_size IS NOT NULL AND r.party_size NOT BETWEEN 1 AND 500 THEN','i');
 elsif definition !~* 'IF\s+r\.party_size\s+IS\s+NOT\s+NULL\s+AND' then
  raise exception 'Reservation validation differs. Export reservation_merge; no changes applied.';
 end if;
 definition:=replace(definition,'x.party_size=r.party_size','x.party_size IS NOT DISTINCT FROM r.party_size');
 execute definition;
end;$repair$;
create or replace function public.reservation_submit(p_location_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; rows_to_save jsonb:='[]'; org uuid; missing text[];
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Choose a reservation list.';end if;
 if jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Choose 1 to 10,000 bookings.';end if;
 select organization_id into org from public.locations where id=p_location_id;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'Invalid reservation.';end if;
  if nullif(btrim(item->>'phone'),'') is null then raise exception 'Phone number is required for every reservation.';end if;
  if length(item->>'phone')>100 then raise exception 'Phone number is too long.';end if;
  missing:=array[]::text[];
  if nullif(btrim(item->>'guest_name'),'') is null then missing:=array_append(missing,'guest name');end if;
  if nullif(item->>'party_size','') is null then missing:=array_append(missing,'party size');end if;
  if nullif(item->>'reservation_time','') is null then missing:=array_append(missing,'time');end if;
  item:=item||jsonb_build_object('location_id',p_location_id,'organization_id',org,
   'guest_name',coalesce(nullif(btrim(item->>'guest_name'),''),'Guest — name pending'),
   'party_size',nullif(item->>'party_size','')::integer,
   'reservation_date',coalesce(nullif(item->>'reservation_date','')::date,(now() at time zone 'America/Chicago')::date),
   'reservation_time',nullif(item->>'reservation_time',''),
   'phone',btrim(item->>'phone'));
  if cardinality(missing)>0 then item:=item||jsonb_build_object('notes',concat_ws(E'\n',nullif(item->>'notes',''),'Details pending: '||array_to_string(missing,', ')));end if;
  rows_to_save:=rows_to_save||jsonb_build_array(item);
 end loop;
 return public.reservation_merge(p_location_id,rows_to_save);
end;$$;
revoke all on function public.reservation_submit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_submit(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
