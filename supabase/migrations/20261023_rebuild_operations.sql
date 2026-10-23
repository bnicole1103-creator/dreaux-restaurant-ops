begin;
create table if not exists rebuild_private.rollout(singleton boolean primary key default true check(singleton),effective_day date not null,effective_week date not null);
alter table rebuild_private.rollout enable row level security;
revoke all on rebuild_private.rollout from public,anon,authenticated;
insert into rebuild_private.rollout(singleton,effective_day,effective_week) values(true,((now() at time zone 'America/Chicago')-interval '4 hours')::date,public.mod_week_start(((now() at time zone 'America/Chicago')-interval '4 hours')::date)) on conflict do nothing;
create or replace function rebuild_private.schedule_confirmed(l uuid,d date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_schedule_days s join public.crew_schedule_overrides c on c.location_id=s.location_id and c.business_date=s.business_date and c.updated_at=s.confirmed_at where s.location_id=l and s.business_date=d and s.valid and not s.operations_auto);
$$;
do $$begin
 if to_regprocedure('rebuild_private.roster_ready_before_confirmed(uuid,date)') is null then
 alter function staff_ops_private.roster_ready(uuid,date) set schema rebuild_private;
 alter function rebuild_private.roster_ready(uuid,date) rename to roster_ready_before_confirmed;
 end if;
 if to_regprocedure('rebuild_private.targets_before_confirmed(uuid,date)') is null then
 alter function shift_context_private.target_day(uuid,date) set schema rebuild_private;
 alter function rebuild_private.target_day(uuid,date) rename to targets_before_confirmed;
 end if;
