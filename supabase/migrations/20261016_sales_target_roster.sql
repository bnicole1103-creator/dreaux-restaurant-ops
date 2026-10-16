begin;
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
commit;
