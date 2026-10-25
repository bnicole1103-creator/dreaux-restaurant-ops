begin;
create schema if not exists sales_month_private;
revoke all on schema sales_month_private from public,anon,authenticated;
create table if not exists sales_month_private.targets(location_id uuid not null references public.locations(id),month date not null check(extract(day from month)=1),target numeric(14,2) not null check(target>0 and target<=100000000),version integer not null default 1,updated_by uuid not null,updated_at timestamptz not null default now(),primary key(location_id,month));
create table if not exists sales_month_private.manager_days(shift_id uuid primary key references public.shifts(id),location_id uuid not null references public.locations(id),business_date date not null,manager_user_id uuid not null,shift_type text not null check(shift_type in ('AM','PM','TO_VOLUME')),closing_day boolean not null,restaurant_net_sales numeric(14,2),individual_net_sales numeric(14,2) not null check(individual_net_sales>=0),final_cash_deposit numeric(14,2),collections jsonb not null default '[]',version integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid not null,check((closing_day and restaurant_net_sales>=0 and restaurant_net_sales is not null and final_cash_deposit>=0 and final_cash_deposit is not null) or (not closing_day and restaurant_net_sales is null and final_cash_deposit is null)));
create unique index if not exists monthly_one_final_day on sales_month_private.manager_days(location_id,business_date) where closing_day;
create table if not exists sales_month_private.audit(id bigint generated always as identity primary key,location_id uuid not null,changed_by uuid not null,changed_at timestamptz not null default now(),kind text not null,before_record jsonb,after_record jsonb);
alter table sales_month_private.targets enable row level security;
alter table sales_month_private.manager_days enable row level security;
alter table sales_month_private.audit enable row level security;
revoke all on all tables in schema sales_month_private from public,anon,authenticated;
revoke all on all sequences in schema sales_month_private from public,anon,authenticated;
create or replace function sales_month_private.member(p_location uuid) returns void language plpgsql stable security definer set search_path='' as $$begin if auth.uid() is null or public.closeout_is_member(p_location) is not true then raise exception 'Active location access required.' using errcode='42501';end if;end$$;
create or replace function sales_month_private.contributions(p_location uuid,p_first date,p_last date)
returns table(user_id uuid,business_date date,shift_type text,net_sales numeric,cash_deposit numeric) language sql stable security definer set search_path='' as $$
 with staff_ranked as (
 select c.user_id,c.closeout_date,coalesce(nullif(c.shift_type,''),'DAY') slot,c.net_sales,c.cash_deposit,c.deleted_at,
 row_number() over(partition by c.user_id,c.closeout_date,coalesce(nullif(c.shift_type,''),'DAY') order by coalesce(c.corrected_at,c.submitted_at,c.created_at) desc,c.id desc) rank
 from public.daily_closeouts c where c.location_id=p_location and c.status='submitted' and c.closeout_date between p_first and p_last
 ), staff as (select * from staff_ranked sr where rank=1 and deleted_at is null and not (slot='DAY' and exists(select 1 from sales_month_private.manager_days md where md.location_id=p_location and md.manager_user_id=sr.user_id and md.business_date=sr.closeout_date))), managed as (
 select distinct on(m.manager_user_id,m.business_date,m.shift_type) m.manager_user_id,m.business_date,m.shift_type,m.individual_net_sales
 from sales_month_private.manager_days m where m.location_id=p_location and m.business_date between p_first and p_last order by m.manager_user_id,m.business_date,m.shift_type,m.updated_at desc,m.shift_id desc
 )
 select coalesce(s.user_id,m.manager_user_id),coalesce(s.closeout_date,m.business_date),coalesce(m.shift_type,s.slot),coalesce(m.individual_net_sales,s.net_sales),coalesce(s.cash_deposit,0)
 from staff s full join managed m on m.manager_user_id=s.user_id and m.business_date=s.closeout_date and m.shift_type=s.slot
 where coalesce(m.individual_net_sales,s.net_sales) is not null;
