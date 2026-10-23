begin;
do $check$ begin
 if to_regprocedure('public.crew_schedule_save(uuid,date,jsonb,jsonb)') is null or to_regprocedure('public.crew_schedule_tools_load(uuid,date)') is null or to_regprocedure('staff_ops_private.apply_controls(uuid,date)') is null then raise exception 'Install the existing schedule tools and Operations Controls first.';end if;
end;$check$;
do $keep$ begin
 if to_regprocedure('crew_ops_private.schedule_save_before_controls(uuid,date,jsonb,jsonb)') is null then
 alter function public.crew_schedule_save(uuid,date,jsonb,jsonb) set schema crew_ops_private;
 alter function crew_ops_private.crew_schedule_save(uuid,date,jsonb,jsonb) rename to schedule_save_before_controls;
 end if;
 if to_regprocedure('crew_ops_private.tools_load_before_controls(uuid,date)') is null then
 alter function public.crew_schedule_tools_load(uuid,date) set schema crew_ops_private;
 alter function crew_ops_private.crew_schedule_tools_load(uuid,date) rename to tools_load_before_controls;
 end if;
end;$keep$;
create or replace function public.crew_schedule_save(p_location_id uuid,p_day date,p_snapshot jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=crew_ops_private.schedule_save_before_controls(p_location_id,p_day,p_snapshot,p_rows);
 perform staff_ops_private.apply_controls(p_location_id,p_day);
 return result||jsonb_build_object('hours_shared',true);
end;$$;
create or replace function public.crew_schedule_tools_load(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=crew_ops_private.tools_load_before_controls(p_location_id,p_day);
 return result||jsonb_build_object('confirmed_at',(select updated_at from public.crew_schedule_overrides where location_id=p_location_id and business_date=p_day));
end;$$;
revoke all on function crew_ops_private.schedule_save_before_controls(uuid,date,jsonb,jsonb),crew_ops_private.tools_load_before_controls(uuid,date) from public,anon,authenticated;
revoke all on function public.crew_schedule_save(uuid,date,jsonb,jsonb),public.crew_schedule_tools_load(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_schedule_save(uuid,date,jsonb,jsonb),public.crew_schedule_tools_load(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
