begin;
create or replace function public.manager_recap_reports(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; end_at timestamptz;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
    or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Active manager access required.' using errcode='42501';
 end if;
 if p_day is null then raise exception 'Select a service day.'; end if;
 start_at:=(p_day+time '04:00') at time zone 'America/Chicago';
 end_at:=((p_day+1)+time '04:00') at time zone 'America/Chicago';
 return jsonb_build_object(
  'stock',coalesce((select jsonb_agg(jsonb_build_object(
   'name',i.name,'added_by_name',i.added_by_name,'added_at',i.added_at
  ) order by i.added_at,i.id) from public.stock_board_items i
   where i.location_id=p_location_id and i.added_at<least(end_at,now())
    and (i.restocked_at is null or i.restocked_at>=least(end_at,now()))),'[]'::jsonb),
  'disposals',coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.id,'submitted_at',d.submitted_at,'lines',d.lines,
   'employee',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee')
  ) order by d.submitted_at,d.id) from public.inventory_disposal_sheets d
   left join public.profiles p on p.id=d.user_id
   where d.location_id=p_location_id and d.submitted_at>=start_at
    and d.submitted_at<end_at),'[]'::jsonb)
 );
end; $$;
revoke all on function public.manager_recap_reports(uuid,date) from public,anon,authenticated;
grant execute on function public.manager_recap_reports(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
