begin;
alter table public.server_assignments alter column server_id drop not null;
alter table public.server_assignments add column if not exists guest_name text;
alter table public.shift_sections alter column employee_id drop not null;
alter table public.shift_sections add column if not exists guest_name text;
alter table public.floor_section_plans alter column employee_id drop not null;
alter table public.floor_section_plans add column if not exists guest_name text;
create or replace function public.floor_assign_section_person(
 p_location_id uuid,p_shift_id uuid,p_shift_name text,p_name text,
 p_server_id uuid,p_table_ids uuid[],p_guest_name text
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
 if (p_server_id is null) = (nullif(btrim(p_guest_name),'') is null) then raise exception 'Choose an employee account or type a name, not both.';end if;
 if p_server_id is not null and public.floor_schedule_member(p_location_id,p_server_id) is not true then raise exception 'Choose an active employee at this location.';end if;
 if p_guest_name is not null and length(btrim(p_guest_name)) not between 1 and 100 then raise exception 'Enter a name up to 100 characters.';end if;
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
 insert into public.shift_sections(organization_id,location_id,shift_id,section_configuration_id,employee_id,guest_name,assigned_by,assignment_status)
 values(org,p_location_id,sid,config,p_server_id,nullif(btrim(p_guest_name),''),auth.uid(),'active') returning id into section_id;
 insert into public.shift_section_tables(shift_section_id,table_id) select section_id,unnest(ids);
 insert into public.server_assignments(organization_id,location_id,shift_id,table_id,server_id,guest_name,assigned_by,assigned_at)
 select org,p_location_id,sid,unnest(ids),p_server_id,nullif(btrim(p_guest_name),''),auth.uid(),clock_timestamp()
 on conflict(shift_id,table_id) do update set server_id=excluded.server_id,guest_name=excluded.guest_name,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 return jsonb_build_object('shift_id',sid,'status',shift_status,'section_id',section_id);
end; $$;


create or replace function public.floor_assign_section(p_location_id uuid,p_shift_id uuid,p_shift_name text,p_name text,p_server_id uuid,p_table_ids uuid[])
returns jsonb language sql security definer set search_path='' as $$
 select public.floor_assign_section_person(p_location_id,p_shift_id,p_shift_name,p_name,p_server_id,p_table_ids,null);
$$;


create or replace function public.floor_schedule_save_person(
 p_location_id uuid,p_id uuid,p_version integer,p_name text,p_employee_id uuid,
 p_table_ids uuid[],p_date date,p_start time,p_end time,p_request_id uuid,p_guest_name text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare ids uuid[];start_at timestamptz;end_at timestamptz;result uuid;
begin
 if public.floor_schedule_can_manage(p_location_id) is not true then raise exception 'Floor editing access required.' using errcode='42501';end if;
 if p_date is null or p_start is null or p_end is null or p_start=p_end or p_request_id is null or coalesce(length(btrim(p_name)),0) not between 1 and 100 then raise exception 'Enter a date, start time, end time and section name.';end if;
 start_at:=(p_date+p_start) at time zone 'America/Chicago';
 end_at:=((p_date+case when p_end<p_start then 1 else 0 end)+p_end) at time zone 'America/Chicago';
 if (start_at at time zone 'America/Chicago') is distinct from (p_date+p_start) then raise exception 'That start time does not exist because of daylight saving time. Choose another time.';end if;
 if end_at<=start_at or end_at>start_at+interval '18 hours' or end_at<=now() or start_at>now()+interval '365 days' then raise exception 'Choose a current or future window of no more than 18 hours, within the next year.';end if;
 select array_agg(distinct id order by id) into ids from unnest(p_table_ids) t(id) where id is not null;
 if coalesce(cardinality(ids),0) not between 1 and 100 then raise exception 'Select 1 to 100 tables.';end if;
 if (p_employee_id is null) = (nullif(btrim(p_guest_name),'') is null) then raise exception 'Choose an account or type a name, not both.';end if;
 if p_employee_id is not null and public.floor_schedule_member(p_location_id,p_employee_id) is not true then raise exception 'Choose an active employee at this location.';end if;
 if p_guest_name is not null and length(btrim(p_guest_name)) not between 1 and 100 then raise exception 'Enter a name up to 100 characters.';end if;
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location_id::text,0));
 if p_id is null then
  select id into result from public.floor_section_plans where location_id=p_location_id and request_id=p_request_id;
  if result is not null then return result;end if;
 else
  perform 1 from public.floor_section_plans where id=p_id and location_id=p_location_id and version=p_version and cancelled_at is null for update;
  if not found then raise exception 'This planned section changed. Reload before saving.';end if;
 end if;
 if (select count(*) from public.floor_tables where location_id=p_location_id and is_active and id=any(ids))<>cardinality(ids) then raise exception 'Selected tables must be active at this location.';end if;
 if exists(select 1 from public.floor_section_plans p where p.location_id=p_location_id and p.cancelled_at is null and p.id is distinct from p_id and p.table_ids&&ids and p.starts_at<end_at and start_at<p.ends_at) then raise exception 'These tables already have a planned section during that time. Edit that plan or choose another window.';end if;
 if p_id is null then
  insert into public.floor_section_plans(location_id,employee_id,guest_name,name,table_ids,starts_at,ends_at,created_by,request_id)
  values(p_location_id,p_employee_id,nullif(btrim(p_guest_name),''),btrim(p_name),ids,start_at,end_at,auth.uid(),p_request_id) returning id into result;
 else
  update public.floor_section_plans set employee_id=p_employee_id,guest_name=nullif(btrim(p_guest_name),''),name=btrim(p_name),table_ids=ids,starts_at=start_at,ends_at=end_at,version=version+1,updated_at=now()
  where id=p_id returning id into result;
 end if;
 return result;
