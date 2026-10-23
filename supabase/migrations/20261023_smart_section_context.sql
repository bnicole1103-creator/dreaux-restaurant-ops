begin;
create or replace function public.floor_smart_context(p_location_id uuid,p_table_ids uuid[],p_day date,p_role text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;ids uuid[];
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or not (public.floor_schedule_can_manage(p_location_id) or exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active' and role='host')) then raise exception 'Floor management access required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'floor','sections');
 if p_day is null or p_day<current_date-366 or p_day>current_date+366 or p_role is null or p_role not in ('server','bartender','host','busser','manager','kitchen') then raise exception 'Choose a service date and position.';end if;
 select array_agg(distinct x order by x) into ids from unnest(p_table_ids) x;
 if coalesce(cardinality(ids),0) not between 1 and 100 or exists(select 1 from unnest(ids) x where x is null or not exists(select 1 from public.floor_tables where id=x and location_id=p_location_id)) then raise exception 'Choose tables at this location.';end if;
 with schedule as (
 select x,coalesce(nullif(x->>'user_id','')::uuid,l.user_id) user_id from public.home_schedule_cache c cross join lateral jsonb_array_elements(c.rows) x
 left join public.team_schedule_links l on l.location_id=c.location_id and l.employee_key=x->>'employee_key'
 where c.location_id=p_location_id and c.schedule_date=p_day and (x->>'assigned')::boolean is true and c.last_error is null and c.synced_at>=now()-interval '24 hours' and not exists(select 1 from public.staff_schedule_days reviewed where reviewed.location_id=p_location_id and reviewed.business_date=p_day and reviewed.valid and not reviewed.operations_auto)
 ), scheduled as (
 select distinct s.user_id,s.role_name job from public.staff_scheduled_shifts s where s.location_id=p_location_id and s.business_date=p_day and s.shift_key not like 'offday:%' and exists(select 1 from public.staff_schedule_days d where d.location_id=p_location_id and d.business_date=p_day and d.valid)
 union select user_id,x->>'role' from schedule where user_id is not null
 ), candidates as (
 select m.user_id::text id,coalesce(nullif(p.preferred_name,''),p.full_name) name,
 exists(select 1 from scheduled s where s.user_id=m.user_id and lower(s.job) like '%'||p_role||'%') scheduled,m.role
 from public.location_memberships m join public.profiles p on p.id=m.user_id
 where m.location_id=p_location_id and m.status='active' and public.floor_schedule_member(p_location_id,m.user_id)
 and (lower(m.role) like '%'||p_role||'%' or exists(select 1 from scheduled s where s.user_id=m.user_id and lower(s.job) like '%'||p_role||'%') or exists(select 1 from public.daily_closeouts c where c.location_id=p_location_id and c.user_id=m.user_id and c.status='submitted' and c.deleted_at is null and lower(c.job_role) like '%'||p_role||'%' and c.closeout_date between p_day-90 and p_day))
 union all
 select distinct 'schedule:'||coalesce(x->>'employee_key',x->>'id'),x->>'name',true,x->>'role' from schedule where user_id is null and lower(x->>'role') like '%'||p_role||'%'
 ), closeouts as (
 select c.*,coalesce((select array_agg(distinct t.table_id order by t.table_id) from public.daily_closeout_tables t where t.closeout_id=c.id),
 (select array_agg(distinct t order by t) from public.floor_section_plans a cross join lateral unnest(a.table_ids) t where a.location_id=c.location_id and a.employee_id=c.user_id and a.cancelled_at is null and a.published_at is not null and ((a.starts_at at time zone 'America/Chicago')-interval '4 hours')::date=c.closeout_date)) table_ids,
 exists(select 1 from public.daily_closeout_tables t where t.closeout_id=c.id) recorded_tables,
 row_number() over(partition by c.user_id order by c.closeout_date desc,c.id) rn
 from public.daily_closeouts c where c.location_id=p_location_id and c.status='submitted' and c.deleted_at is null and c.net_sales>=0 and lower(c.job_role) like '%'||p_role||'%'
 and c.closeout_date between least(p_day,((now() at time zone 'America/Chicago')-interval '4 hours')::date)-90 and least(p_day,((now() at time zone 'America/Chicago')-interval '4 hours')::date)
 )
 select jsonb_build_object('candidates',coalesce((select jsonb_agg(to_jsonb(c)) from candidates c),'[]'),
 'performance',coalesce((select jsonb_agg(jsonb_build_object('employee_id',c.user_id,'net_sales',c.net_sales,'hours_worked',public.closeout_shift_hours(c.clock_in::time,c.clock_out),'closeout_date',c.closeout_date,'closeout_id',c.id,'job_role',c.job_role,'table_match',c.recorded_tables and c.table_ids=ids,'assignment_match',c.table_ids=ids,'seats',(select sum(f.seat_count) from public.floor_tables f where f.location_id=p_location_id and f.id=any(c.table_ids)))) from closeouts c where c.rn<=30),'[]'),
 'loads',coalesce((select jsonb_object_agg(employee_id,seat_load) from (select plan.employee_id,sum(f.seat_count) seat_load from (select distinct a.employee_id,t from public.floor_section_plans a cross join lateral unnest(a.table_ids) t where a.location_id=p_location_id and a.employee_id is not null and a.cancelled_at is null and a.published_at is not null and a.starts_at<((p_day+1+time '04:00') at time zone 'America/Chicago') and a.ends_at>((p_day+time '04:00') at time zone 'America/Chicago') and not (t=any(ids))) plan join public.floor_tables f on f.id=plan.t and f.location_id=p_location_id group by plan.employee_id) counts),'{}'::jsonb),
 'seats',(select sum(seat_count) from public.floor_tables where location_id=p_location_id and id=any(ids)),
 'schedule_confirmed_at',(select confirmed_at from public.staff_schedule_days where location_id=p_location_id and business_date=p_day and valid and not operations_auto),
 'schedule_synced_at',(select synced_at from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_day),
 'schedule_error',(select last_error from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_day)) into result;
 return result;
end;$$;
revoke all on function public.floor_smart_context(uuid,uuid[],date,text) from public,anon,authenticated;
grant execute on function public.floor_smart_context(uuid,uuid[],date,text) to authenticated;
notify pgrst,'reload schema';
commit;
