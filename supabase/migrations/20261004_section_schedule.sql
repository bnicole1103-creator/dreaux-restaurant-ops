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

create or replace function public.floor_schedule_list(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'employee_id',p.employee_id,'name',p.name,'table_ids',p.table_ids,
  'starts_at',p.starts_at,'ends_at',p.ends_at,'version',p.version,
  'assignable',public.floor_schedule_member(p.location_id,p.employee_id)
 ) order by p.starts_at,p.name),'[]'::jsonb) into result
 from public.floor_section_plans p
 where p.location_id=p_location_id and p.cancelled_at is null
 and p.ends_at>now() and p.starts_at<now()+interval '366 days';
 return jsonb_build_object('can_manage',public.floor_schedule_can_manage(p_location_id),'plans',result,'server_now',now());
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
notify pgrst,'reload schema';
commit;