end;$$;


create or replace function public.floor_schedule_save(p_location_id uuid,p_id uuid,p_version integer,p_name text,p_employee_id uuid,p_table_ids uuid[],p_date date,p_start time,p_end time,p_request_id uuid)
returns uuid language sql security definer set search_path='' as $$
 select public.floor_schedule_save_person(p_location_id,p_id,p_version,p_name,p_employee_id,p_table_ids,p_date,p_start,p_end,p_request_id,null);
$$;


create or replace function public.floor_schedule_list(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;manager boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 manager:=public.floor_schedule_can_manage(p_location_id);
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'employee_id',p.employee_id,'guest_name',p.guest_name,'name',p.name,'table_ids',p.table_ids,
  'starts_at',p.starts_at,'ends_at',p.ends_at,'version',p.version,'published_at',p.published_at,
  'assignable',(public.floor_schedule_member(p.location_id,p.employee_id) or (p.employee_id is null and nullif(btrim(p.guest_name),'') is not null))
 ) order by p.starts_at,p.name),'[]'::jsonb) into result
 from public.floor_section_plans p
 where p.location_id=p_location_id and p.cancelled_at is null
 and (manager or p.published_at is not null)
 and p.ends_at>now() and p.starts_at<now()+interval '366 days';
 return jsonb_build_object('can_manage',manager,'plans',result,'server_now',now());
end;$$;

create or replace function public.floor_schedule_publish(p_location_id uuid,p_id uuid,p_version integer,p_publish boolean)
returns void language plpgsql security definer set search_path='' as $$
declare plan public.floor_section_plans;
begin
 if public.floor_schedule_can_manage(p_location_id) is not true then raise exception 'Floor editing access required.' using errcode='42501';end if;
 if p_publish is null then raise exception 'Choose publish or unpublish.';end if;
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location_id::text,0));
 select * into plan from public.floor_section_plans where id=p_id and location_id=p_location_id and version=p_version and cancelled_at is null for update;
 if not found then raise exception 'This section changed. Reload before publishing.';end if;
 if p_publish then
  if plan.ends_at<=now() or (public.floor_schedule_member(p_location_id,plan.employee_id) or (plan.employee_id is null and nullif(btrim(plan.guest_name),'') is not null)) is not true then raise exception 'Choose an active employee and a current or future window.';end if;
  if (select count(*) from public.floor_tables where location_id=p_location_id and is_active and id=any(plan.table_ids))<>cardinality(plan.table_ids) then raise exception 'Choose active tables at this location.';end if;
 end if;
 update public.floor_section_plans set published_at=case when p_publish then now() else null end,version=version+1,updated_at=now() where id=p_id;
