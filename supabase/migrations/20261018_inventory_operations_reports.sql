begin;
create or replace function public.inventory_operations_report(
 p_location_id uuid,p_kind text,p_from date,p_to date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; starts timestamptz; ends timestamptz;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Active manager access required.' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('disposal','86') or p_from is null
 or p_to is null or p_to<p_from or p_to-p_from>365 then
  raise exception 'Choose a report and a date range of up to 366 days.';
 end if;
 starts:=(p_from+time '04:00') at time zone 'America/Chicago';
 ends:=(p_to+1+time '04:00') at time zone 'America/Chicago';
 if p_kind='disposal' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from (
   select s.id as sheet_id,s.user_id,
    ((s.submitted_at at time zone 'America/Chicago')-interval '4 hours')::date as service_date,
    s.submitted_at,coalesce(nullif(p.full_name,''),'Team member') as employee,
    l.value->>'brand' as brand,l.value->>'size' as bottle_size,
    (l.value->>'quantity')::integer as quantity
   from public.inventory_disposal_sheets s
   left join public.profiles p on p.id=s.user_id
   cross join lateral jsonb_array_elements(s.lines) with ordinality l(value,ordinal)
   where s.location_id=p_location_id and s.submitted_at>=starts and s.submitted_at<ends
    and to_jsonb(s)->>'deleted_at' is null
   order by s.submitted_at desc,s.id,l.ordinal limit 5001
  ) r;
 else
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from (
   select e.id as event_id,e.item_id,
    ((e.created_at at time zone 'America/Chicago')-interval '4 hours')::date as service_date,
    e.created_at,e.item_name,e.action,e.actor_name as employee,e.note
   from public.stock_board_events e
   where e.location_id=p_location_id and e.created_at>=starts and e.created_at<ends
   order by e.created_at desc,e.id desc limit 5001
  ) r;
 end if;
 return jsonb_build_object('rows',result,'truncated',jsonb_array_length(result)>5000);
end;$$;
revoke all on function public.inventory_operations_report(uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.inventory_operations_report(uuid,text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
