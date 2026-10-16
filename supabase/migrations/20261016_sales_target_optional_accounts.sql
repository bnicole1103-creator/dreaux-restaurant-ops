begin;

create or replace function public.sales_target_roster_save(
 p_location_id uuid,p_date date,p_version integer,p_rows jsonb
)
returns void
language plpgsql security definer set search_path='' as $$
declare
 r jsonb;uid uuid;employee text;person text;hrs numeric;
 at_time timestamptz;v integer;key text;grp text;role_name text;
 saved jsonb:='[]'::jsonb;ov jsonb;prior_rows jsonb;imported_rows jsonb;
begin
 if auth.uid() is null
 or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'General manager access required.' using errcode='42501';
 end if;
 if p_date is null or p_version is null or p_version<0
 or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Choose a date and employee list.';
 end if;
 if jsonb_array_length(p_rows)>200 then
  raise exception 'Use at most 200 sales shifts.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(
  'closeout-target:'||p_location_id::text||':'||p_date::text,0
 ));
 if exists(select 1 from public.closeout_target_days
  where location_id=p_location_id and target_date=p_date) then
  raise exception 'Targets are locked by a submitted closeout. Choose an unlocked date.';
 end if;
 select version,rows into v,prior_rows
 from public.sales_target_rosters
 where location_id=p_location_id and target_date=p_date for update;
 if coalesce(v,0) is distinct from p_version then
  raise exception 'The employee list changed. Reload before saving.';
 end if;
 prior_rows:=coalesce(prior_rows,'[]'::jsonb);
 select rows into imported_rows from public.home_schedule_cache
 where location_id=p_location_id and schedule_date=p_date;
 imported_rows:=coalesce(imported_rows,'[]'::jsonb);
 insert into public.sales_target_settings(location_id)
 values(p_location_id) on conflict do nothing;
 perform 1 from public.sales_target_settings
 where location_id=p_location_id for update;
 select overrides into ov from public.sales_target_day_overrides
 where location_id=p_location_id and target_date=p_date;
 ov:=coalesce(ov,'{}'::jsonb);
 for r in select value from jsonb_array_elements(p_rows) loop
  uid:=nullif(r->>'user_id','')::uuid;
  key:=r->>'id';grp:=r->>'group';role_name:=btrim(r->>'role');
  if jsonb_typeof(r) is distinct from 'object'
  or key is null or length(key) not between 1 and 200
  or grp is null or grp not in ('bar','floor','exclude')
  or role_name is null or length(role_name) not between 1 and 100 then
   raise exception 'Enter a name, position and pool for every row.';
  end if;
  if exists(select 1 from jsonb_array_elements(saved) x where x->>'id'=key) then
   raise exception 'Duplicate sales shift.';
  end if;
  if uid is not null then
   select coalesce(l.employee_key,'app:'||p.id::text),
    coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee')
   into employee,person
   from public.location_memberships m join public.profiles p on p.id=m.user_id
   left join public.team_schedule_links l
    on l.location_id=m.location_id and l.user_id=m.user_id
   where m.location_id=p_location_id and m.user_id=uid and m.status='active';
   if not found then
    raise exception 'Choose an active account, or save without an app account.';
   end if;
  else
   person:=btrim(coalesce(r->>'name',''));
   employee:=nullif(btrim(r->>'employee_key'),'');
   if length(person) not between 1 and 200 then
    raise exception 'Enter the employee name when no app account is selected.';
   end if;
   if employee is null then employee:='unlinked:'||gen_random_uuid()::text;end if;
   if length(employee)>200 or employee like 'app:%' then
    raise exception 'Choose an account or use a separate unlinked employee.';
   end if;
   if employee !~ '^unlinked:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and not exists(select 1 from jsonb_array_elements(imported_rows) x
    where x->>'employee_key'=employee)
   and not exists(select 1 from jsonb_array_elements(prior_rows) x
    where x->>'employee_key'=employee) then
    raise exception 'Use an imported employee or add an employee without an account.';
   end if;
  end if;
  if jsonb_typeof(r->'hours') is distinct from 'number' then
   raise exception 'Enter expected hours for every row.';
  end if;
  hrs:=(r->>'hours')::numeric;
  if hrs not between 0.01 and 24 or hrs::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Expected hours must be greater than zero and at most 24.';
  end if;
  if nullif(r->>'start_time','') is null then raise exception 'Enter a start time.';end if;
  at_time:=(p_date+(r->>'start_time')::time) at time zone 'America/Chicago';
  saved:=saved||jsonb_build_array(jsonb_build_object(
   'id',key,'user_id',uid,'employee_key',employee,'assigned',true,
   'name',person,'role',role_name,'station','','start',at_time,
   'end',at_time+hrs*interval '1 hour','close',false,'business_decline',false
  ));
  ov:=ov||jsonb_build_object(key,jsonb_build_object('group',grp,'hours',hrs));
 end loop;
 select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into ov
 from jsonb_each(ov) e where exists(
  select 1 from jsonb_array_elements(saved) x where x->>'id'=e.key
 );
 insert into public.sales_target_rosters(location_id,target_date,rows)
 values(p_location_id,p_date,saved)
 on conflict(location_id,target_date) do update set
  rows=excluded.rows,version=sales_target_rosters.version+1,updated_at=clock_timestamp();
 insert into public.sales_target_day_overrides(location_id,target_date,overrides)
 values(p_location_id,p_date,ov)
 on conflict(location_id,target_date) do update set overrides=excluded.overrides;
 update public.sales_target_settings set version=version+1,updated_at=now()
 where location_id=p_location_id;
end;$$;

revoke all on function public.sales_target_roster_save(uuid,date,integer,jsonb)
from public,anon,authenticated;
grant execute on function public.sales_target_roster_save(uuid,date,integer,jsonb)
to authenticated;
notify pgrst,'reload schema';
commit;