end;$$;

create or replace function public.floor_schedule_draft_on_edit()
returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.employee_id,new.name,new.table_ids,new.starts_at,new.ends_at)
 is distinct from row(old.employee_id,old.name,old.table_ids,old.starts_at,old.ends_at)
 then new.published_at:=null;end if;
 return new;
end;$$;

create or replace function public.floor_sections_for_day(p_location_id uuid,p_date date,p_only_me boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;window_start timestamptz;window_end timestamptz;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a date.';end if;
 window_start:=(p_date+time '04:00') at time zone 'America/Chicago';
 window_end:=((p_date+1)+time '04:00') at time zone 'America/Chicago';
 with sections as (
 select p.id,p.name,p.employee_id,p.guest_name,p.starts_at,p.ends_at,p.table_ids
 from public.floor_section_plans p
 where p.location_id=p_location_id and p.cancelled_at is null and p.published_at is not null
 and (public.floor_schedule_member(p.location_id,p.employee_id) or (p.employee_id is null and nullif(btrim(p.guest_name),'') is not null))
 and p.starts_at<window_end and p.ends_at>window_start
 union all
 select s.id,s.shift_name||' section',a.server_id,a.guest_name,null::timestamptz,null::timestamptz,array_agg(distinct a.table_id order by a.table_id)
 from public.server_assignments a join public.shifts s on s.id=a.shift_id
 join public.floor_tables t on t.id=a.table_id and t.location_id=s.location_id
 where s.location_id=p_location_id and s.shift_date=p_date and s.status in ('scheduled','open','closed')
 and (public.floor_schedule_member(s.location_id,a.server_id) or (a.server_id is null and nullif(btrim(a.guest_name),'') is not null))
 and not exists(select 1 from public.floor_section_plans p where p.location_id=p_location_id and p.published_at is not null and p.cancelled_at is null and (public.floor_schedule_member(p.location_id,p.employee_id) or (p.employee_id is null and nullif(btrim(p.guest_name),'') is not null)) and now()>=window_start and now()<window_end and a.table_id=any(p.table_ids) and p.starts_at<=now() and p.ends_at>now())
 group by s.id,s.shift_name,a.server_id,a.guest_name
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'employee_id',x.employee_id,
 'employee',coalesce(nullif(pr.preferred_name,''),nullif(pr.full_name,''),x.guest_name,'Team member'),
 'starts_at',x.starts_at,'ends_at',x.ends_at,
 'tables',(select coalesce(string_agg(t.table_name,', ' order by t.table_name),'') from public.floor_tables t where t.location_id=p_location_id and t.id=any(x.table_ids))
 ) order by x.starts_at nulls last,x.name),'[]'::jsonb) into result
 from sections x left join public.profiles pr on pr.id=x.employee_id
 where not coalesce(p_only_me,false) or x.employee_id=auth.uid();
 return result;
end;$$;