$$;
create or replace function public.monthly_sales_load(p_location_id uuid,p_month date,p_user_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare first_day date;last_day date;through_day date;person uuid;goal sales_month_private.targets;total numeric;personal numeric;days integer;latest timestamptz;can_manage boolean;recorded numeric;pending numeric;pending_days integer;begin
 perform sales_month_private.member(p_location_id);if p_month is null then raise exception 'Choose a month.';end if;
 first_day:=date_trunc('month',p_month)::date;last_day:=(first_day+interval '1 month')::date-1;through_day:=least(last_day,((now() at time zone 'America/Chicago')-interval '4 hours')::date);
 person:=coalesce(p_user_id,auth.uid());can_manage:=public.mod_is_manager(p_location_id) is true;
 if person<>auth.uid() and not can_manage then raise exception 'You may view your own contribution; management can review team profiles.' using errcode='42501';end if;
 if person<>auth.uid() and not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=person) then raise exception 'Employee is not linked to this location.';end if;
 select * into goal from sales_month_private.targets where location_id=p_location_id and month=first_day;
 select coalesce(sum(restaurant_net_sales),0),count(*)::integer,max(updated_at) into total,days,latest from sales_month_private.manager_days where location_id=p_location_id and closing_day and business_date between first_day and through_day;
 select coalesce(sum(net_sales) filter(where user_id=person),0),coalesce(sum(net_sales),0) into personal,recorded from sales_month_private.contributions(p_location_id,first_day,through_day);
 select coalesce(sum(c.net_sales),0),count(distinct c.business_date)::integer into pending,pending_days from sales_month_private.contributions(p_location_id,first_day,through_day) c where not exists(select 1 from sales_month_private.manager_days md where md.location_id=p_location_id and md.business_date=c.business_date and md.closing_day);
 return jsonb_build_object('month',first_day,'through',through_day,'target',goal.target,'version',coalesce(goal.version,0),'team_sales',total+pending,'confirmed_sales',total,'provisional_sales',pending,'provisional_days',pending_days,'contribution',personal,'user_id',person,'closing_days',days,'latest_closing_at',latest,'can_manage',can_manage,'recorded_individual_total',case when can_manage then recorded else null end,'refreshed_at',clock_timestamp());
