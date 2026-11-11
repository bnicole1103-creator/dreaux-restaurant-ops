begin;
create or replace function public.operations_closeout_date_permission(
 p_location_id uuid,p_day date,p_apply_points boolean,p_reason text,p_active boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare access jsonb;person jsonb;total integer:=0;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
 access:=public.operations_closeout_access(p_location_id);
 if coalesce((access->>'manager')::boolean,false) is not true then raise exception 'Management closeout access required.' using errcode='42501';end if;
 if p_day is null or p_day>=((now() at time zone 'America/Chicago')-interval '4 hours')::date or p_active is null or p_apply_points is null or length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 then raise exception 'Choose a past service date, points policy and approval reason.';end if;
 if jsonb_typeof(access->'staff') is distinct from 'array' then raise exception 'Staff permission list unavailable. Reload before granting access.';end if;
 perform pg_advisory_xact_lock(hashtextextended('late-closeout-date:'||p_location_id::text||':'||p_day::text,0));
 for person in select distinct value from jsonb_array_elements(access->'staff') loop
  perform public.operations_closeout_permission(p_location_id,(person->>'id')::uuid,p_day,p_apply_points,btrim(p_reason),p_active);
  total:=total+1;
 end loop;
 if total=0 then raise exception 'No staff accounts are available for this location.';end if;
 return jsonb_build_object('service_date',p_day,'staff_permissions_updated',total,'active',p_active);
end$$;
revoke all on function public.operations_closeout_date_permission(uuid,date,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.operations_closeout_date_permission(uuid,date,boolean,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
