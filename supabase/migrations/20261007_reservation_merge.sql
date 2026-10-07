begin;
create or replace function public.reservation_normalize(p_value text)
returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g'));
$$;
create or replace function public.reservation_time_key(p_value text)
returns text language plpgsql immutable set search_path='' as $$
begin
 return coalesce(nullif(btrim(p_value),'')::time::text,'');
exception when others then return public.reservation_normalize(p_value);
end;$$;
-- Security invoker keeps the existing Reservations row policies in force.
create or replace function public.reservation_merge(p_location_id uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j jsonb;r public.reservations%rowtype;v_time time;v_date date;n integer:=0;skipped integer:=0;matched integer:=0;pid uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Choose a valid reservation list.';end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'Import 1 to 2,000 reservations at a time.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reservation-merge:'||p_location_id::text,0));
 for j in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(j) is distinct from 'object' or nullif(btrim(j->>'guest_name'),'') is null or length(j->>'guest_name')>200 then raise exception 'Each reservation needs a guest name (up to 200 characters).';end if;
  if (j->>'location_id')::uuid is distinct from p_location_id or not exists(select 1 from public.locations where id=p_location_id and organization_id=(j->>'organization_id')::uuid) then raise exception 'Reservation location does not match.';end if;
  v_date:=nullif(j->>'reservation_date','')::date;
  if v_date is null then raise exception 'Each reservation needs a date.';end if;
  begin v_time:=nullif(btrim(j->>'reservation_time'),'')::time;exception when others then raise exception 'Invalid reservation time for %. Use 6:30 PM or 18:30.',j->>'guest_name';end;
  j:=jsonb_set(j,'{reservation_time}',coalesce(to_jsonb(v_time::text),'null'::jsonb));
  r:=jsonb_populate_record(null::public.reservations,j);
  if r.party_size is null or r.party_size not between 1 and 500 then raise exception 'Party size must be a whole number from 1 to 500.';end if;
  if r.imported_source not in ('csv','manual') or r.imported_source is null then raise exception 'Invalid reservation source.';end if;
  if r.table_id is not null and not exists(select 1 from public.floor_tables where id=r.table_id and location_id=p_location_id) then raise exception 'Choose a table at this location.';end if;
  select x.id into pid from public.reservations x where x.location_id=p_location_id and (
   (nullif(btrim(r.external_reservation_id),'') is not null and btrim(x.external_reservation_id)=btrim(r.external_reservation_id))
   or (x.reservation_date=v_date and public.reservation_time_key(x.reservation_time::text)=coalesce(v_time::text,'')
    and public.reservation_normalize(x.guest_name)=public.reservation_normalize(r.guest_name) and x.party_size=r.party_size
    and not (nullif(btrim(x.external_reservation_id),'') is not null and nullif(btrim(r.external_reservation_id),'') is not null and btrim(x.external_reservation_id)<>btrim(r.external_reservation_id))
    and not (nullif(btrim(x.email),'') is not null and nullif(btrim(r.email),'') is not null and lower(btrim(x.email))<>lower(btrim(r.email)))
    and not (nullif(regexp_replace(coalesce(x.phone,''),'\D','','g'),'') is not null and nullif(regexp_replace(coalesce(r.phone,''),'\D','','g'),'') is not null
      and right(regexp_replace(x.phone,'\D','','g'),10)<>right(regexp_replace(r.phone,'\D','','g'),10)))
  ) limit 1;
  if pid is not null then skipped:=skipped+1;continue;end if;
  insert into public.reservations(organization_id,location_id,reservation_date,reservation_time,guest_name,party_size,phone,email,table_id,table_name,status,occasion,is_birthday,is_vip,dining_area,notes,imported_source,external_reservation_id)
  values(r.organization_id,p_location_id,v_date,r.reservation_time,btrim(r.guest_name),r.party_size,nullif(btrim(r.phone),''),nullif(btrim(r.email),''),r.table_id,r.table_name,coalesce(nullif(r.status,''),'booked'),r.occasion,coalesce(r.is_birthday,false),coalesce(r.is_vip,false),r.dining_area,r.notes,r.imported_source,nullif(btrim(r.external_reservation_id),''));
  n:=n+1;if r.table_id is not null then matched:=matched+1;end if;
 end loop;
 return jsonb_build_object('added',n,'duplicates',skipped,'matched',matched);
end;$$;
revoke all on function public.reservation_normalize(text),public.reservation_time_key(text),public.reservation_merge(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_normalize(text),public.reservation_time_key(text),public.reservation_merge(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
