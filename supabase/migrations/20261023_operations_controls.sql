begin;
create table if not exists public.operations_controls (
 location_id uuid primary key references public.locations(id),version integer not null default 0,
 rules jsonb not null default '[]',updated_by uuid references public.profiles(id),updated_at timestamptz not null default now()
);
create table if not exists public.operations_controls_audit (
 id bigint generated always as identity primary key,location_id uuid not null,changed_by uuid not null,
 before_rules jsonb not null,after_rules jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.operations_inquiry_events (
 location_id uuid not null references public.locations(id),source text not null,source_id text not null,
 summary jsonb not null,received_at timestamptz not null default now(),primary key(location_id,source,source_id)
);
create table if not exists public.operations_alerts (
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),source text not null,source_id text not null,
 summary jsonb not null,created_at timestamptz not null default now(),read_at timestamptz,
 unique(location_id,user_id,source,source_id)
);
alter table public.staff_scheduled_shifts add column if not exists requires_quiz boolean not null default true;
alter table public.staff_schedule_days add column if not exists operations_auto boolean not null default false;
alter table public.staff_task_runs add column if not exists operations_auto boolean not null default false;
alter table public.operations_controls enable row level security;
alter table public.operations_controls_audit enable row level security;
alter table public.operations_inquiry_events enable row level security;
alter table public.operations_alerts enable row level security;
revoke all on public.operations_controls,public.operations_controls_audit,public.operations_inquiry_events,public.operations_alerts from public,anon,authenticated;
revoke all on sequence public.operations_controls_audit_id_seq from public,anon,authenticated;

-- Individual rules override groups; a group exclusion wins over group inclusion.
create or replace function staff_ops_private.control_match(l uuid,u uuid,k text,d date,job text,scheduled boolean,fallback boolean)
returns boolean language sql stable security definer set search_path='' as $$
 with person as (
 select m.role,coalesce(c.access_level,case when m.role in ('owner','general_manager') then m.role when m.role in ('manager','assistant_manager') then 'manager' else 'staff' end) access
 from public.location_memberships m left join public.closeout_permissions c on c.location_id=m.location_id and c.user_id=m.user_id
 where m.location_id=l and m.user_id=u and m.status='active'
 ), matched as (
 select r,case r->>'scope' when 'user' then 3 when 'all' then 1 else 2 end priority from public.operations_controls cfg
 cross join lateral jsonb_array_elements(cfg.rules) r cross join person p
 where cfg.location_id=l and r->>'event'=k and (r->>'starts_on')::date<=d
 and (r->'weekdays') @> to_jsonb(array[extract(dow from d)::integer])
 and (r->>'audience'='all' or scheduled)
 and (r->>'scope'='all' or (r->>'scope'='user' and r->>'target'=u::text)
 or (r->>'scope'='job' and trim(both '_' from regexp_replace(lower(r->>'target'),'[^a-z0-9]+','_','g'))=trim(both '_' from regexp_replace(lower(coalesce(nullif(job,''),p.role)),'[^a-z0-9]+','_','g')))
 or (r->>'scope'='access' and r->>'target'=p.access))
 ) select coalesce((select bool_and((r->>'enabled')::boolean) from matched where priority=(select max(priority) from matched)),fallback);
$$;
create or replace function public.operations_controls_load(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform push_private.require_gm(p_location_id);
 return jsonb_build_object('version',coalesce((select version from public.operations_controls where location_id=p_location_id),0),
 'rules',coalesce((select rules from public.operations_controls where location_id=p_location_id),'[]'::jsonb),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.preferred_name,''),p.full_name),'job',m.role)), '[]') from public.location_memberships m join public.profiles p on p.id=m.user_id where m.location_id=p_location_id and m.status='active'),
 'templates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'reviewed',reviewed)), '[]') from public.staff_task_templates where location_id=p_location_id and active),
 'today_status',jsonb_build_object('ready',coalesce((select valid from public.staff_schedule_days where location_id=p_location_id and business_date=((now() at time zone 'America/Chicago')-interval '4 hours')::date),false),'manual',coalesce((select not operations_auto from public.staff_schedule_days where location_id=p_location_id and business_date=((now() at time zone 'America/Chicago')-interval '4 hours')::date),false),'missing',(select count(*) from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) x where c.location_id=p_location_id and c.schedule_date=((now() at time zone 'America/Chicago')-interval '4 hours')::date and (x->>'assigned')::boolean is true and not (coalesce(public.closeout_is_member_for_tasks(p_location_id,nullif(x->>'user_id','')::uuid),false) or exists(select 1 from public.team_schedule_links t where t.location_id=p_location_id and t.employee_key=x->>'employee_key' and public.closeout_is_member_for_tasks(p_location_id,t.user_id))))),
 'schedule',(select jsonb_build_object('day',schedule_date,'synced_at',synced_at,'error',last_error) from public.home_schedule_cache where location_id=p_location_id order by schedule_date desc limit 1));
