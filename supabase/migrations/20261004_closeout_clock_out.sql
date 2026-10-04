begin;
alter table public.daily_closeouts add column if not exists clock_out time;

create or replace function public.closeout_shift_hours(p_start time,p_end time)
returns numeric language sql immutable set search_path='' as $$
 select case when p_start is null or p_end is null or p_start=p_end then null
 else (extract(epoch from (p_end-p_start)) + case when p_end<p_start then 86400 else 0 end)/3600 end;
$$;
revoke all on function public.closeout_shift_hours(time,time) from public,anon,authenticated;

create or replace function public.closeout_validate_clock_out()
returns trigger language plpgsql security definer set search_path='' as $$
declare hours numeric;
begin
 if new.status='submitted' then
  if new.clock_out is null then
   if TG_OP='INSERT' then raise exception 'Enter your actual clock-out time.';end if;
   if old.clock_out is not null or old.status is distinct from 'submitted' then raise exception 'Enter your actual clock-out time.';end if;
  else
   hours:=public.closeout_shift_hours(new.clock_in::time,new.clock_out);
   if hours is null or hours<=0 or hours>18 then raise exception 'Check clock-in and clock-out. Shift length must be greater than zero and no more than 18 hours.';end if;
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.closeout_validate_clock_out() from public,anon,authenticated;
drop trigger if exists closeout_validate_clock_out on public.daily_closeouts;
create trigger closeout_validate_clock_out before insert or update on public.daily_closeouts for each row execute function public.closeout_validate_clock_out();

-- Extend the existing correction function without replacing its point or audit logic.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('public.closeout_manager_correct(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure) into definition;
 if position('clock_out' in definition)=0 then
  if position('''clock_in'',''job_role''' in definition)=0 or position('clock_in=next_row.clock_in,job_role=' in definition)=0 then
   raise exception 'The closeout correction function differs from the supported version. Share its definition before applying this update.';
  end if;
  definition:=replace(definition,'''clock_in'',''job_role''','''clock_in'',''clock_out'',''job_role''');
  definition:=replace(definition,'clock_in=next_row.clock_in,job_role=','clock_in=next_row.clock_in,clock_out=next_row.clock_out,job_role=');
  execute definition;
 end if;
end;$patch$;


create or replace function public.floor_closeout_history(
  p_location_id uuid,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  service_day date := ((now() at time zone 'America/Chicago') - interval '4 hours')::date;
begin
  if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
    raise exception 'Location access required.' using errcode = '42501';
  end if;
  if public.mod_is_manager(p_location_id) is not true and not exists (
    select 1 from public.location_memberships m
    where m.location_id = p_location_id and m.user_id = auth.uid()
      and m.status = 'active' and (m.can_edit_floor or m.role = 'host')
  ) then
    raise exception 'Floor management access required.' using errcode = '42501';
  end if;
  if p_table_ids is null or cardinality(p_table_ids) not between 1 and 100 then
    raise exception 'Select tables first.';
  end if;
  if exists (
    select 1 from unnest(p_table_ids) t(id)
    where id is null or not exists (
      select 1 from public.floor_tables f where f.id = t.id and f.location_id = p_location_id
    )
  ) then
    raise exception 'Selected tables must belong to this location.';
  end if;

  with selected as (
    select array_agg(distinct id order by id) ids from unnest(p_table_ids) t(id)
  ), eligible as (
    select c.id, c.user_id employee_id, c.net_sales, c.closeout_date,
      public.closeout_shift_hours(c.clock_in::time,c.clock_out) hours_worked,
      coalesce((
        select array_agg(distinct ct.table_id order by ct.table_id)
        from public.daily_closeout_tables ct where ct.closeout_id = c.id
      ) = (select ids from selected), false) table_match
    from public.daily_closeouts c
    where c.location_id = p_location_id and c.status = 'submitted'
      and (to_jsonb(c)->>'deleted_at') is null
      and lower(c.job_role) = 'server'
      and c.net_sales > 0
      and c.closeout_date between service_day - 90 and service_day
  ), preferred as (
    select e.* from eligible e
    where e.table_match or not exists (
      select 1 from eligible matched
      where matched.employee_id = e.employee_id and matched.table_match
    )
  ), recent as (
    select *, row_number() over (
      partition by employee_id order by closeout_date desc, id
    ) rn from preferred
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', employee_id, 'net_sales', net_sales,
    'table_match', table_match,
    'hours_worked', case when hours_worked > 0 and hours_worked <= 18 then hours_worked else null end
  ) order by employee_id, closeout_date desc, id), '[]'::jsonb)
  into result from recent where rn <= 30;
  return result;
end;
$$;

revoke all on function public.floor_closeout_history(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.floor_closeout_history(uuid, uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