create or replace function public.preshift_sections_edit(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; employees jsonb; tables jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_date is null then raise exception 'Choose a date.';end if;
 with sections as (
  select 'plan'::text kind,p.id::text id,null::uuid shift_id,p.name,p.employee_id,p.table_ids,p.starts_at,p.ends_at,p.version,p.published_at,p.guest_name
  from public.floor_section_plans p where p.location_id=p_location_id and p.cancelled_at is null
   and p.starts_at<(p_date+1+time '04:00') at time zone 'America/Chicago'
   and p.ends_at>(p_date+time '04:00') at time zone 'America/Chicago'
  union all
  select 'regular',s.id::text||':'||coalesce(a.server_id::text,'name:'||a.guest_name),s.id,
   coalesce((select c.name from public.shift_sections ss join public.section_configurations c on c.id=ss.section_configuration_id
    where ss.shift_id=s.id and ss.employee_id is not distinct from a.server_id and ss.guest_name is not distinct from a.guest_name and ss.assignment_status<>'cancelled'
    order by ss.id limit 1),s.shift_name||' section'),a.server_id,array_agg(a.table_id order by a.table_id),null,null,null,null,a.guest_name
  from public.shifts s join public.server_assignments a on a.shift_id=s.id
  where s.location_id=p_location_id and s.shift_date=p_date and s.status in ('scheduled','open','closed')
  group by s.id,s.shift_name,a.server_id,a.guest_name
 ) select coalesce(jsonb_agg(to_jsonb(x) order by kind,id),'[]'::jsonb) into rows from sections x;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team Member')) order by p.full_name,m.user_id),'[]'::jsonb)
 into employees from public.location_memberships m left join public.profiles p on p.id=m.user_id
 where m.location_id=p_location_id and public.floor_schedule_member(p_location_id,m.user_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.table_name) order by t.table_name,t.id),'[]'::jsonb)
 into tables from public.floor_tables t where t.location_id=p_location_id and t.is_active;
 return jsonb_build_object('rows',rows,'employees',employees,'tables',tables);
end;$$;

