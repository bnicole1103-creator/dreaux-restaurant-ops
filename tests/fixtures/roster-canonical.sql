create or replace function crew_ops_private.canonical(p_location uuid,p_day date,p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;uid uuid;at_start timestamptz;at_end timestamptz;name text;employee text;result jsonb:='[]';begin
 if p_day is null or now()>=staff_ops_private.cutoff(p_day) or p_day>((now() at time zone 'America/Chicago')::date+366) then raise exception 'Choose an open service day within one year; past 4 AM deadlines cannot be changed here.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then raise exception 'Use up to 200 shifts.';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  uid:=nullif(r->>'user_id','')::uuid;
  if uid is null or public.closeout_is_member_for_tasks(p_location,uid) is not true then raise exception 'Link every shift to an active app employee before saving or approving coverage.';end if;
  if coalesce(length(r->>'id'),0) not between 1 and 150 or coalesce(length(btrim(r->>'role')),0) not between 1 and 100 or jsonb_typeof(r->'requires_closeout') is distinct from 'boolean' then raise exception 'Each shift needs an ID, position and closeout setting.';end if;
  if exists(select 1 from jsonb_array_elements(result) x where x->>'id'=r->>'id') then raise exception 'Duplicate shift ID.';end if;
  if r ? 'start_time' then
   if coalesce(r->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(r->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter valid start and end times.';end if;
   at_start:=((p_day+case when (r->>'start_time')::time<time '04:00' then 1 else 0 end)+(r->>'start_time')::time) at time zone 'America/Chicago';
   at_end:=((p_day+case when (r->>'end_time')::time<time '04:00' then 1 else 0 end)+(r->>'end_time')::time) at time zone 'America/Chicago';
   if at_end<at_start then at_end:=at_end+interval '1 day';end if;
  else at_start:=(r->>'start')::timestamptz;at_end:=(r->>'end')::timestamptz;end if;
  if at_start is null or at_end is null or at_start<((p_day+time '04:00') at time zone 'America/Chicago') or at_end>staff_ops_private.cutoff(p_day) or at_end<=at_start or at_end>at_start+interval '24 hours' then raise exception 'Use real start/end times within this service day (4 AM to 4 AM).';end if;
  select btrim(p.full_name),coalesce(l.employee_key,'app:'||uid::text) into name,employee from public.profiles p left join public.team_schedule_links l on l.location_id=p_location and l.user_id=p.id where p.id=uid;
  result:=result||jsonb_build_array(jsonb_build_object('id',r->>'id','user_id',uid,'employee_key',employee,'assigned',true,'name',name,'role',btrim(r->>'role'),'station',coalesce(r->>'station',''),'start',at_start,'end',at_end,'close',false,'business_decline',false,'requires_closeout',(r->>'requires_closeout')::boolean));
 end loop;
 if exists(select 1 from jsonb_array_elements(result) a join jsonb_array_elements(result) b on a->>'id'<b->>'id' and a->>'user_id'=b->>'user_id' and (a->>'start')::timestamptz<(b->>'end')::timestamptz and (b->>'start')::timestamptz<(a->>'end')::timestamptz) then raise exception 'One employee cannot work overlapping shifts. Choose another replacement or correct the hours.';end if;
 return result;
end$$;
