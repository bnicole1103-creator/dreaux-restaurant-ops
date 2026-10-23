begin;

-- Show the team goal and only the signed-in employee's own allocation.
create or replace function public.my_home_sales_targets(
 p_location_id uuid, p_date date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare allocation jsonb; employee text; personal numeric; hours numeric;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 if p_date is null then raise exception 'Choose a target date.'; end if;
 allocation:=shift_context_private.target_day(p_location_id,p_date);
 if coalesce((allocation->>'ready')::boolean,false) is not true then
  return jsonb_build_object('ready',false,'date',p_date,
   'reason',coalesce(allocation->>'reason','Targets are not ready for this date.'));
 end if;
 select employee_key into employee from public.team_schedule_links
  where location_id=p_location_id and user_id=auth.uid();
 select sum((r->>'target')::numeric),sum((r->>'hours')::numeric)
  into personal,hours
  from jsonb_array_elements(coalesce(allocation->'rows','[]'::jsonb)) r
  where r->>'employee_key'='app:'||auth.uid()::text
   or (employee is not null and r->>'employee_key'=employee);
 return jsonb_build_object('ready',true,'date',p_date,
  'team_target',allocation->'team_target',
  'individual_target',personal,'assigned_hours',hours,
  'locked',exists(select 1 from public.closeout_target_days
   where location_id=p_location_id and target_date=p_date));
end;
$$;
revoke all on function public.my_home_sales_targets(uuid,date) from public,anon,authenticated;
grant execute on function public.my_home_sales_targets(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
