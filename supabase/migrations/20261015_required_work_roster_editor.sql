begin;
create table if not exists public.staff_required_roster_reviews (
 location_id uuid not null references public.locations(id),
 business_date date not null,
 confirmed_at timestamptz not null,
 source_snapshot jsonb not null,
 primary key(location_id,business_date)
);
alter table public.staff_required_roster_reviews enable row level security;
revoke all on public.staff_required_roster_reviews from public,anon,authenticated;
do $$ begin
 if to_regprocedure('staff_ops_private.roster_before_manual(uuid,date)') is null then
  alter function staff_ops_private.roster_ready(uuid,date) rename to roster_before_manual;
 end if;
end $$;
create or replace function staff_ops_private.roster_ready(p_location uuid,p_day date)
returns boolean language sql stable security definer set search_path='' as $$
 select staff_ops_private.roster_before_manual(p_location,p_day) or exists (
  select 1 from public.staff_required_roster_reviews r
  join public.staff_schedule_days d on d.location_id=r.location_id and d.business_date=r.business_date
  left join public.home_schedule_cache c on c.location_id=r.location_id and c.schedule_date=r.business_date
  where r.location_id=p_location and r.business_date=p_day and d.valid
   and d.confirmed_at=r.confirmed_at
   and (now()>=staff_ops_private.cutoff(p_day)
        or r.source_snapshot=coalesce(c.rows,'null'::jsonb))
 );
$$;
create or replace function public.staff_required_roster_save(
 p_location_id uuid,p_day date,p_snapshot jsonb,p_rows jsonb,p_confirmed_at timestamptz
) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; uid uuid; start_value timestamptz; end_value timestamptz;
 snapshot_value jsonb; previous_at timestamptz; saved_at timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';
 end if;
 perform public.app_access_assert(p_location_id,'settings','forms');
 if p_day is null or now()>=staff_ops_private.cutoff(p_day) then
  raise exception 'Edit required work before the service day’s 4 AM deadline.';
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then
  raise exception 'Provide a roster of up to 200 shifts.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-schedule:'||p_location_id::text||p_day::text,0));
 select confirmed_at into previous_at from public.staff_schedule_days
 where location_id=p_location_id and business_date=p_day for update;
 if previous_at is distinct from p_confirmed_at then
  raise exception 'Another person updated this roster. Reload the page before saving.';
 end if;
 select rows into snapshot_value from public.home_schedule_cache
 where location_id=p_location_id and schedule_date=p_day for share;
 if coalesce(snapshot_value,'null'::jsonb) is distinct from coalesce(p_snapshot,'null'::jsonb) then
  raise exception 'The imported schedule changed. Reload and review the roster before saving.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x
  group by x->>'shift_key' having count(*)>1) then raise exception 'Duplicate shift identifier.'; end if;
 delete from public.staff_scheduled_shifts where location_id=p_location_id and business_date=p_day;
 for s in select value from jsonb_array_elements(p_rows) loop
  uid:=(s->>'user_id')::uuid;
  if uid is null or public.closeout_is_member_for_tasks(p_location_id,uid) is not true then
   raise exception 'Choose an active team member for every shift.';
  end if;
  if coalesce(length(s->>'shift_key'),0) not between 1 and 150
   or coalesce(length(btrim(s->>'role_name')),0) not between 1 and 100
   or coalesce(s->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(s->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or jsonb_typeof(s->'requires_closeout') is distinct from 'boolean' then
   raise exception 'Each shift needs a position, valid times, and closeout selection.';
  end if;
  start_value:=(p_day+(s->>'start_time')::time) at time zone 'America/Chicago';
  if (s->>'start_time')::time<time '04:00' then start_value:=((p_day+1)+(s->>'start_time')::time) at time zone 'America/Chicago';end if;
  end_value:=(p_day+(s->>'end_time')::time) at time zone 'America/Chicago';
  if end_value<start_value then end_value:=((p_day+1)+(s->>'end_time')::time) at time zone 'America/Chicago';end if;
  if end_value<=start_value or end_value>staff_ops_private.cutoff(p_day) then
   raise exception 'Shift times must fit within this service day, ending by 4 AM.';
  end if;
  insert into public.staff_scheduled_shifts(location_id,business_date,shift_key,user_id,start_at,end_at,role_name,requires_closeout)
  values(p_location_id,p_day,s->>'shift_key',uid,start_value,end_value,btrim(s->>'role_name'),(s->>'requires_closeout')::boolean);
 end loop;
 if exists(select 1 from public.staff_scheduled_shifts where location_id=p_location_id and business_date=p_day and requires_closeout
  group by user_id,(start_at at time zone 'America/Chicago')::time having count(*)>1) then
  raise exception 'One person cannot have two closeout shifts with the same start time.';
 end if;
 insert into public.staff_schedule_days(location_id,business_date,confirmed_by,confirmed_at,schedule_snapshot,valid)
 values(p_location_id,p_day,auth.uid(),saved_at,coalesce(snapshot_value,'[]'::jsonb),true)
 on conflict(location_id,business_date) do update set confirmed_by=excluded.confirmed_by,
 confirmed_at=excluded.confirmed_at,schedule_snapshot=excluded.schedule_snapshot,valid=true;
 insert into public.staff_required_roster_reviews values(p_location_id,p_day,saved_at,coalesce(snapshot_value,'null'::jsonb))
 on conflict(location_id,business_date) do update set confirmed_at=excluded.confirmed_at,source_snapshot=excluded.source_snapshot;
 perform staff_ops_private.sync_quizzes(p_location_id,p_day);
end;
$$;
revoke all on function staff_ops_private.roster_before_manual(uuid,date),staff_ops_private.roster_ready(uuid,date) from public,anon,authenticated;
revoke all on function public.staff_required_roster_save(uuid,date,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.staff_required_roster_save(uuid,date,jsonb,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
