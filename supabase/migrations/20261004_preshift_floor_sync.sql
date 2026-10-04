begin;

-- Manager editor reads the actual Floor assignments, including future drafts.
create or replace function public.preshift_sections_edit(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; employees jsonb; tables jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_date is null then raise exception 'Choose a date.';end if;
 with sections as (
  select 'plan'::text kind,p.id::text id,null::uuid shift_id,p.name,p.employee_id,p.table_ids,p.starts_at,p.ends_at,p.version,p.published_at
  from public.floor_section_plans p where p.location_id=p_location_id and p.cancelled_at is null
   and p.starts_at<(p_date+1+time '04:00') at time zone 'America/Chicago'
   and p.ends_at>(p_date+time '04:00') at time zone 'America/Chicago'
  union all
  select 'regular',s.id::text||':'||a.server_id::text,s.id,
   coalesce((select c.name from public.shift_sections ss join public.section_configurations c on c.id=ss.section_configuration_id
    where ss.shift_id=s.id and ss.employee_id=a.server_id and ss.assignment_status<>'cancelled'
    order by ss.id limit 1),s.shift_name||' section'),a.server_id,array_agg(a.table_id order by a.table_id),null,null,null,null
  from public.shifts s join public.server_assignments a on a.shift_id=s.id
  where s.location_id=p_location_id and s.shift_date=p_date and s.status in ('scheduled','open','closed')
  group by s.id,s.shift_name,a.server_id
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
  if coalesce(length(btrim(r->>'name')),0) not between 1 and 100 or public.floor_schedule_member(p_location_id,(r->>'employee_id')::uuid) is not true then raise exception 'Choose a section name and active employee.';end if;
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
   (e->>'name' is distinct from s->>'name' or e->>'employee_id' is distinct from s->>'employee_id' or e->'table_ids' is distinct from s->'table_ids')) loop
  delete from public.server_assignments where shift_id=sid;
  delete from public.shift_section_tables st using public.shift_sections ss where ss.id=st.shift_section_id and ss.shift_id=sid;
  update public.shift_sections set assignment_status='cancelled' where shift_id=sid and assignment_status<>'cancelled';
  for r in select e.value from jsonb_array_elements(p_sections) e join jsonb_array_elements(p_source) s on s->>'id'=e.value->>'id' where (s->>'shift_id')::uuid=sid loop
   select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'table_ids');
   perform public.floor_assign_section(p_location_id,sid,null,r->>'name',(r->>'employee_id')::uuid,ids);
  end loop;
 end loop;
 for r in select value from jsonb_array_elements(p_sections) loop
  select value into original from jsonb_array_elements(p_source) where value->>'id'=r->>'id';
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(r->'table_ids');
  if original->>'kind'='plan' then
   select * into plan from public.floor_section_plans where id=(original->>'id')::uuid;
   if (r->>'name' is distinct from original->>'name' or r->>'employee_id' is distinct from original->>'employee_id' or r->'table_ids' is distinct from original->'table_ids' or plan.published_at is null) then
   if plan.ends_at<=now() then raise exception 'This timed section has ended. Publish sections for a current or future shift.';end if;
   update public.floor_section_plans set name=btrim(r->>'name'),employee_id=(r->>'employee_id')::uuid,table_ids=ids,version=version+1,updated_at=now() where id=plan.id;
   perform public.floor_schedule_publish(p_location_id,plan.id,plan.version+1,true);
   end if;
  end if;
  select coalesce(nullif(preferred_name,''),nullif(full_name,''),'Team Member') into employee from public.profiles where id=(r->>'employee_id')::uuid;
  select string_agg(table_name,', ' order by table_name) into labels from public.floor_tables where id=any(ids);
  summary:=summary||case when summary='' then '' else E'\n\n' end||btrim(r->>'name')||' · '||coalesce(employee,'Team Member')||E'\nTables: '||labels;
  if original->>'kind'='plan' then summary:=summary||E'\n'||to_char((original->>'starts_at')::timestamptz at time zone 'America/Chicago','Mon DD, FMHH12:MI AM')||' – '||to_char((original->>'ends_at')::timestamptz at time zone 'America/Chicago','Mon DD, FMHH12:MI AM')||' CT';end if;
 end loop;
 pid:=public.preshift_post_save_full(p_location_id,p_id,p_version,p_title,p_body||case when summary='' then '' else E'\n\n── Sections ──\n'||summary end,p_shift_date,p_pinned,p_presentation,p_media);
 return pid;
end;$$;
revoke all on function public.preshift_sections_edit(uuid,date),public.preshift_post_save_sections(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.preshift_sections_edit(uuid,date),public.preshift_post_save_sections(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
