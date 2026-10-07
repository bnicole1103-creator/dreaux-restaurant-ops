begin;
create schema if not exists shift_context_private;
revoke all on schema shift_context_private from public,anon,authenticated;
create table if not exists public.closeout_target_days (
 location_id uuid not null references public.locations(id),target_date date not null,
 allocation jsonb not null,locked_at timestamptz not null default now(),primary key(location_id,target_date)
);
alter table public.closeout_target_days enable row level security;
revoke all on public.closeout_target_days from public,anon,authenticated;
alter table public.daily_closeouts add column if not exists automatic_target_snapshot jsonb;

-- Reproduce the app's weekday total / 6 and hours-weighted allocation on the server.
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
 select * into cache from public.home_schedule_cache where location_id=p_location and schedule_date=p_date;
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
 if employee is null then return jsonb_build_object('ready',false,'reason','A manager needs to link your team profile to your 7shifts employee.');end if;
 if p_role='server' then grp:='floor';elsif p_role in ('main_bartender','back_bartender_1','back_bar_service_bartender') then grp:='bar';else
 return jsonb_build_object('ready',false,'reason','This role does not have a sales target.');end if;
 select jsonb_agg(r),sum((r->>'target')::numeric) into rows,amount from jsonb_array_elements(p_day->'rows') r
 where r->>'employee_key'=employee and ((r->>'start')::timestamptz at time zone 'America/Chicago')::time=p_start;
 if rows is null then return jsonb_build_object('ready',false,'reason','No matching sales shift was found. Check your scheduled start and role, or ask a manager to review your 7shifts link and allocation.');end if;
 return jsonb_build_object('ready',true,'date',p_date,'through_date',p_day->'through_date','settings_version',p_day->'settings_version','schedule_synced_at',p_day->'schedule_synced_at','target',amount,'employee_key',employee,'shifts',rows);
end;$$;
create or replace function public.sales_target_locked_day(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 return (select allocation from public.closeout_target_days where location_id=p_location_id and target_date=p_date);
end;$$;
revoke all on function public.sales_target_locked_day(uuid,date) from public,anon,authenticated;
grant execute on function public.sales_target_locked_day(uuid,date) to authenticated;
-- Preserve the current manager-only inputs function and expose the locked preview.
do $$begin
 if to_regprocedure('shift_context_private.target_inputs_base(uuid,date)') is null then
  alter function public.sales_target_inputs(uuid,date) set schema shift_context_private;
  alter function shift_context_private.sales_target_inputs(uuid,date) rename to target_inputs_base;
 end if;
end;$$;
create or replace function public.sales_target_inputs(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return shift_context_private.target_inputs_base(p_location_id,p_date)||jsonb_build_object('locked_day',(select allocation from public.closeout_target_days where location_id=p_location_id and target_date=p_date));
end;$$;
revoke all on function public.sales_target_inputs(uuid,date) from public,anon,authenticated;
grant execute on function public.sales_target_inputs(uuid,date) to authenticated;
create or replace function public.closeout_automatic_target(p_location_id uuid,p_date date,p_start time,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 return shift_context_private.target_for(p_location_id,auth.uid(),p_date,p_start,p_role,shift_context_private.target_day(p_location_id,p_date));
end;$$;
create or replace function shift_context_private.attach_target()
returns trigger language plpgsql security definer set search_path='' as $$
declare day_data jsonb;target jsonb;
begin
 if TG_OP='UPDATE' and old.status='submitted' then
  new.automatic_target_snapshot:=old.automatic_target_snapshot;
  if old.automatic_target_snapshot is not null then
   new.sales_target:=old.sales_target;
   if (new.scheduled_start,new.job_role,new.shift_type) is distinct from (old.scheduled_start,old.job_role,old.shift_type) then
    raise exception 'An automatically targeted closeout must keep its scheduled shift and role. Correct net sales and other amounts instead.';end if;
  end if;return new;
 end if;
 new.automatic_target_snapshot:=null;
 if new.status<>'submitted' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-target:'||new.location_id::text||':'||new.closeout_date::text,0));
 day_data:=shift_context_private.target_day(new.location_id,new.closeout_date);
 target:=shift_context_private.target_for(new.location_id,new.user_id,new.closeout_date,new.scheduled_start::time,new.job_role,day_data);
 if (target->>'ready')::boolean is true then
  if exists(select 1 from public.daily_closeouts c where c.location_id=new.location_id and c.user_id=new.user_id and c.closeout_date=new.closeout_date
    and c.status='submitted' and c.deleted_at is null and c.id is distinct from new.id and c.scheduled_start::time=new.scheduled_start::time) then
   raise exception 'A closeout already exists for this scheduled shift. Ask a manager to correct it.';end if;
  insert into public.closeout_target_days(location_id,target_date,allocation) values(new.location_id,new.closeout_date,day_data) on conflict do nothing;
  new.sales_target:=(target->>'target')::numeric;
 else new.sales_target:=0;end if;
 new.automatic_target_snapshot:=target;
 return new;
end;$$;
drop trigger if exists zy_closeout_automatic_target on public.daily_closeouts;
create trigger zy_closeout_automatic_target before insert or update on public.daily_closeouts for each row execute function shift_context_private.attach_target();
revoke all on all functions in schema shift_context_private from public,anon,authenticated;
revoke all on function public.closeout_automatic_target(uuid,date,time,text) from public,anon,authenticated;
grant execute on function public.closeout_automatic_target(uuid,date,time,text) to authenticated;

create or replace function public.preshift_reservation_context(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a shift date.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.guest_name,'time',r.reservation_time,'party',r.party_size,'table',r.table_name,'occasion',r.occasion,'birthday',r.is_birthday,
 'notes',r.notes,'vip',r.is_vip) order by r.reservation_time,r.guest_name,r.id) from public.reservations r where r.location_id=p_location_id and r.reservation_date=p_date and lower(coalesce(r.status,'')) not in ('cancelled','canceled','no_show','no-show')),'[]'::jsonb);
end;$$;
revoke all on function public.preshift_reservation_context(uuid,date) from public,anon,authenticated;
grant execute on function public.preshift_reservation_context(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
