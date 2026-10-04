begin;
create table if not exists public.floor_section_plans (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 employee_id uuid not null references public.profiles(id),
 name text not null,
 table_ids uuid[] not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 created_by uuid not null references public.profiles(id),
 request_id uuid not null,
 version integer not null default 1,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(location_id,request_id),
 check(cardinality(table_ids) between 1 and 100),
 check(ends_at>starts_at and ends_at<=starts_at+interval '18 hours')
);
create index if not exists floor_section_plans_window on public.floor_section_plans(location_id,starts_at,ends_at) where cancelled_at is null;
alter table public.floor_section_plans enable row level security;
revoke all on public.floor_section_plans from public,anon,authenticated;

create or replace function public.floor_schedule_member(p_location_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.location_memberships m join public.locations l on l.id=m.location_id join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active' where m.location_id=p_location_id and m.user_id=p_user_id and m.status='active');
$$;
revoke all on function public.floor_schedule_member(uuid,uuid) from public,anon,authenticated;

create or replace function public.floor_schedule_can_manage(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.closeout_is_member(p_location_id) is true and (
  public.mod_is_manager(p_location_id) is true or exists (
   select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=auth.uid() and m.status='active' and m.can_edit_floor
  )
 );
$$;

alter table public.floor_section_plans add column if not exists published_at timestamptz;

create or replace function public.floor_schedule_list(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;manager boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 manager:=public.floor_schedule_can_manage(p_location_id);
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'employee_id',p.employee_id,'name',p.name,'table_ids',p.table_ids,
  'starts_at',p.starts_at,'ends_at',p.ends_at,'version',p.version,'published_at',p.published_at,
  'assignable',public.floor_schedule_member(p.location_id,p.employee_id)
 ) order by p.starts_at,p.name),'[]'::jsonb) into result
 from public.floor_section_plans p
 where p.location_id=p_location_id and p.cancelled_at is null
 and (manager or p.published_at is not null)
 and p.ends_at>now() and p.starts_at<now()+interval '366 days';
 return jsonb_build_object('can_manage',manager,'plans',result,'server_now',now());
end;$$;

