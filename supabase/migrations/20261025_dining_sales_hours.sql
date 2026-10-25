begin;
do $$begin
 if to_regprocedure('crew_ops_private.dining_settings(uuid)') is null then raise exception 'Install the Dining Hours Presets update first. No changes applied.';end if;
end$$;
create or replace function sales_month_private.dining_day(l uuid,d date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select allocation->'dining_day' from public.closeout_target_days where location_id=l and target_date=d),crew_ops_private.dining_settings(l)->'days'->extract(dow from d)::integer);
$$;
create or replace function sales_month_private.selling_hours(l uuid,d date,s jsonb,ov jsonb) returns numeric language plpgsql stable security definer set search_path='' as $$
declare day jsonb;st timestamp;en timestamp;op timestamp;cl timestamp;hrs numeric;begin
 day:=sales_month_private.dining_day(l,d);if (day->>'closed')::boolean then return 0;end if;
 if nullif(s->>'start','') is null then return null;end if;
 st:=(s->>'start')::timestamptz at time zone 'America/Chicago';
 if nullif(ov->(s->>'id')->>'hours','') is not null then
  hrs:=(ov->(s->>'id')->>'hours')::numeric;if hrs<=0 or hrs>24 then return null;end if;en:=st+hrs*interval '1 hour';
 elsif coalesce((s->>'close')::boolean,false) or coalesce((s->>'business_decline')::boolean,false) then return null;
 elsif nullif(s->>'end','') is not null then en:=(s->>'end')::timestamptz at time zone 'America/Chicago';else return null;end if;
 if en<=st or en>st+interval '24 hours' then return null;end if;
 op:=d+(day->>'open')::time;cl:=d+(day->>'close')::time;
 if (day->>'open')::time<time '04:00' then op:=op+interval '1 day';end if;
 if (day->>'close')::time<time '04:00' then cl:=cl+interval '1 day';end if;
 return greatest(0,extract(epoch from least(en,cl)-greatest(st,op))/3600);
end$$;
do $$begin
 if to_regprocedure('sales_month_private.targets_before_dining(uuid,date)') is null and to_regprocedure('shift_context_private.target_day(uuid,date)') is not null then
  alter function shift_context_private.target_day(uuid,date) set schema sales_month_private;
  alter function sales_month_private.target_day(uuid,date) rename to targets_before_dining;
 end if;
 if to_regprocedure('sales_month_private.inputs_before_dining(uuid,date)') is null then
  alter function public.sales_target_inputs(uuid,date) set schema sales_month_private;
  alter function sales_month_private.sales_target_inputs(uuid,date) rename to inputs_before_dining;
 end if;
 if to_regprocedure('sales_month_private.monthly_before_dining(uuid,date,uuid)') is null then
  alter function public.monthly_sales_load(uuid,date,uuid) set schema sales_month_private;
  alter function sales_month_private.monthly_sales_load(uuid,date,uuid) rename to monthly_before_dining;
 end if;
