begin;
create schema if not exists post_workflow_private;
revoke all on schema post_workflow_private from public,anon,authenticated;
-- Read the existing app allocation without changing saved targets or points.
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
  'shifts',coalesce((select rows from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date),'[]'::jsonb),
  'synced_at',(select synced_at from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_date));
end;$$;
revoke all on function public.sales_targets_for_day(uuid,date) from public,anon,authenticated;
grant execute on function public.sales_targets_for_day(uuid,date) to authenticated;
-- Keep the installed Summary's authorization, filters, and cash/disposal behavior.
do $$begin
 if to_regprocedure('post_workflow_private.summary_before_targets(uuid,date)') is null then
  alter function public.closeout_summary_day(uuid,date) set schema post_workflow_private;
  alter function post_workflow_private.closeout_summary_day(uuid,date) rename to summary_before_targets;
 end if;
end;$$;
revoke all on function post_workflow_private.summary_before_targets(uuid,date) from public,anon,authenticated;
create or replace function public.closeout_summary_day(p_location_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;row_data jsonb;target jsonb;updated_rows jsonb:='[]'::jsonb;
begin
 result:=post_workflow_private.summary_before_targets(p_location_id,p_day);
 for row_data in select value from jsonb_array_elements(coalesce(result->'closeouts','[]'::jsonb)) loop
  if coalesce((row_data->'automatic_target_snapshot'->>'ready')::boolean,false) is not true then
   target:=shift_context_private.target_for(p_location_id,(row_data->>'user_id')::uuid,
    (row_data->>'closeout_date')::date,(row_data->>'scheduled_start')::time,row_data->>'job_role',
    shift_context_private.target_day(p_location_id,(row_data->>'closeout_date')::date));
   if coalesce((target->>'ready')::boolean,false) then
    row_data:=row_data||jsonb_build_object('sales_target',target->'target',
     'automatic_target_snapshot',target||jsonb_build_object('display_only',true));
   end if;
  end if;
  updated_rows:=updated_rows||jsonb_build_array(row_data);
 end loop;
 result:=result||jsonb_build_object('closeouts',updated_rows);
 if (result->>'manager')::boolean is true then
  result:=result||jsonb_build_object('sales_targets',post_workflow_private.named_targets(p_location_id,p_day));
 end if;
 return result;
end;$$;
revoke all on function public.closeout_summary_day(uuid,date) from public,anon,authenticated;
grant execute on function public.closeout_summary_day(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
