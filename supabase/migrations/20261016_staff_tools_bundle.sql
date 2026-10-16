begin;
do $$
declare obj text;
begin
 foreach obj in array array['public.locations','public.profiles','public.location_memberships','public.team_schedule_links','public.home_schedule_cache','public.sales_target_settings','public.sales_target_day_overrides','public.sales_target_weekday_totals','public.closeout_target_days','public.daily_closeouts','public.daily_quizzes','public.daily_quiz_attempts','public.staff_task_runs','public.staff_task_assignees','public.staff_task_checks'] loop
  if to_regclass(obj) is null then raise exception 'Required existing app table is missing: %. Stop and share this error.',obj;end if;
 end loop;
 foreach obj in array array['public.app_access_catalog()','public.app_access_allowed(uuid,text,text)','public.app_access_resource_allowed(uuid,text,text)','public.closeout_is_member(uuid)','public.closeout_is_gm(uuid)','public.mod_is_manager(uuid)','public.quiz_staff_load(uuid,date)','public.quiz_staff_submit(uuid,integer,jsonb)'] loop
  if to_regprocedure(obj) is null then raise exception 'Required existing app function is missing: %. Stop and share this error.',obj;end if;
 end loop;
 if to_regnamespace('shift_context_private') is null or to_regnamespace('post_workflow_private') is null then raise exception 'Existing automatic sales-target setup is missing. Stop and share this error.';end if;
end$$;
-- 20261016_sales_target_roster.sql
create table if not exists public.sales_target_rosters (
 location_id uuid not null references public.locations(id), target_date date not null,
 rows jsonb not null check(jsonb_typeof(rows)='array'), version integer not null default 1,
 updated_at timestamptz not null default now(), primary key(location_id,target_date)
);
alter table public.sales_target_rosters enable row level security;
revoke all on public.sales_target_rosters from public,anon,authenticated;

create or replace function public.sales_target_roster_load(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
 raise exception 'Manager access required.' using errcode='42501';end if;
 return jsonb_build_object('version',coalesce((select version from public.sales_target_rosters where location_id=p_location_id and target_date=p_date),0),
 'manual',exists(select 1 from public.sales_target_rosters where location_id=p_location_id and target_date=p_date),
 'locked',exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_date),
 'can_edit',public.closeout_is_gm(p_location_id),
 'rows',coalesce((select rows from public.sales_target_rosters where location_id=p_location_id and target_date=p_date),
 (select rows from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date),'[]'::jsonb),
 'role_groups',coalesce((select role_groups from public.sales_target_settings where location_id=p_location_id),'{}'::jsonb),
 'overrides',coalesce((select overrides from public.sales_target_day_overrides where location_id=p_location_id and target_date=p_date),'{}'::jsonb),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee'),
 'role',m.role,'employee_key',coalesce(l.employee_key,'app:'||p.id::text)) order by p.full_name,p.id)
 from public.location_memberships m join public.profiles p on p.id=m.user_id
 left join public.team_schedule_links l on l.location_id=m.location_id and l.user_id=m.user_id
 where m.location_id=p_location_id and m.status='active'),'[]'::jsonb));
end;$$;

create or replace function public.sales_target_roster_save(p_location_id uuid,p_date date,p_version integer,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;uid uuid;employee text;person text;hrs numeric;at_time timestamptz;v integer;
 saved jsonb:='[]'::jsonb;ov jsonb;key text;grp text;role_name text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then
 raise exception 'General manager access required.' using errcode='42501';end if;
 if p_date is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Choose a date and employee list.';end if;
 if jsonb_array_length(p_rows)>200 then raise exception 'Use at most 200 sales shifts.';end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location_id::text||':'||p_date::text,0));
 if exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_date) then
 raise exception 'Targets are locked by a submitted closeout. Choose an unlocked date.';end if;
 select version into v from public.sales_target_rosters where location_id=p_location_id and target_date=p_date for update;
 if coalesce(v,0) is distinct from p_version then raise exception 'The employee list changed. Reload before saving.';end if;
 insert into public.sales_target_settings(location_id) values(p_location_id) on conflict do nothing;
 perform 1 from public.sales_target_settings where location_id=p_location_id for update;
 select overrides into ov from public.sales_target_day_overrides where location_id=p_location_id and target_date=p_date;
 ov:=coalesce(ov,'{}'::jsonb);
 for r in select value from jsonb_array_elements(p_rows) loop
  uid:=nullif(r->>'user_id','')::uuid; key:=r->>'id';grp:=r->>'group';role_name:=btrim(r->>'role');
  if key is null or length(key) not between 1 and 200 or grp is null or grp not in ('bar','floor','exclude')
   or role_name is null or length(role_name) not between 1 and 100 then raise exception 'Choose employee, position, and pool for every row.';end if;
  if exists(select 1 from jsonb_array_elements(saved) x where x->>'id'=key) then raise exception 'Duplicate sales shift.';end if;
  select coalesce(l.employee_key,'app:'||p.id::text),coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee') into employee,person
  from public.location_memberships m join public.profiles p on p.id=m.user_id
  left join public.team_schedule_links l on l.location_id=m.location_id and l.user_id=m.user_id
  where m.location_id=p_location_id and m.user_id=uid and m.status='active';
  if not found then raise exception 'Choose an active employee at this location.';end if;
  if jsonb_typeof(r->'hours') is distinct from 'number' then raise exception 'Enter expected hours for every row.';end if;
  hrs:=(r->>'hours')::numeric;
  if hrs not between 0.01 and 24 or hrs::text in ('NaN','Infinity','-Infinity') then raise exception 'Expected hours must be greater than zero and at most 24.';end if;
  if nullif(r->>'start_time','') is null then raise exception 'Enter a start time.';end if;
  at_time:=(p_date+(r->>'start_time')::time) at time zone 'America/Chicago';
  saved:=saved||jsonb_build_array(jsonb_build_object('id',key,'user_id',uid,'employee_key',employee,'assigned',true,'name',person,
   'role',role_name,'station','','start',at_time,'end',at_time+hrs*interval '1 hour','close',false,'business_decline',false));
  ov:=ov||jsonb_build_object(key,jsonb_build_object('group',grp,'hours',hrs));
 end loop;
 select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into ov from jsonb_each(ov) e where exists(select 1 from jsonb_array_elements(saved) x where x->>'id'=e.key);
 insert into public.sales_target_rosters(location_id,target_date,rows) values(p_location_id,p_date,saved)
 on conflict(location_id,target_date) do update set rows=excluded.rows,version=sales_target_rosters.version+1,updated_at=clock_timestamp();
 insert into public.sales_target_day_overrides(location_id,target_date,overrides) values(p_location_id,p_date,ov)
 on conflict(location_id,target_date) do update set overrides=excluded.overrides;
 update public.sales_target_settings set version=version+1,updated_at=now() where location_id=p_location_id;
