begin;
create or replace function public.crew_profile_week(p_location_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare first_day date;last_day date;day date;rows jsonb:='[]';part jsonb;days jsonb:='[]';ready boolean;issue text;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_member_for_tasks(p_location_id,p_user_id) is not true then
  raise exception 'Active employee profile access required.' using errcode='42501';
 end if;
 if auth.uid()<>p_user_id and public.mod_is_manager(p_location_id) is not true
 and public.app_access_allowed(p_location_id,'schedule','crew') is not true then
  raise exception 'Crew schedule access required to view another employee’s shifts.' using errcode='42501';
 end if;
 first_day:=date_trunc('week',now() at time zone 'America/Chicago')::date;last_day:=first_day+6;
 for day in select generate_series(first_day,last_day,interval '1 day')::date loop
  select coalesce(jsonb_agg(s||jsonb_build_object('business_date',day) order by s->>'start',s->>'id'),'[]') into part
  from jsonb_array_elements(crew_ops_private.day_rows(p_location_id,day)) s
  where s->>'user_id'=p_user_id::text;
  rows:=rows||part;
  select (c.synced_at is not null or o.location_id is not null),coalesce(o.upstream_error,c.last_error) into ready,issue
  from (select 1) seed left join public.home_schedule_cache c on c.location_id=p_location_id and c.schedule_date=day
  left join public.crew_schedule_overrides o on o.location_id=p_location_id and o.business_date=day;
  days:=days||jsonb_build_array(jsonb_build_object('date',day,'synced',coalesce(ready,false),'error',issue));
 end loop;
 return jsonb_build_object('from',first_day,'through',last_day,'rows',rows,'days',days,
  'linked',jsonb_array_length(rows)>0 or exists(select 1 from public.team_schedule_links where location_id=p_location_id and user_id=p_user_id),
  'can_refresh',public.crew_room_access(p_location_id));
end$$;
revoke all on function public.crew_profile_week(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_profile_week(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