end;$$;
create or replace function staff_ops_private.roster_ready(p_location uuid,p_day date) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_day<(select effective_day from rebuild_private.rollout) then rebuild_private.roster_ready_before_confirmed(p_location,p_day) else rebuild_private.schedule_confirmed(p_location,p_day) end;
$$;
create or replace function shift_context_private.target_day(p_location uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_date>=(select effective_day from rebuild_private.rollout) and not rebuild_private.schedule_confirmed(p_location,p_date) and not exists(select 1 from public.closeout_target_days where location_id=p_location and target_date=p_date) then return jsonb_build_object('ready',false,'reason','Confirm the shared schedule before calculating targets.');end if;
 return rebuild_private.targets_before_confirmed(p_location,p_date);end;$$;

-- Preserve all award/high-rating/per-shift rules; replace only the weekly low-rating row.
do $$begin
 if to_regprocedure('rebuild_private.points_before_distinct(uuid)') is null then
 alter function public.points_source_entries(uuid) set schema rebuild_private;
 alter function rebuild_private.points_source_entries(uuid) rename to points_before_distinct;
 end if;
end;$$;
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 with first_per_manager as (
 select r.user_id,public.mod_week_start(s.shift_date) week_start,c.submitted_by,min(s.shift_date) as rating_day
 from public.mod_staff_reviews r join public.mod_closeouts c on c.shift_id=r.shift_id join public.shifts s on s.id=r.shift_id
 where s.location_id=p_location_id and r.rating between 3 and 4 and extract(dow from s.shift_date)<>1 and public.mod_week_start(s.shift_date)>=(select effective_week from rebuild_private.rollout)
 group by r.user_id,public.mod_week_start(s.shift_date),c.submitted_by
 ), ranked as (select *,row_number() over(partition by user_id,week_start order by rating_day,submitted_by) n from first_per_manager)
 select b.* from rebuild_private.points_before_distinct(p_location_id) b where (b.entry_key not like 'rating:week-low:%' or b.business_date<(select effective_week from rebuild_private.rollout))
 and not (b.business_date>=(select effective_day from rebuild_private.rollout) and (b.entry_key like 'missed:%' or b.entry_key like 'missed-closeout:%') and not rebuild_private.schedule_confirmed(p_location_id,b.business_date))
 union all
 select user_id,rating_day,'rating:week-low:'||week_start::text,-20,'Weekly performance adjustment'::text from ranked where n=2;
$$;
revoke all on function rebuild_private.points_before_distinct(uuid) from public,anon,authenticated;
-- Existing table permissions remain unchanged; this source is an internal scoring API.
revoke all on function public.points_source_entries(uuid) from public,anon,authenticated;
create or replace function staff_ops_private.apply_controls(l uuid,d date) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare cache public.home_schedule_cache;s jsonb;u uuid;owner_id uuid;r record;run_id uuid;due timestamptz;reviewed boolean;
begin
 if d<((now() at time zone 'America/Chicago')-interval '4 hours')::date or now()>=staff_ops_private.cutoff(d) or not exists(select 1 from public.operations_controls where location_id=l) then return;end if;
 if not exists(select 1 from public.crew_schedule_overrides c join public.staff_schedule_days sd on sd.location_id=c.location_id and sd.business_date=c.business_date where c.location_id=l and c.business_date=d and sd.valid and not sd.operations_auto and c.updated_at=sd.confirmed_at) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-schedule:'||l::text||d::text,0));
 select exists(select 1 from public.staff_schedule_days where location_id=l and business_date=d and valid and not operations_auto) into reviewed;
 if reviewed and not exists(select 1 from public.crew_schedule_overrides c join public.staff_schedule_days sd on sd.location_id=c.location_id and sd.business_date=c.business_date where c.location_id=l and c.business_date=d and c.updated_at=sd.confirmed_at) then return;end if;
 select updated_by into owner_id from public.operations_controls where location_id=l;
 if owner_id is null then return;end if;
 if reviewed then
  update public.staff_scheduled_shifts ss set
   requires_quiz=staff_ops_private.control_match(l,ss.user_id,'require_quiz',d,ss.role_name,true,true),
   requires_closeout=staff_ops_private.control_match(l,ss.user_id,'require_closeout',d,ss.role_name,true,coalesce((select (x->>'requires_closeout')::boolean from public.crew_schedule_overrides c cross join lateral jsonb_array_elements(c.rows) x where c.location_id=l and c.business_date=d and x->>'id'=ss.shift_key limit 1),ss.requires_closeout))
  where ss.location_id=l and ss.business_date=d and ss.shift_key not like 'offday:%';
 else
 select * into cache from public.home_schedule_cache where location_id=l and schedule_date=d;
 if cache.synced_at is null or cache.last_error is not null or cache.synced_at<now()-interval '24 hours' then update public.staff_schedule_days set valid=false where location_id=l and business_date=d and operations_auto;return;end if;
 -- Never silently penalize a scheduled employee whose account is not linked.
 if exists(select 1 from jsonb_array_elements(cache.rows) x where (x->>'assigned')::boolean is true and not (coalesce(public.closeout_is_member_for_tasks(l,nullif(x->>'user_id','')::uuid),false) or exists(select 1 from public.team_schedule_links t where t.location_id=l and (t.employee_key=x->>'employee_key' or t.user_id::text=x->>'user_id') and public.closeout_is_member_for_tasks(l,t.user_id)))) then update public.staff_schedule_days set valid=false where location_id=l and business_date=d and operations_auto;return;end if;
 select updated_by into owner_id from public.operations_controls where location_id=l;
 if owner_id is null then return;end if;
 perform set_config('operations.auto_write','on',true);
 delete from public.staff_scheduled_shifts where location_id=l and business_date=d;
 for s in select value from jsonb_array_elements(cache.rows) where (value->>'assigned')::boolean is true loop
  u:=nullif(s->>'user_id','')::uuid;if u is null then select user_id into u from public.team_schedule_links where location_id=l and employee_key=s->>'employee_key';end if;
  insert into public.staff_scheduled_shifts(location_id,business_date,shift_key,user_id,start_at,end_at,role_name,requires_closeout,requires_quiz)
  values(l,d,s->>'id',u,(s->>'start')::timestamptz,(s->>'end')::timestamptz,s->>'role',
  staff_ops_private.control_match(l,u,'require_closeout',d,s->>'role',true,lower(s->>'role') ~ 'server|bartender' or exists(select 1 from public.location_memberships m where m.location_id=l and m.user_id=u and m.role in ('server','bartender','main_bartender','back_bartender_1','back_bar_service_bartender'))),
  staff_ops_private.control_match(l,u,'require_quiz',d,s->>'role',true,true));
 end loop;
 insert into public.staff_schedule_days(location_id,business_date,confirmed_by,confirmed_at,schedule_snapshot,valid,operations_auto)
 values(l,d,owner_id,clock_timestamp(),cache.rows,true,true)
 on conflict(location_id,business_date) do update set confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,schedule_snapshot=excluded.schedule_snapshot,valid=true,operations_auto=true;
 perform set_config('operations.auto_write','off',true);
 end if;
 delete from public.staff_scheduled_shifts where location_id=l and business_date=d and shift_key like 'offday:%';
 -- Explicit all-days rules can assign quizzes to an off-day individual/group.
 insert into public.staff_scheduled_shifts(location_id,business_date,shift_key,user_id,start_at,end_at,role_name,requires_closeout,requires_quiz)
 select l,d,'offday:'||m.user_id,m.user_id,(d+time '04:00') at time zone 'America/Chicago',(d+time '04:00') at time zone 'America/Chicago',m.role,false,true
 from public.location_memberships m where m.location_id=l and m.status='active' and public.closeout_is_member_for_tasks(l,m.user_id)
 and not exists(select 1 from public.staff_scheduled_shifts x where x.location_id=l and x.business_date=d and x.user_id=m.user_id)
 and staff_ops_private.control_match(l,m.user_id,'require_quiz',d,m.role,false,false);
 perform staff_ops_private.sync_quizzes(l,d);
 -- Each template/day is one immutable task snapshot; refresh assignees until cutoff.
 for r in select t.* from public.staff_task_templates t where t.location_id=l and t.active and t.reviewed and (exists(select 1 from public.operations_controls c cross join lateral jsonb_array_elements(c.rules) x where c.location_id=l and x->>'event'='task:'||t.id::text) or exists(select 1 from public.staff_task_runs z where z.location_id=l and z.template_id=t.id and z.business_date=d and z.operations_auto)) loop
  due:=coalesce(public.staff_tasks_due_at(d,r.due_time),staff_ops_private.cutoff(d));
  if due<=now() then continue;end if;
  insert into public.staff_task_runs(location_id,template_id,business_date,title,position,phase,items,assigned_by,request_id,due_at,operations_auto)
  values(l,r.id,d,r.title,r.position,r.phase,r.items,owner_id,md5('operations:'||l||':'||d||':'||r.id)::uuid,due,true)
  on conflict(location_id,request_id) do nothing;
  select id into run_id from public.staff_task_runs where location_id=l and request_id=md5('operations:'||l||':'||d||':'||r.id)::uuid and cancelled_at is null;
  if run_id is null then continue;end if;
  update public.staff_task_assignees a set active=false where a.run_id=run_id and a.active and not staff_ops_private.recurring_match(l,a.user_id,'task:'||r.id,d);
  insert into public.staff_task_assignees(run_id,user_id)
  select run_id,m.user_id from public.location_memberships m where m.location_id=l and m.status='active' and public.closeout_is_member_for_tasks(l,m.user_id)
  and staff_ops_private.recurring_match(l,m.user_id,'task:'||r.id,d)
  on conflict on constraint staff_task_assignees_pkey do update set active=true;
 end loop;
end;$$;

create or replace function rebuild_private.confirmed_schedule_work()
returns trigger language plpgsql security definer set search_path='' as $$begin
 perform staff_ops_private.apply_controls(new.location_id,new.business_date);return new;end;$$;
drop trigger if exists z_rebuild_confirmed_schedule_work on public.staff_schedule_days;
create trigger z_rebuild_confirmed_schedule_work after insert or update on public.staff_schedule_days for each row when(new.valid and not new.operations_auto) execute function rebuild_private.confirmed_schedule_work();
-- Inspection status deliberately does not run jobs or claim a push was delivered.
create or replace function public.operations_connection_status(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$declare confirmed boolean;begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 confirmed:=exists(select 1 from public.staff_schedule_days d join public.crew_schedule_overrides c on c.location_id=d.location_id and c.business_date=d.business_date and c.updated_at=d.confirmed_at where d.location_id=p_location_id and d.business_date=p_day and d.valid and not d.operations_auto);
 return jsonb_build_object('confirmed',confirmed,'confirmed_at',(select confirmed_at from public.staff_schedule_days where location_id=p_location_id and business_date=p_day),
 'scheduled_shifts',(select count(*) from public.staff_scheduled_shifts where location_id=p_location_id and business_date=p_day and shift_key not like 'offday:%'),
 'quiz_requirements',(select count(*) from public.quiz_requirements a join public.daily_quizzes q on q.id=a.quiz_id where q.location_id=p_location_id and q.quiz_date=p_day),
 'task_runs',(select count(*) from public.staff_task_runs where location_id=p_location_id and business_date=p_day and cancelled_at is null),
 'targets_locked',exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_day),
 'notification_delivery','Unverified: inspect dispatch logs and an actual receiving device.');end;$$;
revoke all on function public.operations_connection_status(uuid,date) from public,anon,authenticated;
grant execute on function public.operations_connection_status(uuid,date) to authenticated;
revoke all on function staff_ops_private.roster_ready(uuid,date),shift_context_private.target_day(uuid,date) from public,anon,authenticated;
revoke all on all functions in schema rebuild_private from public,anon,authenticated;
notify pgrst,'reload schema';commit;