create or replace function public.preshift_post_save_sections(
 p_location_id uuid,p_id uuid,p_version integer,p_title text,p_body text,p_shift_date date,p_pinned boolean,
 p_presentation jsonb,p_media jsonb,p_source jsonb,p_sections jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare current_rows jsonb;r jsonb;original jsonb;ids uuid[];sid uuid;pid uuid;summary text:='';employee text;labels text;plan public.floor_section_plans;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_source is null and p_sections is null then
  return public.preshift_post_save_full(p_location_id,p_id,p_version,p_title,p_body,p_shift_date,p_pinned,p_presentation,p_media);
 end if;
 if jsonb_typeof(p_source) is distinct from 'array' or jsonb_typeof(p_sections) is distinct from 'array' then raise exception 'Pull sections from Floor first.';end if;
 -- Share the schedule lock, then lock regular shifts and assignments before comparing.
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location_id::text,0));
 perform 1 from public.shifts where location_id=p_location_id and shift_date=p_shift_date order by id for update;
 perform 1 from public.server_assignments a join public.shifts s on s.id=a.shift_id where s.location_id=p_location_id and s.shift_date=p_shift_date order by a.id for update of a;
 perform 1 from public.floor_section_plans where location_id=p_location_id and cancelled_at is null order by id for update;
 current_rows:=public.preshift_sections_edit(p_location_id,p_shift_date)->'rows';
 if current_rows is distinct from p_source then raise exception 'Floor sections changed. Pull them again before publishing.';end if;
 if jsonb_array_length(p_sections)<>jsonb_array_length(p_source) or exists(
  select 1 from jsonb_array_elements(p_source) s where (select count(*) from jsonb_array_elements(p_sections) e where e->>'id'=s->>'id')<>1
 ) then raise exception 'Keep the loaded sections. Add or remove sections on Floor, then pull again.';end if;
 for r in select value from jsonb_array_elements(p_sections) loop
  select value into original from jsonb_array_elements(p_source) where value->>'id'=r->>'id';
  if coalesce(length(btrim(r->>'name')),0) not between 1 and 100 or ((r->>'employee_id' is null) = (nullif(btrim(r->>'guest_name'),'') is null))
   or (r->>'employee_id' is not null and public.floor_schedule_member(p_location_id,(r->>'employee_id')::uuid) is not true)
   or (r->>'guest_name' is not null and length(btrim(r->>'guest_name')) not between 1 and 100) then raise exception 'Choose a section name and active employee.';end if;
  if jsonb_typeof(r->'table_ids') is distinct from 'array' then raise exception 'Choose tables for each section.';end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(r->'table_ids');
  if coalesce(cardinality(ids),0) not between 1 and 100 or cardinality(ids)<>jsonb_array_length(r->'table_ids') or
   (select count(*) from public.floor_tables where location_id=p_location_id and is_active and id=any(ids))<>cardinality(ids) then raise exception 'Choose distinct active tables at this location.';end if;
  if exists(select 1 from jsonb_array_elements(p_sections) other join jsonb_array_elements(p_source) src on src->>'id'=other->>'id'
   where other->>'id'<>r->>'id' and (original->>'kind'='regular' and src->>'kind'='regular' and original->>'shift_id'=src->>'shift_id'
    or original->>'kind'='plan' and src->>'kind'='plan' and (original->>'starts_at')::timestamptz<(src->>'ends_at')::timestamptz and (src->>'starts_at')::timestamptz<(original->>'ends_at')::timestamptz)
   and exists(select 1 from jsonb_array_elements_text(other->'table_ids') t where t::uuid=any(ids))) then raise exception 'A table is assigned twice during the same shift or time.';end if;
  if original->>'kind'='plan' and exists(select 1 from public.floor_section_plans p where p.location_id=p_location_id and p.cancelled_at is null
   and not exists(select 1 from jsonb_array_elements(p_source) s where s->>'kind'='plan' and s->>'id'=p.id::text)
   and p.table_ids&&ids and p.starts_at<(original->>'ends_at')::timestamptz and (original->>'starts_at')::timestamptz<p.ends_at) then raise exception 'These tables overlap another planned section.';end if;
 end loop;
 -- Rebuild changed regular shifts as a group so table swaps stay consistent.
 for sid in select distinct (s->>'shift_id')::uuid from jsonb_array_elements(p_source) s where s->>'kind'='regular'
  and exists(select 1 from jsonb_array_elements(p_sections) e where e->>'id'=s->>'id' and
   (e->>'name' is distinct from s->>'name' or e->>'employee_id' is distinct from s->>'employee_id' or e->>'guest_name' is distinct from s->>'guest_name' or e->'table_ids' is distinct from s->'table_ids')) loop
  delete from public.server_assignments where shift_id=sid;
  delete from public.shift_section_tables st using public.shift_sections ss where ss.id=st.shift_section_id and ss.shift_id=sid;
  update public.shift_sections set assignment_status='cancelled' where shift_id=sid and assignment_status<>'cancelled';
  for r in select e.value from jsonb_array_elements(p_sections) e join jsonb_array_elements(p_source) s on s->>'id'=e.value->>'id' where (s->>'shift_id')::uuid=sid loop
   select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'table_ids');
   perform public.floor_assign_section_person(p_location_id,sid,null,r->>'name',(r->>'employee_id')::uuid,ids,r->>'guest_name');
  end loop;
 end loop;
 for r in select value from jsonb_array_elements(p_sections) loop
  select value into original from jsonb_array_elements(p_source) where value->>'id'=r->>'id';
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'table_ids');
  if original->>'kind'='plan' then
   select * into plan from public.floor_section_plans where id=(original->>'id')::uuid;
   if (r->>'name' is distinct from original->>'name' or r->>'employee_id' is distinct from original->>'employee_id' or r->>'guest_name' is distinct from original->>'guest_name' or r->'table_ids' is distinct from original->'table_ids' or plan.published_at is null) then
   if plan.ends_at<=now() then raise exception 'This timed section has ended. Publish sections for a current or future shift.';end if;
   update public.floor_section_plans set name=btrim(r->>'name'),employee_id=(r->>'employee_id')::uuid,guest_name=nullif(btrim(r->>'guest_name'),''),table_ids=ids,version=version+1,updated_at=now() where id=plan.id;
   perform public.floor_schedule_publish(p_location_id,plan.id,plan.version+1,true);
   end if;
  end if;
  select coalesce(nullif(preferred_name,''),nullif(full_name,''),'Team Member') into employee from public.profiles where id=(r->>'employee_id')::uuid;
  select string_agg(table_name,', ' order by table_name) into labels from public.floor_tables where id=any(ids);
  summary:=summary||case when summary='' then '' else E'\n\n' end||btrim(r->>'name')||' · '||coalesce(employee,nullif(btrim(r->>'guest_name'),''),'Team Member')||E'\nTables: '||labels;
  if original->>'kind'='plan' then summary:=summary||E'\n'||to_char((original->>'starts_at')::timestamptz at time zone 'America/Chicago','Mon DD, FMHH12:MI AM')||' – '||to_char((original->>'ends_at')::timestamptz at time zone 'America/Chicago','Mon DD, FMHH12:MI AM')||' CT';end if;
 end loop;
 pid:=public.preshift_post_save_full(p_location_id,p_id,p_version,p_title,p_body||case when summary='' then '' else E'\n\n── Sections ──\n'||summary end,p_shift_date,p_pinned,p_presentation,p_media);
 return pid;