end$$;
create or replace function public.monthly_sales_target_save(p_location_id uuid,p_month date,p_target numeric,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row sales_month_private.targets;after_row sales_month_private.targets;first_day date;begin
 perform sales_month_private.member(p_location_id);if public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_month is null or p_target is null or p_target<=0 or p_target>100000000 or p_target<>round(p_target,2) then raise exception 'Enter a positive monthly target with at most two decimals.';end if;
 first_day:=date_trunc('month',p_month)::date;perform pg_advisory_xact_lock(hashtextextended('monthly-target:'||p_location_id::text||':'||first_day::text,0));
 select * into before_row from sales_month_private.targets where location_id=p_location_id and month=first_day for update;
 if coalesce(before_row.version,0) is distinct from p_version then raise exception 'This monthly target changed. Reload before saving.';end if;
 insert into sales_month_private.targets(location_id,month,target,updated_by) values(p_location_id,first_day,p_target,auth.uid()) on conflict(location_id,month) do update set target=excluded.target,version=targets.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into after_row;
 insert into sales_month_private.audit(location_id,changed_by,kind,before_record,after_record) values(p_location_id,auth.uid(),'monthly target',to_jsonb(before_row),to_jsonb(after_row));return to_jsonb(after_row);
end$$;
create or replace function public.manager_day_load(p_shift_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.shifts;result jsonb;staff_cash numeric;begin
 select * into s from public.shifts where id=p_shift_id;perform sales_month_private.member(s.location_id);
 perform public.app_access_assert(s.location_id,'closeout','manager');if public.mod_is_manager(s.location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 select coalesce(sum(cash_deposit),0) into staff_cash from sales_month_private.contributions(s.location_id,s.shift_date,s.shift_date);
 result:=jsonb_build_object('report',(select to_jsonb(m) from sales_month_private.manager_days m where shift_id=p_shift_id),'staff_cash',staff_cash,'earlier_collections',coalesce((select jsonb_agg(jsonb_build_object('shift_id',m.shift_id,'manager',coalesce(p.preferred_name,p.full_name,'Manager'),'collections',m.collections,'updated_at',m.updated_at) order by m.updated_at) from sales_month_private.manager_days m left join public.profiles p on p.id=m.manager_user_id where m.location_id=s.location_id and m.business_date=s.shift_date and m.shift_id<>p_shift_id),'[]'::jsonb));return result;
end$$;
do $$begin
 if to_regprocedure('sales_month_private.manager_submit_before_month(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb)') is null then
  alter function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) set schema sales_month_private;
  alter function sales_month_private.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb) rename to manager_submit_before_month;
 end if;
end$$;
create or replace function public.mod_submit_closeout(p_shift_id uuid,p_reviews jsonb,p_roster_confirmed boolean,p_cash_deposit numeric,p_cash_left_at text,p_register_balanced boolean,p_register_difference numeric,p_register_notes text,p_answers jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from sales_month_private.manager_days where shift_id=p_shift_id) then raise exception 'Reload the updated manager closeout to correct day totals, individual sales and cash together.';end if;
 perform sales_month_private.manager_submit_before_month(p_shift_id,p_reviews,p_roster_confirmed,p_cash_deposit,p_cash_left_at,p_register_balanced,p_register_difference,p_register_notes,p_answers);
end$$;
create or replace function public.mod_submit_day_closeout(p_shift_id uuid,p_reviews jsonb,p_roster_confirmed boolean,p_cash_deposit numeric,p_cash_left_at text,p_register_balanced boolean,p_register_difference numeric,p_register_notes text,p_answers jsonb,p_day_report jsonb,p_day_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare s public.shifts;before_row sales_month_private.manager_days;after_row sales_month_private.manager_days;other_row sales_month_private.manager_days;closing boolean;own_sales numeric;restaurant_sales numeric;collection jsonb;collections jsonb;owner boolean;manager_id uuid;legacy_before jsonb;begin
 select * into s from public.shifts where id=p_shift_id;perform sales_month_private.member(s.location_id);perform public.app_access_assert(s.location_id,'closeout','manager');
 if public.mod_is_manager(s.location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if s.status='cancelled' or s.shift_date>((now() at time zone 'America/Chicago')-interval '4 hours')::date then raise exception 'Choose a current or past service day.';end if;
 perform pg_advisory_xact_lock(hashtextextended('restaurant-day:'||s.location_id::text||':'||s.shift_date::text,0));owner:=public.closeout_is_gm(s.location_id) is true;
 select * into before_row from sales_month_private.manager_days where shift_id=p_shift_id for update;
 if coalesce(before_row.version,0) is distinct from p_day_version then raise exception 'This day report changed. Reload the shift before saving.';end if;
 if before_row.shift_id is not null and before_row.manager_user_id<>auth.uid() and not owner then raise exception 'Only the report author or elevated access may correct this closeout.' using errcode='42501';end if;
 if jsonb_typeof(p_day_report) is distinct from 'object' or jsonb_typeof(p_day_report->'closing_day') is distinct from 'boolean' or coalesce(p_day_report->>'shift_type','') not in ('AM','PM','TO_VOLUME') or jsonb_typeof(p_day_report->'individual_net_sales') is distinct from 'number' or jsonb_typeof(p_day_report->'collections') is distinct from 'array' then raise exception 'Answer whether you are closing the day and enter your individual net sales and shift type.';end if;
 closing:=(p_day_report->>'closing_day')::boolean;own_sales:=(p_day_report->>'individual_net_sales')::numeric;collections:=p_day_report->'collections';
 if own_sales<0 or own_sales>100000000 or own_sales<>round(own_sales,2) or jsonb_array_length(collections)>100 then raise exception 'Use valid sales amounts and up to 100 cash collection lines.';end if;
 for collection in select value from jsonb_array_elements(collections) loop
  if jsonb_typeof(collection) is distinct from 'object' or (collection-array['user_id','person_name','amount','note'])<>'{}'::jsonb or jsonb_typeof(collection->'person_name') is distinct from 'string' or jsonb_typeof(collection->'note') is distinct from 'string' or coalesce(length(btrim(collection->>'person_name')),0) not between 1 and 160 or jsonb_typeof(collection->'amount') is distinct from 'number' then raise exception 'Each cash collection needs an employee name and amount.';end if;
  if (collection->>'amount')::numeric<0 or (collection->>'amount')::numeric>100000000 or (collection->>'amount')::numeric<>round((collection->>'amount')::numeric,2) or coalesce(length(collection->>'note'),0)>1000 then raise exception 'Enter valid cash collection amounts and short notes.';end if;
  if nullif(collection->>'user_id','') is not null and not exists(select 1 from public.location_memberships where location_id=s.location_id and user_id=(collection->>'user_id')::uuid) then raise exception 'Cash collection employee is not linked to this location.';end if;
 end loop;
 if closing then
  if jsonb_typeof(p_day_report->'restaurant_net_sales') is distinct from 'number' or p_cash_deposit is null or p_cash_deposit<0 or p_cash_deposit>100000000 or p_cash_deposit<>round(p_cash_deposit,2) then raise exception 'The final day close requires Z-report restaurant net sales and the final cash deposit.';end if;
  restaurant_sales:=(p_day_report->>'restaurant_net_sales')::numeric;if restaurant_sales<0 or restaurant_sales>100000000 or restaurant_sales<>round(restaurant_sales,2) then raise exception 'Enter valid Z-report net sales.';end if;
  select * into other_row from sales_month_private.manager_days where location_id=s.location_id and business_date=s.shift_date and closing_day and shift_id<>p_shift_id for update;
  if found then
   if not owner or coalesce((p_day_report->>'override_final')::boolean,false) is not true then raise exception 'This day already has a final closing report. Reopen that shift to correct it, or use elevated override to replace it.';end if;
   update sales_month_private.manager_days set closing_day=false,restaurant_net_sales=null,final_cash_deposit=null,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where shift_id=other_row.shift_id;
   update public.mod_closeouts set cash_deposit=0 where shift_id=other_row.shift_id;
   insert into sales_month_private.audit(location_id,changed_by,kind,before_record,after_record) values(s.location_id,auth.uid(),'replace final closing',to_jsonb(other_row),jsonb_build_object('replaced_by_shift',p_shift_id));
  end if;
 else
  if p_day_report->'restaurant_net_sales' is not null and p_day_report->'restaurant_net_sales'<>'null'::jsonb then raise exception 'An interim closeout cannot record restaurant day sales.';end if;
  if p_cash_deposit is distinct from 0::numeric then raise exception 'An interim cash collection is not a final cash deposit.';end if;
 end if;
 select to_jsonb(mc) into legacy_before from public.mod_closeouts mc where mc.shift_id=p_shift_id;
 -- Keep the complete existing ratings, points, receipt, register and answer workflow atomic.
 perform sales_month_private.manager_submit_before_month(p_shift_id,p_reviews,p_roster_confirmed,case when closing then p_cash_deposit else 0 end,case when closing then p_cash_left_at else 'Interim collections recorded separately' end,case when closing then p_register_balanced else true end,case when closing then p_register_difference else 0 end,case when closing then p_register_notes else 'Not the final day deposit' end,p_answers);
 manager_id:=coalesce(before_row.manager_user_id,auth.uid());
 insert into sales_month_private.manager_days(shift_id,location_id,business_date,manager_user_id,shift_type,closing_day,restaurant_net_sales,individual_net_sales,final_cash_deposit,collections,updated_by)
 values(p_shift_id,s.location_id,s.shift_date,manager_id,p_day_report->>'shift_type',closing,case when closing then restaurant_sales else null end,own_sales,case when closing then p_cash_deposit else null end,collections,auth.uid())
 on conflict(shift_id) do update set shift_type=excluded.shift_type,closing_day=excluded.closing_day,restaurant_net_sales=excluded.restaurant_net_sales,individual_net_sales=excluded.individual_net_sales,final_cash_deposit=excluded.final_cash_deposit,collections=excluded.collections,version=manager_days.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into after_row;
 insert into sales_month_private.audit(location_id,changed_by,kind,before_record,after_record) values(s.location_id,auth.uid(),'manager day report',jsonb_build_object('day_report',to_jsonb(before_row),'legacy_manager_closeout',legacy_before),to_jsonb(after_row));
end$$;
create or replace function public.restaurant_day_summary(p_location_id uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare final_row sales_month_private.manager_days;expected numeric;begin
 perform sales_month_private.member(p_location_id);perform public.app_access_assert(p_location_id,'closeout','manager');if public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_day is null then raise exception 'Choose a service day.';end if;
 select * into final_row from sales_month_private.manager_days where location_id=p_location_id and business_date=p_day and closing_day;
 select coalesce(sum(cash_deposit),0) into expected from sales_month_private.contributions(p_location_id,p_day,p_day);
 return jsonb_build_object('final',case when final_row.shift_id is null then null else to_jsonb(final_row)-'collections' end,'staff_cash',expected,'legacy_cash_entries',coalesce((select jsonb_agg(jsonb_build_object('shift_id',mc.shift_id,'manager',coalesce(pr.preferred_name,pr.full_name,'Manager'),'amount',mc.cash_deposit)) from public.mod_closeouts mc join public.shifts sh on sh.id=mc.shift_id left join public.profiles pr on pr.id=mc.submitted_by where sh.location_id=p_location_id and sh.shift_date=p_day and mc.cash_deposit>0 and not exists(select 1 from sales_month_private.manager_days md where md.shift_id=mc.shift_id)),'[]'::jsonb),'reports',coalesce((select jsonb_agg(jsonb_build_object('shift_id',m.shift_id,'manager',coalesce(p.preferred_name,p.full_name,'Manager'),'closing_day',m.closing_day,'individual_net_sales',m.individual_net_sales,'collections',m.collections,'updated_at',m.updated_at) order by m.updated_at) from sales_month_private.manager_days m left join public.profiles p on p.id=m.manager_user_id where m.location_id=p_location_id and m.business_date=p_day),'[]'::jsonb));
end$$;
revoke all on function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb),public.restaurant_day_summary(uuid,date) from public,anon,authenticated;
grant execute on function public.mod_submit_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb),public.restaurant_day_summary(uuid,date) to authenticated;
-- Existing summary/export totals must use the one final deposit once it is recorded.
do $$begin
 if to_regprocedure('sales_month_private.summary_before_month(uuid,date)') is null then
  alter function public.closeout_summary_day(uuid,date) set schema sales_month_private;
  alter function sales_month_private.closeout_summary_day(uuid,date) rename to summary_before_month;
 end if;
end$$;
create or replace function public.closeout_summary_day(p_location_id uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;final_row sales_month_private.manager_days;rows jsonb;begin
 result:=sales_month_private.summary_before_month(p_location_id,p_day);
 if coalesce((result->>'manager')::boolean,false) and public.mod_is_manager(p_location_id) is true then
  select * into final_row from sales_month_private.manager_days where location_id=p_location_id and business_date=p_day and closing_day;
  if final_row.shift_id is not null then
   select coalesce(jsonb_agg(r||jsonb_build_object('cash_deposit',case when r->>'shift_id'=final_row.shift_id::text then final_row.final_cash_deposit else 0 end,'is_final_day_close',r->>'shift_id'=final_row.shift_id::text,'reported_cash_before_day_reconciliation',r->'cash_deposit')),'[]'::jsonb) into rows from jsonb_array_elements(coalesce(result->'manager_closeouts','[]'::jsonb)) r;
   result:=result||jsonb_build_object('manager_closeouts',rows);
  end if;
 end if;return result;
end$$;
revoke all on function public.closeout_summary_day(uuid,date) from public,anon,authenticated;
grant execute on function public.closeout_summary_day(uuid,date) to authenticated;
revoke all on all functions in schema sales_month_private from public,anon,authenticated;
revoke all on function public.monthly_sales_load(uuid,date,uuid),public.monthly_sales_target_save(uuid,date,numeric,integer),public.manager_day_load(uuid),public.mod_submit_day_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.monthly_sales_load(uuid,date,uuid),public.monthly_sales_target_save(uuid,date,numeric,integer),public.manager_day_load(uuid),public.mod_submit_day_closeout(uuid,jsonb,boolean,numeric,text,boolean,numeric,text,jsonb,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
