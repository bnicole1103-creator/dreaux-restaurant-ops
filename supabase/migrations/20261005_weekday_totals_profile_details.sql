begin;
create table if not exists public.sales_target_weekday_totals (
 location_id uuid not null references public.locations(id),
 through_date date not null,
 weekday integer not null check (weekday between 0 and 6),
 net_sales_total numeric(12,2) check (net_sales_total>=0),
 primary key(location_id,through_date,weekday)
);
alter table public.sales_target_weekday_totals enable row level security;
revoke all on public.sales_target_weekday_totals from public,anon,authenticated;
create or replace function public.sales_target_inputs(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.sales_target_settings; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a target date.';end if;
 insert into public.sales_target_settings(location_id) values(p_location_id) on conflict do nothing;
 select * into settings from public.sales_target_settings where location_id=p_location_id;
 select jsonb_build_object('settings',to_jsonb(settings),'history',coalesce((select jsonb_agg(jsonb_build_object('date',sales_date,'amount',net_sales) order by sales_date) from public.sales_target_history where location_id=p_location_id and sales_date>=p_date-42 and sales_date<p_date),'[]'::jsonb),'overrides',coalesce((select overrides from public.sales_target_day_overrides where location_id=p_location_id and target_date=p_date),'{}'::jsonb)) into result;
 return result||jsonb_build_object('weekday_totals',coalesce((select jsonb_agg(jsonb_build_object('weekday',weekday,'total',net_sales_total,'through_date',through_date) order by weekday) from public.sales_target_weekday_totals where location_id=p_location_id and through_date=(select max(through_date) from public.sales_target_weekday_totals where location_id=p_location_id and through_date<p_date)),'[]'::jsonb));
end;$$;
create or replace function public.sales_target_save_weekday_totals(
 p_location_id uuid,p_date date,p_through date,p_version integer,
 p_bar_percent numeric,p_growth_percent numeric,p_role_groups jsonb,
 p_totals jsonb,p_overrides jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; wd integer; amount numeric;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'Owner or general manager access required.' using errcode='42501';end if;
 if p_through is null or p_through>=p_date or p_through>=(now() at time zone 'America/Chicago')::date then raise exception 'Choose a completed six-week period ending before the target date.';end if;
 if jsonb_typeof(p_totals) is distinct from 'array' then raise exception 'Enter seven weekday totals.';end if;
 if jsonb_array_length(p_totals)<>7 or (select count(distinct x->>'weekday') from jsonb_array_elements(p_totals) x)<>7 then raise exception 'Include each weekday once.';end if;
 for item in select value from jsonb_array_elements(p_totals) loop
  if jsonb_typeof(item->'weekday') is distinct from 'number' or (item->>'weekday')!~'^[0-6]$' then raise exception 'Invalid weekday.';end if;
  if item->'total' is distinct from 'null'::jsonb then
   if jsonb_typeof(item->'total') is distinct from 'number' then raise exception 'Enter a valid total or leave it blank.';end if;
   amount:=(item->>'total')::numeric;
   if amount not between 0 and 9999999999.99 then raise exception 'Totals must be zero or greater.';end if;
  end if;
 end loop;
 -- Reuse existing permissions, version lock, allocation and hours validation.
 perform public.sales_target_save_inputs(p_location_id,p_date,p_version,p_bar_percent,p_growth_percent,p_role_groups,'[]'::jsonb,p_overrides);
 delete from public.sales_target_weekday_totals where location_id=p_location_id and through_date=p_through;
 for item in select value from jsonb_array_elements(p_totals) loop
  wd:=(item->>'weekday')::integer;
  insert into public.sales_target_weekday_totals values(p_location_id,p_through,wd,round((item->>'total')::numeric,2));
 end loop;
end;$$;
create or replace function public.team_closeout_detail(p_location_id uuid,p_closeout_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.daily_closeouts%rowtype; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Staff access required.' using errcode='42501';end if;
 select * into c from public.daily_closeouts where id=p_closeout_id and location_id=p_location_id and status='submitted' and deleted_at is null;
 if c.id is null or (c.user_id is distinct from auth.uid() and public.mod_is_manager(p_location_id) is not true) then raise exception 'Closeout not available.' using errcode='42501';end if;
 -- Explicit fields; manager ratings and review notes are never returned here.
 result:=jsonb_build_object('id',c.id,'date',c.closeout_date,'role',c.job_role,'shift',c.shift_type,'scheduled_start',c.scheduled_start,'clock_in',c.clock_in,'clock_out',to_jsonb(c)->>'clock_out','net_sales',c.net_sales,'sales_target',c.sales_target,'cash_deposit',c.cash_deposit,'void_count',c.void_count,'void_value',c.void_value,'discount_value',c.discount_value,'notes',c.notes,'submitted_at',coalesce(to_jsonb(c)->>'submitted_at',to_jsonb(c)->>'created_at'),'points_delta',c.points_delta,'questions',c.question_snapshot,'answers',c.custom_answers,'zero_sales_reason',c.zero_sales_reason,'can_review',public.mod_is_manager(p_location_id),'tables',(select coalesce(jsonb_agg(t.table_name order by t.table_name),'[]'::jsonb) from public.daily_closeout_tables ct join public.floor_tables t on t.id=ct.table_id where ct.closeout_id=c.id and t.location_id=p_location_id));
 return result;
end;$$;
revoke all on function public.sales_target_inputs(uuid,date),public.sales_target_save_weekday_totals(uuid,date,date,integer,numeric,numeric,jsonb,jsonb,jsonb),public.team_closeout_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_target_inputs(uuid,date),public.sales_target_save_weekday_totals(uuid,date,date,integer,numeric,numeric,jsonb,jsonb,jsonb),public.team_closeout_detail(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