end$$;
create or replace function public.sales_target_inputs(p_location_id uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=sales_month_private.inputs_before_dining(p_location_id,p_date);
 return result||jsonb_build_object('dining_day',sales_month_private.dining_day(p_location_id,p_date));
end$$;
create or replace function shift_context_private.target_day(p_location uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.sales_target_settings%rowtype;cache public.home_schedule_cache%rowtype;overrides jsonb;
 total numeric;through_day date;team_cents bigint;bar_cents bigint;result jsonb;invalid integer;
begin
 select allocation into result from public.closeout_target_days where location_id=p_location and target_date=p_date;
 if found then return result;end if;
 -- Keep existing shared-schedule confirmation and any other installed target guards.
 if to_regprocedure('sales_month_private.targets_before_dining(uuid,date)') is not null then
  execute 'select sales_month_private.targets_before_dining($1,$2)' into result using p_location,p_date;
  if coalesce((result->>'ready')::boolean,false) is not true then return result;end if;
 end if;

 if (sales_month_private.dining_day(p_location,p_date)->>'closed')::boolean then return jsonb_build_object('ready',false,'reason','Restaurant closed: no dining hours for sales targets.');end if;
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
 select s,grp,sales_month_private.selling_hours(p_location,p_date,s,overrides) hrs from raw where grp<>'exclude')
 select count(*) into invalid from shifts where (hrs is null or hrs>0) and (grp not in ('bar','floor') or coalesce((s->>'assigned')::boolean,false) is not true or nullif(s->>'employee_key','') is null
 or nullif(s->>'id','') is null or nullif(s->>'start','') is null or hrs is null or hrs>24);
 if invalid>0 then return jsonb_build_object('ready',false,'reason','Assign each selling shift to an employee and enter full scheduled duration for Close or Business decline shifts in Sales Targets.');end if;
 with raw as (
 select s,coalesce(overrides->(s->>'id')->>'group',settings.role_groups->>lower(btrim(s->>'role')),
 case when s->>'role' ~* '\mbartender\M' then 'bar' when s->>'role' ~* '\mserver\M' then 'floor' else 'exclude' end) grp
 from jsonb_array_elements(cache.rows) s), shifts as (
 select s,grp,sales_month_private.selling_hours(p_location,p_date,s,overrides) hrs from raw where grp in ('bar','floor')),
 people as (select s->>'employee_key' employee,grp,sum(hrs) hrs from shifts where hrs>0 group by s->>'employee_key',grp),
 fractions as (select *,case when grp='bar' then bar_cents else team_cents-bar_cents end pool,
 (case when grp='bar' then bar_cents else team_cents-bar_cents end)*hrs/sum(hrs) over(partition by grp) raw_cents from people),
 ranked as (select *,row_number() over(partition by grp order by raw_cents-floor(raw_cents) desc,employee) rank from fractions),
 amounts as (select *,floor(raw_cents)+case when rank<=pool-sum(floor(raw_cents)) over(partition by grp) then 1 else 0 end cents from ranked),
 shift_fractions as (select s.s,s.grp,s.hrs,a.cents,a.employee,a.cents*s.hrs/a.hrs raw_shift from shifts s join amounts a on a.employee=s.s->>'employee_key' and a.grp=s.grp),
 shift_rank as (select *,row_number() over(partition by employee,grp order by raw_shift-floor(raw_shift) desc,s->>'id') rank from shift_fractions),
 allocated as (select *,floor(raw_shift)+case when rank<=cents-sum(floor(raw_shift)) over(partition by employee,grp) then 1 else 0 end shift_cents from shift_rank)
 select jsonb_build_object('ready',true,'date',p_date,'through_date',through_day,'weekday_total',total,'settings_version',settings.version,'schedule_synced_at',cache.synced_at,
 'dining_day',sales_month_private.dining_day(p_location,p_date),'hours_basis','dining_overlap','team_target',team_cents/100.0,'bar_target',bar_cents/100.0,'floor_target',(team_cents-bar_cents)/100.0,
 'rows',coalesce(jsonb_agg(jsonb_build_object('shift_id',s->>'id','employee_key',employee,'group',grp,'start',s->>'start','hours',hrs,'target',shift_cents/100.0) order by s->>'id') filter(where hrs>0),'[]'::jsonb)) into result from allocated;
 if (bar_cents>0 and not exists(select 1 from jsonb_array_elements(result->'rows') r where r->>'group'='bar')) or
 (team_cents-bar_cents>0 and not exists(select 1 from jsonb_array_elements(result->'rows') r where r->>'group'='floor')) then
 return jsonb_build_object('ready',false,'reason','Both sales pools need assigned staff with usable hours.');end if;
 return result;
end;$$;


create or replace function sales_month_private.month_hours(l uuid,first_day date,last_day date,person uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d date;rows jsonb;ov jsonb;settings jsonb;s jsonb;grp text;uid uuid;hrs numeric;mine numeric:=0;team numeric:=0;missing integer:=0;days integer:=0;begin
 select role_groups into settings from public.sales_target_settings where location_id=l;
 for d in select generate_series(first_day,last_day,interval '1 day')::date loop
  rows:=null;
  select r.rows into rows from public.sales_target_rosters r where r.location_id=l and r.target_date=d;
  if rows is null and exists(select 1 from public.staff_schedule_days sd where sd.location_id=l and sd.business_date=d and sd.valid) then
   select coalesce(jsonb_agg(jsonb_build_object('id',ss.shift_key,'user_id',ss.user_id,'employee_key',coalesce(t.employee_key,'app:'||ss.user_id::text),'start',ss.start_at,'end',ss.end_at,'assigned',true,'role',ss.role_name)),'[]'::jsonb) into rows from public.staff_scheduled_shifts ss left join public.team_schedule_links t on t.location_id=ss.location_id and t.user_id=ss.user_id where ss.location_id=l and ss.business_date=d and ss.shift_key not like 'offday:%';
  end if;
  if rows is null then select c.rows into rows from public.home_schedule_cache c where c.location_id=l and c.schedule_date=d and c.last_error is null and c.synced_at is not null;end if;
  if rows is null then if not (sales_month_private.dining_day(l,d)->>'closed')::boolean then missing:=missing+1;end if;continue;end if;
  days:=days+1;select coalesce(o.overrides,'{}'::jsonb) into ov from public.sales_target_day_overrides o where o.location_id=l and o.target_date=d;ov:=coalesce(ov,'{}'::jsonb);
  for s in select value from jsonb_array_elements(rows) loop
   grp:=coalesce(ov->(s->>'id')->>'group',settings->>lower(btrim(s->>'role')),case when s->>'role' ~* '\mbartender\M' then 'bar' when s->>'role' ~* '\mserver\M' then 'floor' else 'exclude' end);
   if grp not in ('bar','floor') or coalesce((s->>'assigned')::boolean,false) is not true then continue;end if;
   hrs:=sales_month_private.selling_hours(l,d,s,ov);if hrs is null then missing:=missing+1;continue;end if;
   team:=team+hrs;uid:=nullif(s->>'user_id','')::uuid;
   if uid is null then select t.user_id into uid from public.team_schedule_links t where t.location_id=l and t.employee_key=s->>'employee_key';end if;
   if uid is null and s->>'employee_key'='app:'||person::text then uid:=person;end if;
   if uid=person then mine:=mine+hrs;end if;
  end loop;
 end loop;
 return jsonb_build_object('selling_hours',mine,'team_selling_hours',team,'hours_share_percent',case when team>0 then mine/team*100 else null end,'hours_days',days,'hours_missing',missing);
end$$;
create or replace function public.monthly_sales_load(p_location_id uuid,p_month date,p_user_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;hours jsonb;begin
 result:=sales_month_private.monthly_before_dining(p_location_id,p_month,p_user_id);
 hours:=sales_month_private.month_hours(p_location_id,(result->>'month')::date,(result->>'through')::date,coalesce(p_user_id,auth.uid()));
 return result||hours||jsonb_build_object('sales_per_selling_hour',case when (hours->>'selling_hours')::numeric>0 and (hours->>'hours_missing')::integer=0 then (result->>'contribution')::numeric/(hours->>'selling_hours')::numeric else null end,'hours_goal_share',case when (hours->>'hours_share_percent') is not null and (hours->>'hours_missing')::integer=0 then (result->>'target')::numeric*(hours->>'hours_share_percent')::numeric/100 else null end);
end$$;
revoke all on all functions in schema sales_month_private from public,anon,authenticated;
revoke all on function public.sales_target_inputs(uuid,date),public.monthly_sales_load(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.sales_target_inputs(uuid,date),public.monthly_sales_load(uuid,date,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