end;$$;create or replace function public.floor_clear_section_assignments(p_location_id uuid,p_shift_id uuid,p_table_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[];plan public.floor_section_plans;remaining uuid[];
begin
 if public.floor_schedule_can_manage(p_location_id) is not true then raise exception 'Floor editing access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location_id::text,0));
 if p_shift_id is not null then
  perform 1 from public.shifts where id=p_shift_id and location_id=p_location_id for update;
  if not found then raise exception 'Shift not found at this location.';end if;
 end if;
 if p_table_ids is null then
  select array_agg(id) into ids from public.floor_tables where location_id=p_location_id;
 else
  select array_agg(distinct x) into ids from unnest(p_table_ids) x;
  if coalesce(cardinality(ids),0)=0 or exists(select 1 from unnest(ids) x where x is null or not exists(select 1 from public.floor_tables where id=x and location_id=p_location_id)) then raise exception 'Choose tables at this location.';end if;
 end if;
 if p_shift_id is not null then
  delete from public.server_assignments where shift_id=p_shift_id and table_id=any(ids);
  delete from public.shift_section_tables st using public.shift_sections ss where ss.id=st.shift_section_id and ss.shift_id=p_shift_id and st.table_id=any(ids);
  update public.shift_sections ss set assignment_status='cancelled' where ss.shift_id=p_shift_id and ss.assignment_status<>'cancelled' and not exists(select 1 from public.shift_section_tables st where st.shift_section_id=ss.id);
 end if;
 for plan in select * from public.floor_section_plans where location_id=p_location_id and cancelled_at is null and published_at is not null and starts_at<=now() and ends_at>now() and table_ids&&ids order by id for update loop
  select array_agg(x order by x) into remaining from unnest(plan.table_ids) x where not x=any(ids);
  if coalesce(cardinality(remaining),0)=0 then
   update public.floor_section_plans set cancelled_at=now(),version=version+1,updated_at=now() where id=plan.id;
  else
   update public.floor_section_plans set table_ids=remaining,version=version+1,updated_at=now() where id=plan.id;
   update public.floor_section_plans set published_at=plan.published_at where id=plan.id;
  end if;
 end loop;
 -- No table_sessions, guest details or seated-server assignments are changed.
end;$$;
revoke all on function public.floor_clear_section_assignments(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.floor_clear_section_assignments(uuid,uuid,uuid[]) to authenticated;

revoke all on function public.floor_assign_section_person(uuid,uuid,text,text,uuid,uuid[],text),public.floor_schedule_save_person(uuid,uuid,integer,text,uuid,uuid[],date,time,time,uuid,text) from public,anon,authenticated;
grant execute on function public.floor_assign_section_person(uuid,uuid,text,text,uuid,uuid[],text),public.floor_schedule_save_person(uuid,uuid,integer,text,uuid,uuid[],date,time,time,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
