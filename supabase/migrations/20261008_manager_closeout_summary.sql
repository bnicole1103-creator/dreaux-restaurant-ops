begin;

create or replace function public.closeout_summary_day(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean; rows jsonb; ids uuid[]; users uuid[]; manager_rows jsonb;
begin
 if public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location membership required.' using errcode='42501';
 end if;
 if p_day is null then raise exception 'Select a service day.'; end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id),'[]'::jsonb),array_agg(c.id)
 into rows,ids from public.daily_closeouts c
 where c.location_id=p_location_id and c.deleted_at is null and c.status='submitted'
  and c.created_at >= ((p_day+time '04:00') at time zone 'America/Chicago')
  and c.created_at < (((p_day+1)+time '04:00') at time zone 'America/Chicago')
  and (manager or c.user_id=auth.uid());
 select array_agg(distinct u) into users from public.daily_closeouts c
 cross join lateral unnest(array[c.user_id,c.money_turned_in_to,c.drinks_made_by]) u
 where ids is not null and c.id=any(ids) and u is not null;
 if manager then
  select coalesce(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,
    'shift_name',s.shift_name,
    'shift_date',s.shift_date,
    'submitted_by',m.submitted_by,
    'submitted_by_name',coalesce(nullif(sp.preferred_name,''),nullif(sp.full_name,''),'Manager'),
    'submitted_at',m.submitted_at,
    'updated_at',m.updated_at,
    'cash_deposit',m.cash_deposit,
    'cash_left_at',m.cash_left_at,
    'register_balanced',m.register_balanced,
    'register_difference',m.register_difference,
    'register_notes',m.register_notes,
    'review_count',coalesce(r.review_count,0),
    'average_rating',r.average_rating,
    'shift_mvp',m.shift_mvp,
    'shift_mvp_name',coalesce(nullif(mp.preferred_name,''),nullif(mp.full_name,''))
  ) order by s.shift_name,m.submitted_at,m.shift_id),'[]'::jsonb)
  into manager_rows
  from public.mod_closeouts m
  join public.shifts s on s.id=m.shift_id and s.location_id=p_location_id and s.shift_date=p_day
  left join public.profiles sp on sp.id=m.submitted_by
  left join public.profiles mp on mp.id=m.shift_mvp
  left join lateral (
    select count(*)::integer review_count,round(avg(rating)::numeric,1) average_rating
    from public.mod_staff_reviews r where r.shift_id=m.shift_id
  ) r on true;
 else
  manager_rows:='[]'::jsonb;
 end if;
 return jsonb_build_object('manager',manager,'closeouts',rows,'manager_closeouts',manager_rows,
  'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'preferred_name',p.preferred_name))
   from public.profiles p where users is not null and p.id=any(users) and exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=p.id)),'[]'::jsonb),
  'tables',coalesce((select jsonb_agg(jsonb_build_object('closeout_id',t.closeout_id,'table_id',t.table_id,'table_name',t.table_name))
   from public.daily_closeout_tables t where ids is not null and t.closeout_id=any(ids)),'[]'::jsonb));
end; $$;

revoke all on function public.closeout_summary_day(uuid,date) from public,anon,authenticated;
grant execute on function public.closeout_summary_day(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
