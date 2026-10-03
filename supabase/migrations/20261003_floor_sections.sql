begin;

create or replace function public.floor_assign_section(
 p_location_id uuid,p_shift_id uuid,p_shift_name text,p_name text,
 p_server_id uuid,p_table_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 org uuid; sid uuid; shift_status text; config uuid; section_id uuid;
 ids uuid[]; seats integer; business_day date;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not (
  public.mod_is_manager(p_location_id) or exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active' and can_edit_floor)
 ) then raise exception 'Floor editing access required.' using errcode='42501'; end if;
 select array_agg(distinct x) into ids from unnest(p_table_ids) x where x is not null;
 if coalesce(cardinality(ids),0) not between 1 and 100 then raise exception 'Select 1 to 100 tables.'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Enter a section name.'; end if;
 if not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=p_server_id and status='active') then raise exception 'Choose an active employee at this location.'; end if;
 select organization_id into org from public.locations where id=p_location_id;
 business_day:=(clock_timestamp() at time zone 'America/Chicago')::date;
 if p_shift_id is null then
  if p_shift_name is null or length(btrim(p_shift_name)) not between 1 and 100 then raise exception 'Choose a shift name.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text||business_day::text||btrim(p_shift_name),0));
  select id into sid from public.shifts where location_id=p_location_id and shift_date=business_day and shift_name=btrim(p_shift_name) and status in ('scheduled','open','closed') order by created_at limit 1;
  if sid is null then
   insert into public.shifts(organization_id,location_id,shift_date,shift_name,status)
   values(org,p_location_id,business_day,btrim(p_shift_name),'scheduled') returning id into sid;
  end if;
 else sid:=p_shift_id; end if;
 select status into shift_status from public.shifts where id=sid and location_id=p_location_id and status in ('scheduled','open','closed') for update;
 if not found then raise exception 'Choose a scheduled, open or closed shift at this location.'; end if;
 perform 1 from public.floor_tables where id=any(ids) and location_id=p_location_id and is_active order by id for update;
 select sum(seat_count) into seats from public.floor_tables where id=any(ids) and location_id=p_location_id and is_active;
 if (select count(*) from public.floor_tables where id=any(ids) and location_id=p_location_id and is_active)<>cardinality(ids) then raise exception 'One or more selected tables are unavailable.'; end if;
 delete from public.shift_section_tables st using public.shift_sections ss where st.shift_section_id=ss.id and ss.shift_id=sid and st.table_id=any(ids);
 update public.shift_sections ss set assignment_status='cancelled' where ss.shift_id=sid and ss.assignment_status<>'cancelled' and not exists(select 1 from public.shift_section_tables st where st.shift_section_id=ss.id);
 insert into public.section_configurations(organization_id,location_id,name,total_seats,is_saved_template,created_by)
 values(org,p_location_id,btrim(p_name),seats,false,auth.uid()) returning id into config;
 insert into public.section_configuration_tables(section_configuration_id,table_id) select config,unnest(ids);
 insert into public.shift_sections(organization_id,location_id,shift_id,section_configuration_id,employee_id,assigned_by,assignment_status)
 values(org,p_location_id,sid,config,p_server_id,auth.uid(),'active') returning id into section_id;
 insert into public.shift_section_tables(shift_section_id,table_id) select section_id,unnest(ids);
 insert into public.server_assignments(organization_id,location_id,shift_id,table_id,server_id,assigned_by,assigned_at)
 select org,p_location_id,sid,unnest(ids),p_server_id,auth.uid(),clock_timestamp()
 on conflict(shift_id,table_id) do update set server_id=excluded.server_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 return jsonb_build_object('shift_id',sid,'status',shift_status,'section_id',section_id);
end; $$;

create or replace function public.floor_seat_party(
 p_location_id uuid,p_shift_id uuid,p_table_ids uuid[],p_server_id uuid,
 p_guest_name text,p_guest_phone text,p_guest_email text,p_party_size integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare ids uuid[]; org uuid; session_id uuid;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not (
  public.mod_is_manager(p_location_id) or exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active' and (can_edit_floor or role='host'))
 ) then raise exception 'Seating access required.' using errcode='42501'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_table_ids) x where x is not null;
 if coalesce(cardinality(ids),0) not between 1 and 100 or p_party_size is null or p_party_size not between 1 and 500 then raise exception 'Choose tables and enter a valid party size.'; end if;
 if p_server_id is null or not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=p_server_id and status='active') then raise exception 'Choose the server responsible for this party.'; end if;
 if length(coalesce(p_guest_name,''))>200 or length(coalesce(p_guest_phone,''))>100 or length(coalesce(p_guest_email,''))>320 then raise exception 'Guest details are too long.'; end if;
 select organization_id into org from public.shifts where id=p_shift_id and location_id=p_location_id and status='open' for update;
 if not found then raise exception 'Open the shift before seating guests.'; end if;
 perform 1 from public.floor_tables where id=any(ids) and location_id=p_location_id and is_active order by id for update;
 if (select count(*) from public.floor_tables where id=any(ids) and location_id=p_location_id and is_active)<>cardinality(ids) then raise exception 'One or more selected tables are unavailable.'; end if;
 if exists(select 1 from public.table_sessions s where s.location_id=p_location_id and s.closed_at is null and (
  s.table_id=any(ids) or exists(select 1 from public.table_session_tables t where t.table_session_id=s.id and t.table_id=any(ids))
 )) then raise exception 'A selected table is occupied. Clear it or choose another table.'; end if;
 insert into public.table_sessions(organization_id,location_id,shift_id,table_id,server_id,guest_name,guest_phone,guest_email,party_size,status,seated_at)
 values(org,p_location_id,p_shift_id,ids[1],p_server_id,nullif(btrim(p_guest_name),''),nullif(btrim(p_guest_phone),''),nullif(btrim(p_guest_email),''),p_party_size,'seated',clock_timestamp()) returning id into session_id;
 insert into public.table_session_tables(table_session_id,table_id) select session_id,unnest(ids);
 return session_id;
end; $$;
revoke all on function public.floor_assign_section(uuid,uuid,text,text,uuid,uuid[]),public.floor_seat_party(uuid,uuid,uuid[],uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.floor_assign_section(uuid,uuid,text,text,uuid,uuid[]),public.floor_seat_party(uuid,uuid,uuid[],uuid,text,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