end;$$;
create or replace function public.operations_controls_save(p_location_id uuid,p_version integer,p_rules jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;prior jsonb;v integer;
begin
 perform push_private.require_gm(p_location_id);
 if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>200 then raise exception 'Use up to 200 rules.';end if;
 for r in select value from jsonb_array_elements(p_rules) loop
  if r->>'event' not in ('inquiries','preshift','quiz','tasks','reminders','stock','require_quiz','require_closeout') and not exists(select 1 from public.staff_task_templates t where t.location_id=p_location_id and 'task:'||t.id::text=r->>'event' and t.active and t.reviewed) then raise exception 'Choose an available alert or reviewed task preset.';end if;
  if r->>'event' is null or r->>'scope' is null or r->>'scope' not in ('all','job','access','user') or r->>'audience' is null or r->>'audience' not in ('scheduled','all') or jsonb_typeof(r->'enabled') is distinct from 'boolean' or jsonb_typeof(r->'weekdays') is distinct from 'array' or jsonb_array_length(r->'weekdays') not between 1 and 7 or coalesce(r->>'starts_on','')!~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Complete the rule and choose weekdays.';end if;
  if exists(select 1 from jsonb_array_elements_text(r->'weekdays') x where x!~ '^[0-6]$') then raise exception 'Invalid weekday.';end if;
  if r->>'scope'='user' and not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id::text=r->>'target' and status='active') then raise exception 'Choose an active employee.';end if;
  if r->>'scope'='access' and (r->>'target' is null or r->>'target' not in ('staff','manager','general_manager','owner')) then raise exception 'Invalid access level.';end if;
  if r->>'scope' in ('job','access','user') and coalesce(length(btrim(r->>'target')),0) not between 1 and 100 then raise exception 'Choose a target.';end if;
  if (r->>'starts_on')::date<((now() at time zone 'America/Chicago')-interval '4 hours')::date and not exists(select 1 from public.operations_controls c cross join lateral jsonb_array_elements(c.rules) old where c.location_id=p_location_id and old=r) then raise exception 'New or edited rules cannot start in the past.';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('operations-controls:'||p_location_id::text,0));
 select version,rules into v,prior from public.operations_controls where location_id=p_location_id;
 if coalesce(v,0) is distinct from p_version then raise exception 'Controls changed. Reload before saving.';end if;
 insert into public.operations_controls(location_id,version,rules,updated_by) values(p_location_id,p_version+1,p_rules,auth.uid())
 on conflict(location_id) do update set version=excluded.version,rules=excluded.rules,updated_by=auth.uid(),updated_at=now();
 insert into public.operations_controls_audit(location_id,changed_by,before_rules,after_rules) values(p_location_id,auth.uid(),coalesce(prior,'[]'),p_rules);
end;$$;

create or replace function staff_ops_private.recurring_match(l uuid,u uuid,k text,d date)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select bool_or(staff_ops_private.control_match(l,u,k,d,s.role_name,true,false)) from public.staff_scheduled_shifts s where s.location_id=l and s.business_date=d and s.user_id=u and s.shift_key not like 'offday:%'),staff_ops_private.control_match(l,u,k,d,null,false,false));
$$;
-- Fresh imported schedules build required work automatically. Explicit daily overrides win.
create or replace function staff_ops_private.apply_controls(l uuid,d date) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare cache public.home_schedule_cache;s jsonb;u uuid;owner_id uuid;r record;run_id uuid;due timestamptz;reviewed boolean;
begin
 if d<((now() at time zone 'America/Chicago')-interval '4 hours')::date or d>((now() at time zone 'America/Chicago')-interval '4 hours')::date+1 or not exists(select 1 from public.operations_controls where location_id=l) then return;end if;
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
-- Quiz sync honors the recurring exception on each shift.
create or replace function staff_ops_private.sync_quizzes(p_location uuid,p_day date) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 select confirmed_by into owner_id from public.staff_schedule_days where location_id=p_location and business_date=p_day;
 if owner_id is null or now()>=staff_ops_private.cutoff(p_day) then return;end if;
 delete from public.quiz_requirements r using public.daily_quizzes q where q.id=r.quiz_id and q.location_id=p_location and q.quiz_date=p_day
 and not exists(select 1 from public.staff_scheduled_shifts s where s.location_id=p_location and s.business_date=p_day and s.user_id=r.user_id and s.requires_quiz);
 insert into public.quiz_requirements(quiz_id,user_id,due_at,assigned_by)
 select q.id,s.user_id,staff_ops_private.cutoff(p_day),owner_id from public.daily_quizzes q join (select distinct user_id from public.staff_scheduled_shifts where location_id=p_location and business_date=p_day and requires_quiz) s on true
 where q.location_id=p_location and q.quiz_date=p_day and q.published on conflict(quiz_id,user_id) do nothing;
