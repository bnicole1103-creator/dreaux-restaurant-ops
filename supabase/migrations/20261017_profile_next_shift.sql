begin;
create or replace function public.my_next_shift(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare first_day date:=((now() at time zone 'America/Chicago')-interval '4 hours')::date;
 last_day date:=first_day+30; result jsonb; shift_day date; linked boolean; saved boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location access required.' using errcode='42501';
 end if;
 perform public.app_access_assert(p_location_id,'home','schedule');
 select x.row,d.day::date into result,shift_day
 from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
 cross join lateral jsonb_array_elements(crew_ops_private.day_rows(p_location_id,d.day::date)) x(row)
 where x.row->>'user_id'=auth.uid()::text
  and coalesce((x.row->>'assigned')::boolean,true)
  and (x.row->>'start')::timestamptz>=now()
 order by (x.row->>'start')::timestamptz,x.row->>'id'
 limit 1;
 select exists(select 1 from public.team_schedule_links where location_id=p_location_id and user_id=auth.uid())
  or exists(select 1 from public.staff_scheduled_shifts where location_id=p_location_id and user_id=auth.uid() and business_date between first_day and last_day)
 into linked;
 select exists(select 1 from public.home_schedule_cache where location_id=p_location_id and schedule_date between first_day and last_day and synced_at is not null)
  or exists(select 1 from public.crew_schedule_overrides where location_id=p_location_id and business_date between first_day and last_day)
 into saved;
 return jsonb_build_object('shift',case when result is null then null else jsonb_build_object(
  'id',result->>'id','date',shift_day,'start',result->>'start','end',result->>'end',
  'role',result->>'role','station',coalesce(result->>'station',''),
  'close',coalesce((result->>'close')::boolean,false),
  'business_decline',coalesce((result->>'business_decline')::boolean,false),
  'synced_at',(select synced_at from public.home_schedule_cache where location_id=p_location_id and schedule_date=shift_day)
 ) end,'linked',linked or result is not null,'has_saved_schedule',saved,'from',first_day,'to',last_day);
end;
$$;
revoke all on function public.my_next_shift(uuid) from public,anon,authenticated;
grant execute on function public.my_next_shift(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