create or replace function public.floor_schedule_save(
 p_location_id uuid,p_id uuid,p_version integer,p_name text,p_employee_id uuid,
 p_table_ids uuid[],p_date date,p_start time,p_end time,p_request_id uuid
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
 if public.floor_schedule_member(p_location_id,p_employee_id) is not true then raise exception 'Choose an active employee at this location.';end if;
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
  insert into public.floor_section_plans(location_id,employee_id,name,table_ids,starts_at,ends_at,created_by,request_id)
  values(p_location_id,p_employee_id,btrim(p_name),ids,start_at,end_at,auth.uid(),p_request_id) returning id into result;
 else
  update public.floor_section_plans set employee_id=p_employee_id,name=btrim(p_name),table_ids=ids,starts_at=start_at,ends_at=end_at,version=version+1,updated_at=now()
  where id=p_id returning id into result;
 end if;
 return result;
end;$$;

create or replace function public.floor_schedule_cancel(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.floor_schedule_can_manage(p_location_id) is not true then raise exception 'Floor editing access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location_id::text,0));
 update public.floor_section_plans set cancelled_at=now(),version=version+1,updated_at=now() where id=p_id and location_id=p_location_id and version=p_version and cancelled_at is null;
 if not found then raise exception 'This planned section changed. Reload before removing.';end if;
end;$$;
revoke all on function public.floor_schedule_can_manage(uuid),public.floor_schedule_list(uuid),public.floor_schedule_save(uuid,uuid,integer,text,uuid,uuid[],date,time,time,uuid),public.floor_schedule_cancel(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.floor_schedule_list(uuid),public.floor_schedule_save(uuid,uuid,integer,text,uuid,uuid[],date,time,time,uuid),public.floor_schedule_cancel(uuid,uuid,integer) to authenticated;


-- Editing assignment details always requires publishing again.
create or replace function public.floor_schedule_draft_on_edit()
returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.employee_id,new.name,new.table_ids,new.starts_at,new.ends_at)
 is distinct from row(old.employee_id,old.name,old.table_ids,old.starts_at,old.ends_at)
 then new.published_at:=null;end if;
 return new;
end;$$;
drop trigger if exists floor_schedule_draft_on_edit on public.floor_section_plans;
create trigger floor_schedule_draft_on_edit before update on public.floor_section_plans
for each row execute function public.floor_schedule_draft_on_edit();
revoke all on function public.floor_schedule_draft_on_edit() from public,anon,authenticated;

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
  if plan.ends_at<=now() or public.floor_schedule_member(p_location_id,plan.employee_id) is not true then raise exception 'Choose an active employee and a current or future window.';end if;
  if (select count(*) from public.floor_tables where location_id=p_location_id and is_active and id=any(plan.table_ids))<>cardinality(plan.table_ids) then raise exception 'Choose active tables at this location.';end if;
 end if;
 update public.floor_section_plans set published_at=case when p_publish then now() else null end,version=version+1,updated_at=now() where id=p_id;
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
 select p.id,p.name,p.employee_id,p.starts_at,p.ends_at,p.table_ids
 from public.floor_section_plans p
 where p.location_id=p_location_id and p.cancelled_at is null and p.published_at is not null
 and public.floor_schedule_member(p.location_id,p.employee_id)
 and p.starts_at<window_end and p.ends_at>window_start
 union all
 select s.id,s.shift_name||' section',a.server_id,null::timestamptz,null::timestamptz,array_agg(distinct a.table_id order by a.table_id)
 from public.server_assignments a join public.shifts s on s.id=a.shift_id
 join public.floor_tables t on t.id=a.table_id and t.location_id=s.location_id
 where s.location_id=p_location_id and s.shift_date=p_date and s.status in ('scheduled','open','closed')
 and public.floor_schedule_member(s.location_id,a.server_id)
 and not exists(select 1 from public.floor_section_plans p where p.location_id=p_location_id and p.published_at is not null and p.cancelled_at is null and public.floor_schedule_member(p.location_id,p.employee_id) and now()>=window_start and now()<window_end and a.table_id=any(p.table_ids) and p.starts_at<=now() and p.ends_at>now())
 group by s.id,s.shift_name,a.server_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'employee_id',x.employee_id,
 'employee',coalesce(nullif(pr.preferred_name,''),nullif(pr.full_name,''),'Team member'),
 'starts_at',x.starts_at,'ends_at',x.ends_at,
 'tables',(select coalesce(string_agg(t.table_name,', ' order by t.table_name),'') from public.floor_tables t where t.location_id=p_location_id and t.id=any(x.table_ids))
 ) order by x.starts_at nulls last,x.name),'[]'::jsonb) into result
 from sections x left join public.profiles pr on pr.id=x.employee_id
 where not coalesce(p_only_me,false) or x.employee_id=auth.uid();
 return result;
end;$$;

create index if not exists preshift_posts_search_idx on public.preshift_posts
using gin(to_tsvector('simple',title||' '||body)) where deleted_at is null;
create or replace function public.preshift_archive(p_location_id uuid,p_query text default '',p_from date default null,p_to date default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;query tsquery;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if length(coalesce(p_query,''))>200 then raise exception 'Use up to 200 search characters.';end if;
 if p_from is not null and p_to is not null and p_from>p_to then raise exception 'Start date must come before end date.';end if;
 if coalesce(btrim(p_query),'')<>'' then query:=websearch_to_tsquery('simple',p_query);end if;
 with matches as (
 select t.id,t.title,t.body,t.shift_date,t.pinned,t.version,t.created_at,t.updated_at,t.presentation,t.media,
 coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Manager') as author
 from public.preshift_posts t left join public.profiles p on p.id=t.author_id
 where t.location_id=p_location_id and t.deleted_at is null
 and t.shift_date<((now() at time zone 'America/Chicago')-interval '4 hours')::date
 and (p_from is null or t.shift_date>=p_from) and (p_to is null or t.shift_date<=p_to)
 and (query is null or to_tsvector('simple',t.title||' '||t.body)@@query)
 )
 select jsonb_build_object('total',(select count(*) from matches),'posts',coalesce((select jsonb_agg(to_jsonb(q) order by q.shift_date desc,q.created_at desc,q.id) from (
 select * from matches order by shift_date desc,created_at desc,id limit 25 offset greatest(coalesce(p_offset,0),0)
 ) q),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.floor_schedule_publish(uuid,uuid,integer,boolean),public.floor_sections_for_day(uuid,date,boolean),public.preshift_archive(uuid,text,date,date,integer) from public,anon,authenticated;
grant execute on function public.floor_schedule_publish(uuid,uuid,integer,boolean),public.floor_sections_for_day(uuid,date,boolean),public.preshift_archive(uuid,text,date,date,integer) to authenticated;
notify pgrst,'reload schema';
commit;