end;$$;
-- Wrap the existing tick once, preserving all existing points and reminder behavior.
do $$ begin
 if to_regprocedure('staff_ops_private.tick_before_controls()') is null then alter function public.staff_ops_tick() set schema staff_ops_private;alter function staff_ops_private.staff_ops_tick() rename to tick_before_controls;end if;
 if to_regprocedure('push_private.eligible_before_controls(public.push_queue,uuid)') is null then alter function push_private.eligible(public.push_queue,uuid) rename to eligible_before_controls;end if;
end $$;
create or replace function public.staff_ops_tick() returns void language plpgsql security definer set search_path='' as $$
declare r record;today date:=((now() at time zone 'America/Chicago')-interval '4 hours')::date;
begin
 for r in select location_id from public.operations_controls loop perform staff_ops_private.apply_controls(r.location_id,today);perform staff_ops_private.apply_controls(r.location_id,today+1);end loop;
 perform staff_ops_private.tick_before_controls();
end;$$;
-- Filter only exempt missed-quiz deductions; all other existing point rules remain intact.
do $$ begin
 if to_regprocedure('staff_ops_private.points_before_controls(uuid)') is null then alter function public.points_source_entries(uuid) set schema staff_ops_private;alter function staff_ops_private.points_source_entries(uuid) rename to points_before_controls;end if;
end $$;
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 select b.* from staff_ops_private.points_before_controls(p_location_id) b
 where not (b.entry_key like 'missed:%' and b.points<0 and exists(select 1 from public.staff_schedule_days d where d.location_id=p_location_id and d.business_date=b.business_date and (d.operations_auto or exists(select 1 from public.crew_schedule_overrides c where c.location_id=d.location_id and c.business_date=d.business_date and c.updated_at=d.confirmed_at)))
 and not exists(select 1 from public.staff_scheduled_shifts s where s.location_id=p_location_id and s.business_date=b.business_date and s.user_id=b.user_id and s.requires_quiz));
