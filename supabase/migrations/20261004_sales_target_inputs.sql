begin;
create table if not exists public.sales_target_settings (
 location_id uuid primary key references public.locations(id) on delete cascade,
 bar_percent numeric not null default 15 check(bar_percent between 0 and 100),
 growth_percent numeric not null default 0 check(growth_percent between -100 and 300),
 role_groups jsonb not null default '{}'::jsonb check(jsonb_typeof(role_groups)='object'),
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.sales_target_history (
 location_id uuid not null references public.locations(id) on delete cascade,
 sales_date date not null,
 net_sales numeric(12,2) not null check(net_sales>=0),
 primary key(location_id,sales_date)
);
create table if not exists public.sales_target_day_overrides (
 location_id uuid not null references public.locations(id) on delete cascade,
 target_date date not null,
 overrides jsonb not null default '{}'::jsonb check(jsonb_typeof(overrides)='object'),
 primary key(location_id,target_date)
);
alter table public.sales_target_settings enable row level security;
alter table public.sales_target_history enable row level security;
alter table public.sales_target_day_overrides enable row level security;
revoke all on public.sales_target_settings,public.sales_target_history,public.sales_target_day_overrides from public,anon,authenticated;

create or replace function public.sales_target_inputs(p_location_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.sales_target_settings; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a target date.';end if;
 insert into public.sales_target_settings(location_id) values(p_location_id) on conflict do nothing;
 select * into settings from public.sales_target_settings where location_id=p_location_id;
 select jsonb_build_object('settings',to_jsonb(settings),'history',coalesce((select jsonb_agg(jsonb_build_object('date',sales_date,'amount',net_sales) order by sales_date) from public.sales_target_history where location_id=p_location_id and sales_date>=p_date-42 and sales_date<p_date),'[]'::jsonb),'overrides',coalesce((select overrides from public.sales_target_day_overrides where location_id=p_location_id and target_date=p_date),'{}'::jsonb)) into result;
 return result;
end;$$;

create or replace function public.sales_target_save_inputs(
 p_location_id uuid,p_date date,p_version integer,p_bar_percent numeric,p_growth_percent numeric,
 p_role_groups jsonb,p_history jsonb,p_overrides jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; entry record; old_version integer; d date; amount numeric;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501';end if;
 if p_date is null or p_bar_percent is null or p_bar_percent not between 0 and 100 or p_growth_percent is null or p_growth_percent not between -100 and 300 then raise exception 'Choose valid percentages and a date.';end if;
 if jsonb_typeof(p_role_groups) is distinct from 'object' or jsonb_typeof(p_history) is distinct from 'array' or jsonb_typeof(p_overrides) is distinct from 'object' then raise exception 'Invalid sales target inputs.';end if;
 if jsonb_array_length(p_history)>42 or (select count(*) from jsonb_each(p_role_groups))>100 or (select count(*) from jsonb_each(p_overrides))>200 then raise exception 'Too many sales target inputs.';end if;
 for entry in select * from jsonb_each_text(p_role_groups) loop
  if length(entry.key) not between 1 and 200 or entry.value not in ('bar','floor','exclude') then raise exception 'Choose Bar, Floor or Exclude for each role.';end if;
 end loop;
 for entry in select * from jsonb_each(p_overrides) loop
  if length(entry.key) not between 1 and 200 or jsonb_typeof(entry.value) is distinct from 'object' or entry.value->>'group' is null or entry.value->>'group' not in ('bar','floor','exclude') then raise exception 'Invalid shift override.';end if;
  if entry.value ? 'hours' and entry.value->'hours'<>'null'::jsonb then
   if jsonb_typeof(entry.value->'hours') is distinct from 'number' then raise exception 'Expected hours must be a number.';end if;
   if (entry.value->>'hours')::numeric not between 0.01 and 24 then raise exception 'Expected hours must be greater than zero and no more than 24.';end if;
  end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_history))<>(select count(distinct x->>'date') from jsonb_array_elements(p_history) x) then raise exception 'Each sales date can appear once.';end if;
 insert into public.sales_target_settings(location_id) values(p_location_id) on conflict do nothing;
 select version into old_version from public.sales_target_settings where location_id=p_location_id for update;
 if old_version is distinct from p_version then raise exception 'Sales target inputs changed. Reload before saving.';end if;
 for item in select value from jsonb_array_elements(p_history) loop
  d:=(item->>'date')::date;
  if d is null or d<p_date-42 or d>=p_date or d>=(now() at time zone 'America/Chicago')::date then raise exception 'Enter actual sales for past dates in the selected six-week window.';end if;
  if item->'amount'='null'::jsonb then delete from public.sales_target_history where location_id=p_location_id and sales_date=d;
  else
   if jsonb_typeof(item->'amount') is distinct from 'number' then raise exception 'Enter a valid net sales amount.';end if;
   amount:=(item->>'amount')::numeric;
   if amount not between 0 and 9999999999.99 then raise exception 'Net sales must be zero or greater.';end if;
   insert into public.sales_target_history(location_id,sales_date,net_sales) values(p_location_id,d,round(amount,2)) on conflict(location_id,sales_date) do update set net_sales=excluded.net_sales;
  end if;
 end loop;
 update public.sales_target_settings set bar_percent=p_bar_percent,growth_percent=p_growth_percent,role_groups=p_role_groups,version=version+1,updated_at=now() where location_id=p_location_id;
 insert into public.sales_target_day_overrides(location_id,target_date,overrides) values(p_location_id,p_date,p_overrides) on conflict(location_id,target_date) do update set overrides=excluded.overrides;
end;$$;
revoke all on function public.sales_target_inputs(uuid,date),public.sales_target_save_inputs(uuid,date,integer,numeric,numeric,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sales_target_inputs(uuid,date),public.sales_target_save_inputs(uuid,date,integer,numeric,numeric,jsonb,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