end;$$;
revoke all on function public.sales_target_roster_load(uuid,date),public.sales_target_roster_save(uuid,date,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sales_target_roster_load(uuid,date),public.sales_target_roster_save(uuid,date,integer,jsonb) to authenticated;
create or replace function shift_context_private.target_day(p_location uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.sales_target_settings%rowtype;cache public.home_schedule_cache%rowtype;overrides jsonb;
 total numeric;through_day date;team_cents bigint;bar_cents bigint;result jsonb;invalid integer;
begin
 select allocation into result from public.closeout_target_days where location_id=p_location and target_date=p_date;
 if found then return result;end if;
 select * into settings from public.sales_target_settings where location_id=p_location;
 if not found then return jsonb_build_object('ready',false,'reason','Sales target setup has not been saved.');end if;
 select max(through_date) into through_day from public.sales_target_weekday_totals where location_id=p_location and through_date<p_date;
 select net_sales_total into total from public.sales_target_weekday_totals where location_id=p_location and through_date=through_day and weekday=extract(dow from p_date)::integer;
 if total is null then return jsonb_build_object('ready',false,'reason','The six-week total for this weekday is missing.');end if;
 select r.rows,r.updated_at into cache.rows,cache.synced_at from public.sales_target_rosters r where r.location_id=p_location and r.target_date=p_date;
 if not found then
  select * into cache from public.home_schedule_cache where location_id=p_location and schedule_date=p_date;
 end if;
 if not found or cache.synced_at is null or cache.last_error is not null or jsonb_array_length(cache.rows)=0 then
 return jsonb_build_object('ready',false,'reason','A successful 7shifts schedule sync is needed for this date.');end if;
 select coalesce(d.overrides,'{}'::jsonb) into overrides from public.sales_target_day_overrides d where d.location_id=p_location and d.target_date=p_date;
 overrides:=coalesce(overrides,'{}'::jsonb);
 team_cents:=round(total/6*(1+settings.growth_percent/100)*100);bar_cents:=round(team_cents*settings.bar_percent/100);
 with raw as (
 select s,coalesce(overrides->(s->>'id')->>'group',settings.role_groups->>lower(btrim(s->>'role')),
 case when s->>'role' ~* '\mbartender\M' then 'bar' when s->>'role' ~* '\mserver\M' then 'floor' else 'exclude' end) grp
 from jsonb_array_elements(cache.rows) s), shifts as (
 select s,grp,case when overrides->(s->>'id')->>'hours' is not null then (overrides->(s->>'id')->>'hours')::numeric
 when coalesce((s->>'close')::boolean,false) or coalesce((s->>'business_decline')::boolean,false) then null
 else extract(epoch from (s->>'end')::timestamptz-(s->>'start')::timestamptz)/3600 end hrs from raw where grp<>'exclude')
 select count(*) into invalid from shifts where grp not in ('bar','floor') or coalesce((s->>'assigned')::boolean,false) is not true or nullif(s->>'employee_key','') is null
 or nullif(s->>'id','') is null or nullif(s->>'start','') is null or hrs is null or hrs<=0 or hrs>24;
 if invalid>0 then return jsonb_build_object('ready',false,'reason','Assign each sales shift to an employee and enter expected hours for Close or Business decline shifts in Sales Targets.');end if;
 with raw as (
 select s,coalesce(overrides->(s->>'id')->>'group',settings.role_groups->>lower(btrim(s->>'role')),
 case when s->>'role' ~* '\mbartender\M' then 'bar' when s->>'role' ~* '\mserver\M' then 'floor' else 'exclude' end) grp
 from jsonb_array_elements(cache.rows) s), shifts as (
 select s,grp,coalesce((overrides->(s->>'id')->>'hours')::numeric,extract(epoch from (s->>'end')::timestamptz-(s->>'start')::timestamptz)/3600) hrs from raw where grp in ('bar','floor')),
 people as (select s->>'employee_key' employee,grp,sum(hrs) hrs from shifts group by s->>'employee_key',grp),
 fractions as (select *,case when grp='bar' then bar_cents else team_cents-bar_cents end pool,
 (case when grp='bar' then bar_cents else team_cents-bar_cents end)*hrs/sum(hrs) over(partition by grp) raw_cents from people),
 ranked as (select *,row_number() over(partition by grp order by raw_cents-floor(raw_cents) desc,employee) rank from fractions),
 amounts as (select *,floor(raw_cents)+case when rank<=pool-sum(floor(raw_cents)) over(partition by grp) then 1 else 0 end cents from ranked),
 shift_fractions as (select s.s,s.grp,s.hrs,a.cents,a.employee,a.cents*s.hrs/a.hrs raw_shift from shifts s join amounts a on a.employee=s.s->>'employee_key' and a.grp=s.grp),
 shift_rank as (select *,row_number() over(partition by employee,grp order by raw_shift-floor(raw_shift) desc,s->>'id') rank from shift_fractions),
 allocated as (select *,floor(raw_shift)+case when rank<=cents-sum(floor(raw_shift)) over(partition by employee,grp) then 1 else 0 end shift_cents from shift_rank)
 select jsonb_build_object('ready',true,'date',p_date,'through_date',through_day,'weekday_total',total,'settings_version',settings.version,'schedule_synced_at',cache.synced_at,
 'team_target',team_cents/100.0,'bar_target',bar_cents/100.0,'floor_target',(team_cents-bar_cents)/100.0,
 'rows',coalesce(jsonb_agg(jsonb_build_object('shift_id',s->>'id','employee_key',employee,'group',grp,'start',s->>'start','hours',hrs,'target',shift_cents/100.0) order by s->>'id'),'[]'::jsonb)) into result from allocated;
 if (bar_cents>0 and not exists(select 1 from jsonb_array_elements(result->'rows') r where r->>'group'='bar')) or
 (team_cents-bar_cents>0 and not exists(select 1 from jsonb_array_elements(result->'rows') r where r->>'group'='floor')) then
 return jsonb_build_object('ready',false,'reason','Both sales pools need assigned staff with usable hours.');end if;
 return result;
end;$$;

create or replace function shift_context_private.target_for(p_location uuid,p_user uuid,p_date date,p_start time,p_role text,p_day jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee text;grp text;rows jsonb;amount numeric;
begin
 if (p_day->>'ready')::boolean is not true then return p_day-'rows';end if;
 select employee_key into employee from public.team_schedule_links where location_id=p_location and user_id=p_user;
 employee:=coalesce(employee,'app:'||p_user::text);
 if p_role='server' then grp:='floor';elsif p_role in ('main_bartender','back_bartender_1','back_bar_service_bartender') then grp:='bar';else
 return jsonb_build_object('ready',false,'reason','This role does not have a sales target.');end if;
 select jsonb_agg(r),sum((r->>'target')::numeric) into rows,amount from jsonb_array_elements(p_day->'rows') r
 where r->>'employee_key'=employee and ((r->>'start')::timestamptz at time zone 'America/Chicago')::time=p_start;
 if rows is null then return jsonb_build_object('ready',false,'reason','No matching sales shift was found. Check your scheduled start and role, or ask a manager to review your 7shifts link and allocation.');end if;
 return jsonb_build_object('ready',true,'date',p_date,'through_date',p_day->'through_date','settings_version',p_day->'settings_version','schedule_synced_at',p_day->'schedule_synced_at','target',amount,'employee_key',employee,'shifts',rows);
end;$$;
create or replace function post_workflow_private.named_targets(p_location uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=shift_context_private.target_day(p_location,p_date);
 if coalesce((result->>'ready')::boolean,false) then
  return result||jsonb_build_object('rows',coalesce((
   select jsonb_agg(r||jsonb_build_object('name',coalesce(
    (select coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''))
     from public.team_schedule_links l join public.profiles p on p.id=l.user_id
     where l.location_id=p_location and l.employee_key=r->>'employee_key' limit 1),
    (select nullif(s->>'name','') from public.sales_target_rosters c cross join lateral jsonb_array_elements(c.rows) s where c.location_id=p_location and c.target_date=p_date and s->>'employee_key'=r->>'employee_key' limit 1),
    (select nullif(s->>'name','') from public.home_schedule_cache c
     cross join lateral jsonb_array_elements(c.rows) s
     where c.location_id=p_location and c.schedule_date=p_date
      and s->>'employee_key'=r->>'employee_key' limit 1),
    'Employee '||(r->>'employee_key'))) order by ord)
   from jsonb_array_elements(result->'rows') with ordinality a(r,ord)
  ),'[]'::jsonb));
 end if;
 return result;
end;$$;
revoke all on function post_workflow_private.named_targets(uuid,date) from public,anon,authenticated;
create or replace function public.sales_targets_for_day(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
  or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_date is null then raise exception 'Choose a target date.';end if;
 return jsonb_build_object('allocation',post_workflow_private.named_targets(p_location_id,p_date),
  'locked',exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_date),
  'manual_roster',exists(select 1 from public.sales_target_rosters where location_id=p_location_id and target_date=p_date),
  'shifts',coalesce((select rows from public.sales_target_rosters where location_id=p_location_id and target_date=p_date),(select rows from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date),'[]'::jsonb),
  'synced_at',(select synced_at from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date));
end;$$;
revoke all on function public.sales_targets_for_day(uuid,date) from public,anon,authenticated;
grant execute on function public.sales_targets_for_day(uuid,date) to authenticated;
revoke all on function shift_context_private.target_day(uuid,date),shift_context_private.target_for(uuid,uuid,date,time,text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';


-- 20261016_crew_schedule_chat.sql
-- Extend the existing permission catalog without discarding prior customizations.
do $$ begin
 if to_regprocedure('public.app_access_catalog_before_crew()') is null then
  alter function public.app_access_catalog() rename to app_access_catalog_before_crew;
 end if;
 if to_regprocedure('public.app_access_resource_allowed_before_crew(uuid,text,text)') is null then
  alter function public.app_access_resource_allowed(uuid,text,text) rename to app_access_resource_allowed_before_crew;
 end if;
end $$;
create or replace function public.app_access_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select public.app_access_catalog_before_crew() || '{"schedule":["*","crew","chat","manage"]}'::jsonb;
$$;
create or replace function public.app_access_resource_allowed(p_location_id uuid,p_page text,p_section text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.app_access_resource_allowed_before_crew(p_location_id,p_page,p_section)
 or (p_page='floor' and p_section='schedule' and public.app_access_allowed(p_location_id,'schedule','crew'));
$$;
create table if not exists public.crew_moods (
 location_id uuid not null references public.locations(id), room_date date not null,
 user_id uuid not null references public.profiles(id),
 mood text not null default 'ready' check(mood in ('ready','happy','focused','tired','need-support')),
 thought text not null default '' check(length(thought)<=120), updated_at timestamptz not null default now(),
 primary key(location_id,room_date,user_id)
);
create table if not exists public.crew_photos (
 user_id uuid primary key references public.profiles(id),
 photo text not null check(length(photo)<=180000 and photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')
);
create table if not exists public.crew_messages (
 id bigint generated always as identity primary key,
 location_id uuid not null references public.locations(id), room_date date not null,
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
 unique(user_id,request_id)
);
create index if not exists crew_messages_room on public.crew_messages(location_id,room_date,id desc);
alter table public.crew_moods enable row level security;
alter table public.crew_photos enable row level security;
alter table public.crew_messages enable row level security;
revoke all on public.crew_moods,public.crew_photos,public.crew_messages from public,anon,authenticated;
revoke all on sequence public.crew_messages_id_seq from public,anon,authenticated;

create or replace function public.crew_room_access(p_location_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.closeout_is_member(p_location_id) is true
 and public.app_access_allowed(p_location_id,'schedule','crew') is true;
$$;
create or replace function public.crew_room_load(p_location_id uuid,p_date date,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare can_crew boolean;can_chat boolean;rows jsonb;messages jsonb;oldest bigint;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_date is null or abs(p_date-(now() at time zone 'America/Chicago')::date)>366 then raise exception 'Choose a date within one year.';end if;
 can_crew:=public.app_access_allowed(p_location_id,'schedule','crew');
 can_chat:=public.app_access_allowed(p_location_id,'schedule','chat');
 if not coalesce(can_crew,false) and not coalesce(can_chat,false) then raise exception 'Schedule page access required.' using errcode='42501';end if;
 if can_crew then
  select coalesce(jsonb_agg(s||jsonb_build_object('user_id',p.id,'photo',coalesce(a.photo,p.photo_url),'mood',m.mood,'thought',m.thought) order by s->>'start',s->>'name'),'[]'::jsonb) into rows
  from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) s
  left join public.team_schedule_links l on l.location_id=p_location_id and l.employee_key=s->>'employee_key'
  left join public.location_memberships lm on lm.location_id=p_location_id and lm.user_id=l.user_id and lm.status='active'
  left join public.profiles p on p.id=lm.user_id
  left join public.crew_photos a on a.user_id=p.id
  left join public.crew_moods m on m.location_id=p_location_id and m.room_date=p_date and m.user_id=p.id
  where c.location_id=p_location_id and c.schedule_date=p_date and coalesce((s->>'assigned')::boolean,false) is true;
 end if;
 if can_chat then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb),min(x.seq) into messages,oldest from (
   select c.id seq,c.id::text id,c.user_id,c.body,c.created_at,
    coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Staff member') name,
    coalesce(a.photo,p.photo_url) photo,
    (c.user_id=auth.uid() or public.mod_is_manager(p_location_id) is true) can_remove
   from public.crew_messages c join public.profiles p on p.id=c.user_id
   left join public.crew_photos a on a.user_id=p.id
   where c.location_id=p_location_id and c.room_date=p_date and c.deleted_at is null and (p_before is null or c.id<p_before)
   order by c.id desc limit 60
  ) x;
 end if;
 return jsonb_build_object('me',auth.uid(),'can_crew',can_crew,'can_chat',can_chat,
 'crew',coalesce(rows,'[]'::jsonb),'messages',coalesce(messages,'[]'::jsonb),
 'has_older',can_chat and exists(select 1 from public.crew_messages where location_id=p_location_id and room_date=p_date and deleted_at is null and id<oldest),
 'synced_at',case when can_crew then (select synced_at from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date) end,
 'schedule_error',case when can_crew then (select last_error from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date) end,
 'my_mood',case when can_crew then (select jsonb_build_object('mood',mood,'thought',thought) from public.crew_moods where location_id=p_location_id and room_date=p_date and user_id=auth.uid()) end,
 'my_photo',case when can_crew then coalesce((select photo from public.crew_photos where user_id=auth.uid()),(select photo_url from public.profiles where id=auth.uid())) end);
end;$$;
create or replace function public.crew_mood_save(p_location_id uuid,p_date date,p_mood text,p_thought text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.crew_room_access(p_location_id) is not true then raise exception 'Crew access required.' using errcode='42501';end if;
 if p_date is null or abs(p_date-(now() at time zone 'America/Chicago')::date)>366 or p_mood is null or p_mood not in ('ready','happy','focused','tired','need-support') or p_thought is null or length(p_thought)>120 then raise exception 'Choose a mood and a thought up to 120 characters.';end if;
 insert into public.crew_moods(location_id,room_date,user_id,mood,thought) values(p_location_id,p_date,auth.uid(),p_mood,btrim(p_thought))
 on conflict(location_id,room_date,user_id) do update set mood=excluded.mood,thought=excluded.thought,updated_at=clock_timestamp();
end;$$;
create or replace function public.crew_photo_save(p_location_id uuid,p_photo text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.crew_room_access(p_location_id) is not true then raise exception 'Crew access required.' using errcode='42501';end if;
 if p_photo is null then delete from public.crew_photos where user_id=auth.uid();return;end if;
 if length(p_photo)>180000 or p_photo!~'^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'Choose a valid JPG profile photo.';end if;
 insert into public.crew_photos(user_id,photo) values(auth.uid(),p_photo) on conflict(user_id) do update set photo=excluded.photo;
end;$$;
create or replace function public.crew_message_send(p_location_id uuid,p_date date,p_request uuid,p_body text)
returns text language plpgsql security definer set search_path='' as $$
declare saved public.crew_messages%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'schedule','chat') is not true then raise exception 'Chat access required.' using errcode='42501';end if;
 if p_date is null or abs(p_date-(now() at time zone 'America/Chicago')::date)>366 or p_request is null or p_body is null or length(btrim(p_body)) not between 1 and 2000 then raise exception 'Enter a message up to 2000 characters and a valid date.';end if;
 insert into public.crew_messages(location_id,room_date,user_id,request_id,body) values(p_location_id,p_date,auth.uid(),p_request,btrim(p_body))
 on conflict(user_id,request_id) do nothing;
 select * into saved from public.crew_messages where user_id=auth.uid() and request_id=p_request;
 if saved.location_id is distinct from p_location_id or saved.room_date is distinct from p_date or saved.body is distinct from btrim(p_body) then raise exception 'Message request changed. Start a new message.';end if;
 return saved.id::text;
end;$$;
create or replace function public.crew_message_remove(p_location_id uuid,p_id bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'schedule','chat') is not true then raise exception 'Chat access required.' using errcode='42501';end if;
 update public.crew_messages set deleted_at=clock_timestamp() where id=p_id and location_id=p_location_id and (user_id=auth.uid() or public.mod_is_manager(p_location_id) is true);
 if not found then raise exception 'You can remove your own messages; managers can moderate the room.';end if;
end;$$;
revoke all on function public.crew_room_access(uuid),public.crew_room_load(uuid,date,bigint),public.crew_mood_save(uuid,date,text,text),public.crew_photo_save(uuid,text),public.crew_message_send(uuid,date,uuid,text),public.crew_message_remove(uuid,bigint) from public,anon,authenticated;
grant execute on function public.crew_room_access(uuid),public.crew_room_load(uuid,date,bigint),public.crew_mood_save(uuid,date,text,text),public.crew_photo_save(uuid,text),public.crew_message_send(uuid,date,uuid,text),public.crew_message_remove(uuid,bigint) to authenticated;
notify pgrst,'reload schema';


-- 20261016_custom_reports.sql
do $$begin
 if to_regprocedure('public.app_access_catalog_before_reports()') is null then alter function public.app_access_catalog() rename to app_access_catalog_before_reports;end if;
end$$;
create or replace function public.app_access_catalog() returns jsonb language sql stable security definer set search_path='' as $$select public.app_access_catalog_before_reports()||'{"reports":["*","builder"]}'::jsonb$$;
create table if not exists public.custom_report_datasets(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 name text not null check(length(btrim(name)) between 1 and 160),rows jsonb not null,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create table if not exists public.custom_report_layouts(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 title text not null check(length(btrim(title)) between 1 and 160),
 source text not null check(source in ('closeouts','quizzes','tasks','import')),
 dataset_id uuid references public.custom_report_datasets(id),spec jsonb not null,
 version integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
alter table public.custom_report_datasets enable row level security;
alter table public.custom_report_layouts enable row level security;
revoke all on public.custom_report_datasets,public.custom_report_layouts from public,anon,authenticated;
create or replace function public.custom_report_access(p_location_id uuid) returns void language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true or public.app_access_allowed(p_location_id,'reports','builder') is not true then raise exception 'General manager report access required.' using errcode='42501';end if;
end$$;
create or replace function public.custom_report_library(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform public.custom_report_access(p_location_id);
 return jsonb_build_object('datasets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'count',jsonb_array_length(rows)) order by created_at desc) from public.custom_report_datasets where location_id=p_location_id),'[]'::jsonb),'reports',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc) from public.custom_report_layouts r where location_id=p_location_id),'[]'::jsonb));
end$$;
create or replace function public.custom_report_import(p_location_id uuid,p_name text,p_rows jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;r jsonb;cell record;keys text[];begin
 perform public.custom_report_access(p_location_id);
 if p_name is null or length(btrim(p_name)) not between 1 and 160 or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Enter an import name and a list of rows.';end if;
 if jsonb_array_length(p_rows) not between 1 and 5000 or octet_length(p_rows::text)>2000000 then raise exception 'Use 1–5,000 rows and no more than 2 MB of imported data.';end if;
 keys:=array[]::text[];
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'Each row must be an object.';end if;
  for cell in select key,value from jsonb_each(r) loop
   if length(btrim(cell.key)) not between 1 and 100 or cell.key in ('__proto__','constructor','prototype') or jsonb_typeof(cell.value) not in ('string','number','boolean','null') or (case when jsonb_typeof(cell.value)='string' then length(cell.value#>>'{}') else length(cell.value::text) end)>2000 then raise exception 'Use scalar cells and valid column names.';end if;
   if not(cell.key=any(keys)) then keys:=array_append(keys,cell.key);end if;
  end loop;
 end loop;
 if cardinality(keys) not between 1 and 50 then raise exception 'Use 1–50 columns.';end if;
 insert into public.custom_report_datasets(location_id,name,rows,created_by) values(p_location_id,btrim(p_name),p_rows,auth.uid()) returning id into result;return result;
end$$;
create or replace function public.custom_report_rows(p_location_id uuid,p_source text,p_dataset uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform public.custom_report_access(p_location_id);
 if p_source='import' then
  select rows into result from public.custom_report_datasets where id=p_dataset and location_id=p_location_id;
  if not found then raise exception 'Imported dataset not found at this location.';end if;
  return jsonb_build_object('rows',result,'limit',5000,'truncated',false);
 end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Select a date range of up to 367 days.';end if;
 if p_source='closeouts' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select c.closeout_date::text date,coalesce(nullif(p.preferred_name,''),p.full_name,'Employee') employee,c.job_role role,c.net_sales,c.sales_target,
    round(c.net_sales-c.sales_target,2) variance,case when c.sales_target>0 then round(c.net_sales/c.sales_target*100,2) end target_percent,
    to_jsonb(c)->>'submitted_at' submitted_at
   from public.daily_closeouts c left join public.profiles p on p.id=c.user_id where c.location_id=p_location_id and c.closeout_date between p_from and p_to and c.status='submitted' and c.deleted_at is null order by c.closeout_date,c.id limit 5001
  )x;
 elsif p_source='quizzes' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select q.quiz_date::text date,q.title quiz,coalesce(nullif(p.preferred_name,''),p.full_name,'Employee') employee,
    (a.result->>'score')::numeric correct,(a.result->>'total')::numeric total,(a.result->>'percent')::numeric percent,a.reward_points,a.submitted_at::text submitted_at
   from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id left join public.profiles p on p.id=a.user_id
   where q.location_id=p_location_id and q.quiz_date between p_from and p_to order by q.quiz_date,q.id,a.user_id limit 5001
  )x;
 elsif p_source='tasks' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select r.business_date::text date,r.title task,r.position,r.phase,coalesce(nullif(p.preferred_name,''),p.full_name,'Employee') employee,
    jsonb_array_length(r.items) total_items,(select count(*) from public.staff_task_checks c where c.run_id=r.id and c.user_id=a.user_id) completed_items,a.active
   from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id left join public.profiles p on p.id=a.user_id
   where r.location_id=p_location_id and r.business_date between p_from and p_to and r.cancelled_at is null order by r.business_date,r.id,a.user_id limit 5001
  )x;
 else raise exception 'Choose closeouts, quizzes, tasks or an imported dataset.';end if;
 return jsonb_build_object('rows',case when jsonb_array_length(result)>5000 then (select jsonb_agg(v order by n) from jsonb_array_elements(result) with ordinality x(v,n) where n<=5000) else result end,'limit',5000,'truncated',jsonb_array_length(result)>5000);
end$$;
create or replace function public.custom_report_save(p_location_id uuid,p_id uuid,p_version integer,p_title text,p_source text,p_dataset uuid,p_spec jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 perform public.custom_report_access(p_location_id);
 if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_source is null or p_source not in ('closeouts','quizzes','tasks','import') or jsonb_typeof(p_spec) is distinct from 'object' or octet_length(p_spec::text)>30000 then raise exception 'Enter a title, source and report layout.';end if;
 if p_source='import' and not exists(select 1 from public.custom_report_datasets where id=p_dataset and location_id=p_location_id) then raise exception 'Choose an imported dataset at this location.';end if;
 if p_id is null then
  insert into public.custom_report_layouts(location_id,title,source,dataset_id,spec,updated_by) values(p_location_id,btrim(p_title),p_source,case when p_source='import' then p_dataset end,p_spec,auth.uid()) returning id into result;
 else
  update public.custom_report_layouts set title=btrim(p_title),source=p_source,dataset_id=case when p_source='import' then p_dataset end,spec=p_spec,version=version+1,updated_by=auth.uid(),updated_at=now() where id=p_id and location_id=p_location_id and version=p_version returning id into result;
  if result is null then raise exception 'This report changed. Reopen it before saving.';end if;
 end if;
 return result;
end$$;
create or replace function public.custom_report_remove(p_location_id uuid,p_id uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.custom_report_access(p_location_id);delete from public.custom_report_layouts where id=p_id and location_id=p_location_id and version=p_version;if not found then raise exception 'Report changed. Reload before removing.';end if;
end$$;
create or replace function public.custom_report_dataset_remove(p_location_id uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.custom_report_access(p_location_id);if exists(select 1 from public.custom_report_layouts where dataset_id=p_id) then raise exception 'Remove saved reports using this dataset first.';end if;
 delete from public.custom_report_datasets where id=p_id and location_id=p_location_id;if not found then raise exception 'Dataset not found.';end if;
end$$;
revoke all on function public.custom_report_access(uuid),public.custom_report_library(uuid),public.custom_report_import(uuid,text,jsonb),public.custom_report_rows(uuid,text,uuid,date,date),public.custom_report_save(uuid,uuid,integer,text,text,uuid,jsonb),public.custom_report_remove(uuid,uuid,integer),public.custom_report_dataset_remove(uuid,uuid) from public,anon,authenticated;
grant execute on function public.custom_report_library(uuid),public.custom_report_import(uuid,text,jsonb),public.custom_report_rows(uuid,text,uuid,date,date),public.custom_report_save(uuid,uuid,integer,text,text,uuid,jsonb),public.custom_report_remove(uuid,uuid,integer),public.custom_report_dataset_remove(uuid,uuid) to authenticated;
notify pgrst,'reload schema';

-- 20261016_chat_wall_styles.sql
create or replace function public.crew_chat_style_valid(p_style jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_style)='object'
 and (select count(*) from jsonb_object_keys(p_style))=5
 and p_style->>'name_font' in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern','allura','greatvibes','parisienne','sacramento','dancing')
 and p_style->>'message_font' in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern','allura','greatvibes','parisienne','sacramento','dancing')
 and p_style->>'name_color' in ('espresso','berry','plum','navy','teal','rust','forest','black')
 and p_style->>'message_color' in ('espresso','berry','plum','navy','teal','rust','forest','black')
 and p_style->>'bubble_color' in ('cream','rose','lavender','sky','mint','gold'),false);
$$;
create table if not exists public.crew_chat_styles(
 location_id uuid not null references public.locations(id),user_id uuid not null references public.profiles(id),
 style jsonb not null check(public.crew_chat_style_valid(style)),updated_at timestamptz not null default now(),
 primary key(location_id,user_id)
);
alter table public.crew_chat_styles enable row level security;
revoke all on public.crew_chat_styles from public,anon,authenticated;
create or replace function public.crew_chat_style_default() returns jsonb language sql immutable set search_path='' as $$
 select '{"name_font":"system","name_color":"espresso","message_font":"system","message_color":"espresso","bubble_color":"cream"}'::jsonb;
$$;
create or replace function public.crew_chat_style_load(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'schedule','chat') is not true then raise exception 'Chat access required.' using errcode='42501';end if;
 return jsonb_build_object('full_name',(select btrim(full_name) from public.profiles where id=auth.uid()),'style',coalesce((select style from public.crew_chat_styles where location_id=p_location_id and user_id=auth.uid()),public.crew_chat_style_default()));
end;$$;
create or replace function public.crew_chat_style_save(p_location_id uuid,p_style jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'schedule','chat') is not true then raise exception 'Chat access required.' using errcode='42501';end if;
 if public.crew_chat_style_valid(p_style) is not true then raise exception 'Choose supported fonts and colors only. Names and other profile fields cannot be changed here.';end if;
 insert into public.crew_chat_styles(location_id,user_id,style) values(p_location_id,auth.uid(),p_style)
 on conflict(location_id,user_id) do update set style=excluded.style,updated_at=clock_timestamp();
end;$$;
create or replace function public.crew_chat_full_name_required() returns trigger language plpgsql security definer set search_path='' as $$
declare full_name text;begin
 select btrim(p.full_name) into full_name from public.profiles p where p.id=new.user_id;
 if coalesce(full_name,'')!~'\S+\s+\S+' then raise exception 'Your team profile needs your first and last name before you can post. Ask management to update it.';end if;
 return new;
end;$$;
drop trigger if exists crew_chat_full_name_required on public.crew_messages;
create trigger crew_chat_full_name_required before insert on public.crew_messages for each row execute function public.crew_chat_full_name_required();
do $$begin
 if to_regprocedure('public.crew_room_load_before_styles(uuid,date,bigint)') is null then alter function public.crew_room_load(uuid,date,bigint) rename to crew_room_load_before_styles;end if;
end$$;
create or replace function public.crew_room_load(p_location_id uuid,p_date date,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;messages jsonb;crew jsonb;my_name text;begin
 result:=public.crew_room_load_before_styles(p_location_id,p_date,p_before);
 if coalesce((result->>'can_crew')::boolean,false) then
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when p.id is null then m->>'name' when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end) order by ord),'[]'::jsonb)
  into crew from jsonb_array_elements(result->'crew') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid;
  result:=result||jsonb_build_object('crew',crew);
 end if;

 if coalesce((result->>'can_chat')::boolean,false) then
  select btrim(full_name) into my_name from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(m||jsonb_build_object('name',case when btrim(coalesce(p.full_name,''))~'\S+\s+\S+' then btrim(p.full_name) else 'Profile name needs updating' end,'wall_style',coalesce(s.style,public.crew_chat_style_default())) order by ord),'[]'::jsonb)
  into messages from jsonb_array_elements(result->'messages') with ordinality x(m,ord)
  left join public.profiles p on p.id=(m->>'user_id')::uuid
  left join public.crew_chat_styles s on s.location_id=p_location_id and s.user_id=p.id;
  result:=result||jsonb_build_object('messages',messages,'chat_full_name',my_name,'chat_name_ready',coalesce(my_name~'\S+\s+\S+',false));
 end if;
 return result;
end;$$;
revoke all on function public.crew_room_load_before_styles(uuid,date,bigint),public.crew_chat_full_name_required() from public,anon,authenticated;
revoke all on function public.crew_chat_style_load(uuid),public.crew_chat_style_save(uuid,jsonb),public.crew_room_load(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.crew_chat_style_load(uuid),public.crew_chat_style_save(uuid,jsonb),public.crew_room_load(uuid,date,bigint) to authenticated;
notify pgrst,'reload schema';
create or replace function public.app_access_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select public.app_access_catalog_before_crew()
 || public.app_access_catalog_before_reports()
 || '{"schedule":["*","crew","chat","manage"],"reports":["*","builder"]}'::jsonb;
$$;
notify pgrst,'reload schema';

-- Management edits and approved coverage transfers
create schema if not exists crew_ops_private;
revoke all on schema crew_ops_private from public,anon,authenticated;
do $$declare obj text;begin
 foreach obj in array array['public.staff_scheduled_shifts','public.staff_schedule_days','public.staff_required_roster_reviews','public.floor_section_plans','public.shift_sections','public.server_assignments','public.disposal_requirements'] loop
  if to_regclass(obj) is null then raise exception 'Coverage prerequisite is missing: %',obj;end if;
 end loop;
 if to_regprocedure('staff_ops_private.sync_quizzes(uuid,date)') is null or to_regprocedure('staff_ops_private.cutoff(date)') is null then raise exception 'Install the confirmed Required Work engine before coverage.';end if;
end$$;
create table if not exists public.crew_schedule_overrides(
 location_id uuid not null references public.locations(id),business_date date not null,
 rows jsonb not null check(jsonb_typeof(rows)='array'),upstream_rows jsonb,upstream_error text,
 version integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp(),
 primary key(location_id,business_date)
);
create table if not exists public.crew_coverage_requests(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),business_date date not null,
 original_user uuid not null references public.profiles(id),cover_user uuid not null references public.profiles(id),
 requested_by uuid not null references public.profiles(id),request_id uuid not null, snapshot jsonb not null,
 note text not null default '' check(length(note)<=500),status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,created_at timestamptz not null default clock_timestamp(),impact jsonb,
 check(original_user<>cover_user),unique(requested_by,request_id)
);
create table if not exists public.crew_schedule_audit(
 id bigint generated always as identity primary key,location_id uuid not null,business_date date not null,
 actor uuid not null,request_id uuid,kind text not null,before_rows jsonb not null,after_rows jsonb not null,impact jsonb,created_at timestamptz not null default clock_timestamp()
);
alter table public.crew_schedule_overrides enable row level security;
alter table public.crew_coverage_requests enable row level security;
alter table public.crew_schedule_audit enable row level security;
revoke all on public.crew_schedule_overrides,public.crew_coverage_requests,public.crew_schedule_audit from public,anon,authenticated;
revoke all on sequence public.crew_schedule_audit_id_seq from public,anon,authenticated;
create or replace function public.app_access_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select public.app_access_catalog_before_crew()||public.app_access_catalog_before_reports()
 ||'{"schedule":["*","crew","chat","manage"],"reports":["*","builder"]}'::jsonb;
$$;
create or replace function crew_ops_private.manager(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.closeout_is_member(p_location) is true and public.mod_is_manager(p_location) is true and public.app_access_allowed(p_location,'schedule','manage') is true;
$$;
create or replace function crew_ops_private.day_rows(p_location uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if staff_ops_private.roster_ready(p_location,p_day) then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.shift_key,'user_id',s.user_id,'employee_key',coalesce(l.employee_key,'app:'||s.user_id::text),'name',coalesce(nullif(p.full_name,''),'Employee'),'role',s.role_name,'station','','start',s.start_at,'end',s.end_at,'close',false,'business_decline',false,'assigned',true,'requires_closeout',s.requires_closeout) order by s.start_at,s.shift_key),'[]'::jsonb) into result
  from public.staff_scheduled_shifts s join public.profiles p on p.id=s.user_id left join public.team_schedule_links l on l.location_id=s.location_id and l.user_id=s.user_id
  where s.location_id=p_location and s.business_date=p_day;
  return result;
 end if;
 select rows into result from public.crew_schedule_overrides where location_id=p_location and business_date=p_day;
 if found then return result;end if;
 select coalesce(jsonb_agg(s||jsonb_build_object('user_id',p.id,'name',coalesce(nullif(p.full_name,''),s->>'name'),'requires_closeout',case when s ? 'requires_closeout' then (s->>'requires_closeout')::boolean else s->>'role' ~* '(server|bartender)' end) order by s->>'start',s->>'id'),'[]'::jsonb) into result
 from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) s
 left join public.team_schedule_links l on l.location_id=p_location and l.employee_key=s->>'employee_key'
 left join public.location_memberships m on m.location_id=p_location and m.user_id=coalesce(nullif(s->>'user_id','')::uuid,l.user_id) and m.status='active'
 left join public.profiles p on p.id=m.user_id
 where c.location_id=p_location and c.schedule_date=p_day and (s->>'assigned')::boolean is true;
 return coalesce(result,'[]'::jsonb);
end$$;
create or replace function crew_ops_private.keep_override() returns trigger language plpgsql security definer set search_path='' as $$
declare saved jsonb;begin
 select rows into saved from public.crew_schedule_overrides where location_id=new.location_id and business_date=new.schedule_date;
 if found then
  if coalesce(current_setting('crew_ops.local_apply',true),'')<>'on' then update public.crew_schedule_overrides set upstream_rows=new.rows,upstream_error=new.last_error where location_id=new.location_id and business_date=new.schedule_date;end if;
  new.rows:=saved;new.last_error:=null;
 end if;
 return new;
end$$;
drop trigger if exists aa_crew_schedule_override on public.home_schedule_cache;
create trigger aa_crew_schedule_override before insert or update on public.home_schedule_cache for each row execute function crew_ops_private.keep_override();
-- Normalize manager input using the same 4 AM service-day boundaries as Required Work.
create or replace function crew_ops_private.canonical(p_location uuid,p_day date,p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;uid uuid;at_start timestamptz;at_end timestamptz;name text;employee text;result jsonb:='[]';begin
 if p_day is null or now()>=staff_ops_private.cutoff(p_day) or p_day>((now() at time zone 'America/Chicago')::date+366) then raise exception 'Choose an open service day within one year; past 4 AM deadlines cannot be changed here.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then raise exception 'Use up to 200 shifts.';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  uid:=nullif(r->>'user_id','')::uuid;
  if uid is null or public.closeout_is_member_for_tasks(p_location,uid) is not true then raise exception 'Link every shift to an active app employee before saving or approving coverage.';end if;
  if coalesce(length(r->>'id'),0) not between 1 and 150 or coalesce(length(btrim(r->>'role')),0) not between 1 and 100 or jsonb_typeof(r->'requires_closeout') is distinct from 'boolean' then raise exception 'Each shift needs an ID, position and closeout setting.';end if;
  if exists(select 1 from jsonb_array_elements(result) x where x->>'id'=r->>'id') then raise exception 'Duplicate shift ID.';end if;
  if r ? 'start_time' then
   if coalesce(r->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(r->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter valid start and end times.';end if;
   at_start:=((p_day+case when (r->>'start_time')::time<time '04:00' then 1 else 0 end)+(r->>'start_time')::time) at time zone 'America/Chicago';
   at_end:=((p_day+case when (r->>'end_time')::time<time '04:00' then 1 else 0 end)+(r->>'end_time')::time) at time zone 'America/Chicago';
   if at_end<at_start then at_end:=at_end+interval '1 day';end if;
  else at_start:=(r->>'start')::timestamptz;at_end:=(r->>'end')::timestamptz;end if;
  if at_start is null or at_end is null or at_start<((p_day+time '04:00') at time zone 'America/Chicago') or at_end>staff_ops_private.cutoff(p_day) or at_end<=at_start or at_end>at_start+interval '24 hours' then raise exception 'Use real start/end times within this service day (4 AM to 4 AM).';end if;
  select btrim(p.full_name),coalesce(l.employee_key,'app:'||uid::text) into name,employee from public.profiles p left join public.team_schedule_links l on l.location_id=p_location and l.user_id=p.id where p.id=uid;
  result:=result||jsonb_build_array(jsonb_build_object('id',r->>'id','user_id',uid,'employee_key',employee,'assigned',true,'name',name,'role',btrim(r->>'role'),'station',coalesce(r->>'station',''),'start',at_start,'end',at_end,'close',false,'business_decline',false,'requires_closeout',(r->>'requires_closeout')::boolean));
 end loop;
 if exists(select 1 from jsonb_array_elements(result) a join jsonb_array_elements(result) b on a->>'id'<b->>'id' and a->>'user_id'=b->>'user_id' and (a->>'start')::timestamptz<(b->>'end')::timestamptz and (b->>'start')::timestamptz<(a->>'end')::timestamptz) then raise exception 'One employee cannot work overlapping shifts. Choose another replacement or correct the hours.';end if;
 return result;
end$$;
-- Remaining task items become a new snapshot; completed checks remain under their actual author.
create or replace function crew_ops_private.transfer_work(p_location uuid,p_day date,p_old uuid,p_new uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare task record;remaining jsonb;new_run uuid;plan record;due timestamptz;tasks integer:=0;sections integer:=0;disposals integer:=0;begin
 if exists(select 1 from public.daily_closeouts where location_id=p_location and closeout_date=p_day and user_id=p_old and status='submitted' and deleted_at is null) then raise exception 'This employee already submitted a closeout for the day. Review/correct that record before changing their coverage.';end if;
 for task in select r.*,a.version assignment_version from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.location_id=p_location and r.business_date=p_day and r.cancelled_at is null and a.user_id=p_old and a.active order by r.id for update of r,a loop
  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb) into remaining from jsonb_array_elements(task.items) with ordinality x(item,ord) where not exists(select 1 from public.staff_task_checks c where c.run_id=task.id and c.user_id=p_old and c.item_index=ord-1);
  if jsonb_array_length(remaining)=0 then continue;end if;
  update public.staff_task_assignees set active=false,version=version+1 where run_id=task.id and user_id=p_old;
  if p_new is not null and not exists(select 1 from public.staff_task_assignees where run_id=task.id and user_id=p_new and active) then
   due:=least(staff_ops_private.cutoff(p_day),greatest(coalesce(task.due_at,staff_ops_private.cutoff(p_day)),clock_timestamp()+interval '30 minutes'));
   insert into public.staff_task_runs(location_id,template_id,business_date,shift_label,title,position,phase,items,assigned_by,request_id,due_at)
   values(p_location,task.template_id,p_day,task.shift_label,left(task.title,180)||' · Coverage',task.position,task.phase,remaining,auth.uid(),gen_random_uuid(),due) returning id into new_run;
   insert into public.staff_task_assignees(run_id,user_id) values(new_run,p_new);
  end if;
  tasks:=tasks+1;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('floor-schedule:'||p_location::text,0));
 for plan in select * from public.floor_section_plans where location_id=p_location and employee_id=p_old and cancelled_at is null and starts_at>=((p_day+time '04:00') at time zone 'America/Chicago') and starts_at<staff_ops_private.cutoff(p_day) and ends_at>now() order by id for update loop
  if p_new is null then update public.floor_section_plans set cancelled_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=plan.id;
  else
   update public.floor_section_plans set employee_id=p_new,guest_name=null,version=version+1,updated_at=clock_timestamp() where id=plan.id;
   update public.floor_section_plans set published_at=plan.published_at where id=plan.id;
  end if;
  sections:=sections+1;
 end loop;
 if p_new is null then
  update public.shift_sections ss set assignment_status='cancelled' from public.shifts s where ss.shift_id=s.id and s.location_id=p_location and s.shift_date=p_day and s.status in ('scheduled','open') and ss.employee_id=p_old and ss.assignment_status<>'cancelled';
  delete from public.server_assignments a using public.shifts s where a.shift_id=s.id and s.location_id=p_location and s.shift_date=p_day and s.status in ('scheduled','open') and a.server_id=p_old;
 else
  update public.shift_sections ss set employee_id=p_new,assigned_by=auth.uid() from public.shifts s where ss.shift_id=s.id and s.location_id=p_location and s.shift_date=p_day and s.status in ('scheduled','open') and ss.employee_id=p_old and ss.assignment_status<>'cancelled';
  update public.server_assignments a set server_id=p_new,assigned_by=auth.uid(),assigned_at=clock_timestamp() from public.shifts s where a.shift_id=s.id and s.location_id=p_location and s.shift_date=p_day and s.status in ('scheduled','open') and a.server_id=p_old;
 end if;
 if exists(select 1 from public.disposal_requirements where location_id=p_location and business_date=p_day and user_id=p_old and active) and staff_ops_private.disposal_completed(p_location,p_day,p_old) is not true then
  update public.disposal_requirements set active=false,updated_by=auth.uid(),updated_at=clock_timestamp() where location_id=p_location and business_date=p_day and user_id=p_old;
  if p_new is not null then
   insert into public.disposal_requirements(location_id,business_date,user_id,assigned_by,updated_by,active) values(p_location,p_day,p_new,auth.uid(),auth.uid(),true)
   on conflict(location_id,business_date,user_id) do update set active=true,updated_by=auth.uid(),updated_at=clock_timestamp(),assigned_at=case when disposal_requirements.active then disposal_requirements.assigned_at else clock_timestamp() end;
  end if;disposals:=1;
 end if;
 return jsonb_build_object('task_lists',tasks,'section_plans',sections,'disposal_assignments',disposals);
end$$;
create or replace function crew_ops_private.apply_day(p_location uuid,p_day date,p_rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare saved_at timestamptz:=clock_timestamp();r jsonb;ov jsonb;old_flag text;begin
 select coalesce(overrides,'{}'::jsonb) into ov from public.sales_target_day_overrides where location_id=p_location and target_date=p_day;ov:=coalesce(ov,'{}');
 insert into public.crew_schedule_overrides(location_id,business_date,rows,upstream_rows,updated_by,updated_at)
 values(p_location,p_day,p_rows,(select rows from public.home_schedule_cache where location_id=p_location and schedule_date=p_day),auth.uid(),saved_at)
 on conflict(location_id,business_date) do update set rows=excluded.rows,version=crew_schedule_overrides.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 old_flag:=current_setting('crew_ops.local_apply',true);perform set_config('crew_ops.local_apply','on',true);
 insert into public.home_schedule_cache(location_id,schedule_date,rows,synced_at,last_error) values(p_location,p_day,p_rows,saved_at,null)
 on conflict(location_id,schedule_date) do update set rows=excluded.rows,synced_at=excluded.synced_at,last_error=null;
 perform set_config('crew_ops.local_apply',coalesce(old_flag,''),true);
 delete from public.staff_scheduled_shifts where location_id=p_location and business_date=p_day;
 for r in select value from jsonb_array_elements(p_rows) loop
  insert into public.staff_scheduled_shifts(location_id,business_date,shift_key,user_id,start_at,end_at,role_name,requires_closeout)
  values(p_location,p_day,r->>'id',(r->>'user_id')::uuid,(r->>'start')::timestamptz,(r->>'end')::timestamptz,r->>'role',(r->>'requires_closeout')::boolean);
 end loop;
 insert into public.staff_schedule_days(location_id,business_date,confirmed_by,confirmed_at,schedule_snapshot,valid) values(p_location,p_day,auth.uid(),saved_at,p_rows,true)
 on conflict(location_id,business_date) do update set confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,schedule_snapshot=excluded.schedule_snapshot,valid=true;
 insert into public.staff_required_roster_reviews(location_id,business_date,confirmed_at,source_snapshot) values(p_location,p_day,saved_at,p_rows)
 on conflict(location_id,business_date) do update set confirmed_at=excluded.confirmed_at,source_snapshot=excluded.source_snapshot;
 perform staff_ops_private.sync_quizzes(p_location,p_day);
 insert into public.sales_target_rosters(location_id,target_date,rows) values(p_location,p_day,p_rows)
 on conflict(location_id,target_date) do update set rows=excluded.rows,version=sales_target_rosters.version+1,updated_at=saved_at;
 select coalesce(jsonb_object_agg(rr->>'id',jsonb_build_object('group',coalesce(ov->(rr->>'id')->>'group',settings.role_groups->>lower(btrim(rr->>'role')),case when rr->>'role' ~* '\mbartender\M' then 'bar' when rr->>'role' ~* '\mserver\M' then 'floor' else 'exclude' end),'hours',extract(epoch from (rr->>'end')::timestamptz-(rr->>'start')::timestamptz)/3600)),'{}') into ov from jsonb_array_elements(p_rows) rr left join public.sales_target_settings settings on settings.location_id=p_location;
 insert into public.sales_target_day_overrides(location_id,target_date,overrides) values(p_location,p_day,ov) on conflict(location_id,target_date) do update set overrides=excluded.overrides;
 update public.sales_target_settings set version=version+1,updated_at=saved_at where location_id=p_location;
end$$;
create or replace function public.crew_schedule_tools_load(p_location_id uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean;rows jsonb;begin
 if public.crew_room_access(p_location_id) is not true then raise exception 'Crew schedule access required.' using errcode='42501';end if;
 if p_day is null or abs(p_day-(now() at time zone 'America/Chicago')::date)>366 then raise exception 'Choose a date within one year.';end if;
 manager:=crew_ops_private.manager(p_location_id);rows:=crew_ops_private.day_rows(p_location_id,p_day);
 return jsonb_build_object('me',auth.uid(),'manager',manager,'rows',rows,'snapshot',rows,'open',now()<staff_ops_private.cutoff(p_day),'override',exists(select 1 from public.crew_schedule_overrides where location_id=p_location_id and business_date=p_day),
 'source_error',(select upstream_error from public.crew_schedule_overrides where location_id=p_location_id and business_date=p_day),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id) from public.location_memberships m join public.profiles p on p.id=m.user_id where m.location_id=p_location_id and m.status='active' and public.closeout_is_member_for_tasks(p_location_id,p.id)),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select r.id,r.original_user,r.cover_user,r.requested_by,r.status,r.note,r.created_at,r.reviewed_at,r.impact,p.full_name original_name,c.full_name cover_name,a.full_name approver_name from public.crew_coverage_requests r join public.profiles p on p.id=r.original_user join public.profiles c on c.id=r.cover_user left join public.profiles a on a.id=r.reviewed_by where r.location_id=p_location_id and r.business_date=p_day and (manager or auth.uid() in (r.original_user,r.cover_user,r.requested_by)) order by r.created_at desc limit 100) x),'[]'));
end$$;
create or replace function public.crew_schedule_save(p_location_id uuid,p_day date,p_snapshot jsonb,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare before_rows jsonb;after_rows jsonb;r jsonb;uid uuid;impact jsonb:='[]';begin
 if crew_ops_private.manager(p_location_id) is not true then raise exception 'Management schedule access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-schedule:'||p_location_id::text||p_day::text,0));
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location_id::text||':'||p_day::text,0));
 before_rows:=crew_ops_private.day_rows(p_location_id,p_day);
 if before_rows is distinct from p_snapshot then raise exception 'The schedule changed. Reload before saving.';end if;
 after_rows:=crew_ops_private.canonical(p_location_id,p_day,p_rows);
 if exists(select 1 from public.closeout_target_days where location_id=p_location_id and target_date=p_day) and before_rows is distinct from after_rows then raise exception 'Sales targets are locked by a closeout. Use coverage approval for an unsubmitted shift; hours and roster size cannot be edited on this locked day.';end if;
 for r in select value from jsonb_array_elements(before_rows) loop
  uid:=nullif(r->>'user_id','')::uuid;
  if uid is not null and exists(select 1 from jsonb_array_elements(after_rows) x where x->>'id'=r->>'id' and x->>'user_id' is distinct from r->>'user_id') then raise exception 'Use Record approved coverage to change who is working and transfer their assignments.';end if;
  if uid is not null and exists(select 1 from public.daily_closeouts c where c.location_id=p_location_id and c.closeout_date=p_day and c.user_id=uid and c.status='submitted' and c.deleted_at is null) and not exists(select 1 from jsonb_array_elements(after_rows) x where x=r) then raise exception 'A submitted closeout protects this employee’s original shift. Review it before editing.';end if;
 end loop;
 for uid in select distinct (x->>'user_id')::uuid from jsonb_array_elements(before_rows) x where nullif(x->>'user_id','') is not null loop
  if not exists(select 1 from jsonb_array_elements(after_rows) x where x->>'user_id'=uid::text) then impact:=impact||jsonb_build_array(crew_ops_private.transfer_work(p_location_id,p_day,uid,null));end if;
 end loop;
 perform crew_ops_private.apply_day(p_location_id,p_day,after_rows);
 insert into public.crew_schedule_audit(location_id,business_date,actor,kind,before_rows,after_rows,impact) values(p_location_id,p_day,auth.uid(),'schedule_edit',before_rows,after_rows,impact);
 return jsonb_build_object('saved',true,'impact',impact);
end$$;
create or replace function public.crew_coverage_review(p_location_id uuid,p_id uuid,p_decision text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.crew_coverage_requests%rowtype;current_rows jsonb;new_rows jsonb;effects jsonb;begin
 select * into r from public.crew_coverage_requests where id=p_id and location_id=p_location_id;
 if r.id is null then raise exception 'Coverage request not found.';end if;
 if p_decision='cancel' then
  if auth.uid() is null or public.crew_room_access(p_location_id) is not true or r.requested_by<>auth.uid() then raise exception 'Only the requester can cancel this request.';end if;
 else
  if crew_ops_private.manager(p_location_id) is not true then raise exception 'Management must approve or reject coverage.' using errcode='42501';end if;
 end if;
 if p_decision is null or p_decision not in ('approve','reject','cancel') then raise exception 'Choose approve, reject or cancel.';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-schedule:'||p_location_id::text||r.business_date::text,0));
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location_id::text||':'||r.business_date::text,0));
 select * into r from public.crew_coverage_requests where id=p_id for update;
 if r.status='approved' and p_decision='approve' then return r.impact;end if;
 if r.status<>'pending' then raise exception 'This request has already been reviewed.';end if;
 if p_decision<>'approve' then update public.crew_coverage_requests set status=case when p_decision='reject' then 'rejected' else 'cancelled' end,reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=r.id;return jsonb_build_object('status',p_decision);end if;
 if public.closeout_is_member_for_tasks(p_location_id,r.original_user) is not true or public.closeout_is_member_for_tasks(p_location_id,r.cover_user) is not true then raise exception 'Both employees must still be active at this location.';end if;
 current_rows:=crew_ops_private.day_rows(p_location_id,r.business_date);
 if current_rows is distinct from r.snapshot then raise exception 'The schedule changed since this request. Reject it and create a new request from the current schedule.';end if;
 if not exists(select 1 from jsonb_array_elements(current_rows) x where x->>'user_id'=r.original_user::text) then raise exception 'The original employee has no shift on this day.';end if;
 select coalesce(jsonb_agg(case when x->>'user_id'=r.original_user::text then x||jsonb_build_object('user_id',r.cover_user) else x end order by ord),'[]') into new_rows from jsonb_array_elements(current_rows) with ordinality t(x,ord);
 new_rows:=crew_ops_private.canonical(p_location_id,r.business_date,new_rows);
 effects:=crew_ops_private.transfer_work(p_location_id,r.business_date,r.original_user,r.cover_user);
 perform crew_ops_private.apply_day(p_location_id,r.business_date,new_rows);
 update public.crew_coverage_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),impact=effects where id=r.id;
 insert into public.crew_schedule_audit(location_id,business_date,actor,request_id,kind,before_rows,after_rows,impact) values(p_location_id,r.business_date,auth.uid(),r.id,'coverage_approved',current_rows,new_rows,effects);
 return effects;
end$$;
create or replace function public.crew_coverage_request(p_location_id uuid,p_day date,p_original uuid,p_cover uuid,p_note text,p_snapshot jsonb,p_request uuid,p_approve_now boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare current_rows jsonb;result uuid;existing public.crew_coverage_requests%rowtype;manager boolean;begin
 if public.crew_room_access(p_location_id) is not true then raise exception 'Crew access required.' using errcode='42501';end if;
 manager:=crew_ops_private.manager(p_location_id);
 if p_approve_now is null or (p_approve_now and not manager) then raise exception 'Management must confirm previously approved coverage in the app.' using errcode='42501';end if;
 if not manager and auth.uid() not in (p_original,p_cover) then raise exception 'Request coverage for your own shift or volunteer to cover someone else.' using errcode='42501';end if;
 if p_original is null or p_cover is null or p_original=p_cover or p_request is null or length(coalesce(p_note,''))>500 or p_day is null or abs(p_day-(now() at time zone 'America/Chicago')::date)>366 or now()>=staff_ops_private.cutoff(p_day) then raise exception 'Choose two different active employees, an open date and a short note.';end if;
 if public.closeout_is_member_for_tasks(p_location_id,p_original) is not true or public.closeout_is_member_for_tasks(p_location_id,p_cover) is not true then raise exception 'Choose active employees at this location.';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-schedule:'||p_location_id::text||p_day::text,0));
 select * into existing from public.crew_coverage_requests where requested_by=auth.uid() and request_id=p_request;
 if found then
  if existing.location_id is distinct from p_location_id or existing.business_date is distinct from p_day or existing.original_user is distinct from p_original or existing.cover_user is distinct from p_cover or existing.note is distinct from coalesce(p_note,'') then raise exception 'The request changed. Start a new coverage request.';end if;
  return existing.id;
 end if;
 current_rows:=crew_ops_private.day_rows(p_location_id,p_day);
 if current_rows is distinct from p_snapshot then raise exception 'The schedule changed. Reload before requesting coverage.';end if;
 if not exists(select 1 from jsonb_array_elements(current_rows) x where x->>'user_id'=p_original::text) then raise exception 'The original employee needs a linked app account and a shift on this day.';end if;
 if exists(select 1 from public.crew_coverage_requests where location_id=p_location_id and business_date=p_day and original_user=p_original and status='pending') then raise exception 'A coverage request is already pending for this employee today.';end if;
 insert into public.crew_coverage_requests(location_id,business_date,original_user,cover_user,requested_by,request_id,snapshot,note) values(p_location_id,p_day,p_original,p_cover,auth.uid(),p_request,current_rows,coalesce(p_note,'')) returning id into result;
 if p_approve_now then perform public.crew_coverage_review(p_location_id,result,'approve');end if;
 return result;
end$$;
-- Names/photos on the crew wall also support active app employees without a 7shifts link.
do $$declare def text;begin
 def:=pg_get_functiondef('public.crew_room_load_before_styles(uuid,date,bigint)'::regprocedure);
 if position('from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) s' in def)>0 then
  def:=replace(def,'from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) s','from (select p_location_id location_id,p_date schedule_date,crew_ops_private.day_rows(p_location_id,p_date) rows) c cross join lateral jsonb_array_elements(c.rows) s');
 end if;
 if position('lm.user_id=l.user_id' in def)>0 then
  def:=replace(def,'lm.user_id=l.user_id','lm.user_id=coalesce(nullif(s->>''user_id'','''')::uuid,l.user_id)');
 elsif position('coalesce(nullif(s->>''user_id''' in def)=0 then raise exception 'Crew identity lookup has newer code. Review it before installing coverage.';end if;
 execute def;
end$$;
-- Keep submitted financial snapshots immutable; resolve the current owner for unsubmitted work.
do $$begin
 if to_regprocedure('shift_context_private.target_day_before_coverage(uuid,date)') is null then alter function shift_context_private.target_day(uuid,date) rename to target_day_before_coverage;end if;
end$$;
create or replace function shift_context_private.target_day(p_location uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;begin
 result:=shift_context_private.target_day_before_coverage(p_location,p_date);
 if coalesce((result->>'ready')::boolean,false) then
  select coalesce(jsonb_agg(r||case when s is null then '{}'::jsonb else jsonb_build_object('employee_key',s->>'employee_key','name',s->>'name') end order by ord),'[]') into rows
  from jsonb_array_elements(result->'rows') with ordinality x(r,ord)
  left join public.crew_schedule_overrides o on o.location_id=p_location and o.business_date=p_date
  left join lateral (select v s from jsonb_array_elements(o.rows) v where v->>'id'=r->>'shift_id' limit 1) a on true;
  result:=result||jsonb_build_object('rows',rows);
 end if;return result;
end$$;
revoke all on all functions in schema crew_ops_private from public,anon,authenticated;
revoke all on function shift_context_private.target_day_before_coverage(uuid,date),shift_context_private.target_day(uuid,date) from public,anon,authenticated;
revoke all on function public.crew_schedule_tools_load(uuid,date),public.crew_schedule_save(uuid,date,jsonb,jsonb),public.crew_coverage_request(uuid,date,uuid,uuid,text,jsonb,uuid,boolean),public.crew_coverage_review(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crew_schedule_tools_load(uuid,date),public.crew_schedule_save(uuid,date,jsonb,jsonb),public.crew_coverage_request(uuid,date,uuid,uuid,text,jsonb,uuid,boolean),public.crew_coverage_review(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