$$;
create or replace function push_private.eligible(q public.push_queue,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when q.category='inquiries' then push_private.member(q.location_id,u)
 and exists(select 1 from public.operations_alerts a where a.location_id=q.location_id and a.user_id=u and 'inquiry:'||a.source||':'||a.source_id=q.event_key)
 else push_private.eligible_before_controls(q,u) end
 and staff_ops_private.control_match(q.location_id,u,q.category,((q.available_at at time zone 'America/Chicago')-interval '4 hours')::date,
 (select role from public.location_memberships where location_id=q.location_id and user_id=u and status='active'),
 exists(select 1 from public.staff_scheduled_shifts where location_id=q.location_id and business_date=((q.available_at at time zone 'America/Chicago')-interval '4 hours')::date and user_id=u and shift_key not like 'offday:%'),true);
$$;
create or replace function public.operations_inquiry_ingest(p_location_id uuid,p_source text,p_id text,p_summary jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare person record;key text;day date:=((now() at time zone 'America/Chicago')-interval '4 hours')::date;clean jsonb;
begin
 if p_source not in ('Host','Guest form') or coalesce(length(p_id),0) not between 1 and 150 or octet_length(p_summary::text)>30000 then raise exception 'Invalid inquiry.';end if;
 clean:=jsonb_build_object('name',left(p_summary->>'name',200),'phone',left(p_summary->>'phone',100),'email',left(p_summary->>'email',320),'guests',left(p_summary->>'guests',20),'date',left(p_summary->>'date',40),'type',left(p_summary->>'type',100),'notes',left(p_summary->>'notes',2000));
 insert into public.operations_inquiry_events(location_id,source,source_id,summary) values(p_location_id,p_source,p_id,clean) on conflict do nothing;
 if not found then return;end if;
 key:='inquiry:'||p_source||':'||p_id;
 for person in select m.user_id,m.role,coalesce(c.access_level,case when m.role in ('owner','general_manager') then m.role when m.role in ('manager','assistant_manager') then 'manager' else 'staff' end) access from public.location_memberships m left join public.closeout_permissions c on c.location_id=m.location_id and c.user_id=m.user_id where m.location_id=p_location_id and m.status='active' and push_private.member(p_location_id,m.user_id) loop
  if not staff_ops_private.control_match(p_location_id,person.user_id,'inquiries',day,person.role,exists(select 1 from public.staff_scheduled_shifts where location_id=p_location_id and business_date=day and user_id=person.user_id and shift_key not like 'offday:%'),person.access in ('owner','general_manager','manager')) then continue;end if;
  insert into public.operations_alerts(location_id,user_id,source,source_id,summary) values(p_location_id,person.user_id,p_source,p_id,clean) on conflict do nothing;
  insert into public.push_queue(device_id,location_id,category,event_key,payload)
  select d.id,p_location_id,'inquiries',key,jsonb_build_object('title','New inquiry · '||coalesce(clean->>'type',p_source),'body',concat_ws(' · ',clean->>'name',(clean->>'guests')||' guests',clean->>'date',clean->>'phone',clean->>'email',left(clean->>'notes',200)),'url','/settings?view=alerts','tag',key)
  from public.push_devices d where d.user_id=person.user_id and exists(select 1 from public.push_preferences_config p where p.location_id=p_location_id and p.user_id=d.user_id) on conflict(device_id,event_key) do nothing;
 end loop;
end;$$;
create or replace function staff_ops_private.inquiry_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.operations_inquiry_ingest(new.location_id,'Host',new.id::text,jsonb_build_object('name',new.guest_name,'phone',new.phone,'email',new.email,'guests',new.party_size,'date',new.preferred_date,'type',new.inquiry_type,'notes',new.guest_notes));return new;
end;$$;
drop trigger if exists operations_inquiry_alert on public.reservation_inquiries;
create trigger operations_inquiry_alert after insert on public.reservation_inquiries for each row execute function staff_ops_private.inquiry_created();
create or replace function public.operations_alerts_load(p_location_id uuid,p_read_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not push_private.member(p_location_id,auth.uid()) then raise exception 'Location access required.' using errcode='42501';end if;
 if p_read_id is not null then update public.operations_alerts set read_at=coalesce(read_at,now()) where id=p_read_id and location_id=p_location_id and user_id=auth.uid();end if;
 return (select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc),'[]') from (select * from public.operations_alerts where location_id=p_location_id and user_id=auth.uid() order by created_at desc limit 200) a);
end;$$;
create or replace function public.operations_controls_apply(p_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform push_private.require_gm(p_location_id);perform staff_ops_private.apply_controls(p_location_id,((now() at time zone 'America/Chicago')-interval '4 hours')::date);perform staff_ops_private.apply_controls(p_location_id,((now() at time zone 'America/Chicago')-interval '4 hours')::date+1);end;$$;
create or replace function staff_ops_private.manual_day_marker() returns trigger language plpgsql set search_path='' as $$
begin if coalesce(current_setting('operations.auto_write',true),'off')<>'on' and (tg_op='INSERT' or new.confirmed_at is distinct from old.confirmed_at or new.schedule_snapshot is distinct from old.schedule_snapshot) then new.operations_auto:=false;end if;return new;end;$$;
drop trigger if exists operations_manual_day on public.staff_schedule_days;
create trigger operations_manual_day before insert or update on public.staff_schedule_days for each row execute function staff_ops_private.manual_day_marker();
create or replace function public.staff_my_obligations(p_location_id uuid,p_day date) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 return jsonb_build_object('confirmed',staff_ops_private.roster_ready(p_location_id,p_day),'cutoff',staff_ops_private.cutoff(p_day),
 'quiz_required',exists(select 1 from public.staff_scheduled_shifts where location_id=p_location_id and business_date=p_day and user_id=auth.uid() and requires_quiz),
 'shifts',coalesce((select jsonb_agg(jsonb_build_object('start',start_at,'role',role_name,'closeout_required',requires_closeout,'scheduled',shift_key not like 'offday:%')) from public.staff_scheduled_shifts where location_id=p_location_id and business_date=p_day and user_id=auth.uid()),'[]'),
 'penalties',jsonb_build_object('closeout',-10,'quiz',-10,'task_list',-5));
end;$$;
revoke all on function public.staff_my_obligations(uuid,date) from public,anon,authenticated;
grant execute on function public.staff_my_obligations(uuid,date) to authenticated;
revoke all on function public.points_source_entries(uuid) from public,anon,authenticated;
revoke all on function public.operations_controls_load(uuid),public.operations_controls_save(uuid,integer,jsonb),public.operations_alerts_load(uuid,uuid),public.operations_controls_apply(uuid),public.operations_inquiry_ingest(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.operations_controls_load(uuid),public.operations_controls_save(uuid,integer,jsonb),public.operations_alerts_load(uuid,uuid),public.operations_controls_apply(uuid) to authenticated;
grant execute on function public.operations_inquiry_ingest(uuid,text,text,jsonb),public.staff_ops_tick() to service_role;
revoke all on all functions in schema staff_ops_private from public,anon,authenticated;
revoke all on all functions in schema push_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
