begin;
create or replace function public.team_profile_resolve(p_location_id uuid,p_user_id uuid default null,p_employee_key text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid;uids uuid[];result jsonb;photo text;managed boolean;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
 raise exception 'Active location access required.' using errcode='42501';end if;
 managed:=public.mod_is_manager(p_location_id) is true;
 if p_user_id is not null then uid:=p_user_id;
 else
  select array_agg(distinct m.user_id) into uids from public.location_memberships m
  left join public.team_schedule_links l on l.location_id=m.location_id and l.user_id=m.user_id
  where m.location_id=p_location_id and (m.status='active' or managed)
  and (l.employee_key=nullif(p_employee_key,'') or 'app:'||m.user_id::text=nullif(p_employee_key,''));
  if cardinality(uids)=1 then uid:=uids[1];end if;
 end if;
 select jsonb_build_object('user_id',p.id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member'),
 'role',m.role,'status',m.status,'photo',to_jsonb(p)->>'photo_url','can_analyze',managed or p.id=auth.uid()) into result
 from public.location_memberships m join public.profiles p on p.id=m.user_id
 where m.location_id=p_location_id and m.user_id=uid and (m.status='active' or managed or m.user_id=auth.uid());
 if result is null then raise exception 'This employee is not linked to an available team profile at this location.';end if;
 if to_regclass('public.crew_photos') is not null then
  execute 'select photo from public.crew_photos where user_id=$1' into photo using uid;
  if photo is not null then result:=result||jsonb_build_object('photo',photo);end if;
 end if;
 return result;
end;$$;

create or replace function public.team_profile_details(p_location_id uuid,p_user_id uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;basic jsonb;activity jsonb:='{}'::jsonb;part jsonb;
begin
 -- The existing profile function enforces manager/self access and range validation.
 result:=public.team_employee_profile(p_location_id,p_user_id,p_start,p_end);
 basic:=public.team_profile_resolve(p_location_id,p_user_id,null);
 -- Match point overrides by account as well as location and entry key.
 -- Daily deduction keys can be shared by different employees.
 if to_regprocedure('public.points_source_entries(uuid)') is not null and to_regclass('public.point_entry_overrides') is not null then
  execute $query$
   select coalesce(jsonb_agg(jsonb_build_object('date',s.business_date,'points',coalesce(o.points,s.points),
    'description',s.description) order by s.business_date desc,s.entry_key),'[]'::jsonb)
   from public.points_source_entries($1) s left join public.point_entry_overrides o
    on o.location_id=$1 and o.user_id=s.user_id and o.entry_key=s.entry_key
   where s.user_id=$2 and s.business_date between $3 and $4
  $query$ into part using p_location_id,p_user_id,p_start,p_end;
  result:=result||jsonb_build_object('points',part);
 end if;

 if to_regclass('public.preshift_view_sessions') is not null then
  execute $query$
   select jsonb_build_object('posts_opened',count(distinct s.post_id),
    'visible_ms',coalesce(sum(s.visible_ms),0),'basis','recorded sessions')
   from public.preshift_view_sessions s join public.preshift_posts p on p.id=s.post_id
   where p.location_id=$1 and s.user_id=$2 and p.shift_date between $3 and $4 and p.deleted_at is null
  $query$ into part using p_location_id,p_user_id,p_start,p_end;
  activity:=activity||jsonb_build_object('reading',part);
  if to_regprocedure('preshift_points_private.viewed_ms(uuid,uuid,timestamptz)') is not null then
   execute $query$
    select jsonb_build_object('posts_opened',count(*),'visible_ms',coalesce(sum(preshift_points_private.viewed_ms(p.id,$2,now())),0),
     'basis','verified intervals and timestamp-supported sessions') from public.preshift_posts p
    where p.location_id=$1 and p.shift_date between $3 and $4 and p.deleted_at is null
     and exists(select 1 from public.preshift_view_sessions s where s.post_id=p.id and s.user_id=$2)
   $query$ into part using p_location_id,p_user_id,p_start,p_end;
   activity:=activity||jsonb_build_object('reading',part);
  end if;
  if coalesce((result->>'manager_view')::boolean,false) is not true then
   activity:=activity||jsonb_build_object('reading',(activity->'reading')-'visible_ms');
  end if;
 end if;
 if to_regclass('public.crew_messages') is not null then
  execute $query$
   select jsonb_build_object('messages',count(*)) from public.crew_messages
   where location_id=$1 and user_id=$2 and room_date between $3 and $4 and deleted_at is null
  $query$ into part using p_location_id,p_user_id,p_start,p_end;
  activity:=activity||jsonb_build_object('crew',part);
 end if;
 if to_regclass('public.purchase_receipts') is not null then
  execute $query$
   select jsonb_build_object('receipts',count(*),'known_total',coalesce(sum(total),0),
    'missing_totals',count(*) filter(where total is null),'captured',count(*) filter(where status='captured'),
    'recorded',count(*) filter(where status='recorded')) from public.purchase_receipts
   where location_id=$1 and user_id=$2 and purchase_date between $3 and $4
  $query$ into part using p_location_id,p_user_id,p_start,p_end;
  activity:=activity||jsonb_build_object('wallet',part);
 end if;
 return result||jsonb_build_object('photo',basic->'photo','activity',activity);
end;$$;
revoke all on function public.team_profile_resolve(uuid,uuid,text),public.team_profile_details(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.team_profile_resolve(uuid,uuid,text),public.team_profile_details(uuid,uuid,date,date) to authenticated;
create or replace function public.preshift_post_social(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare comments jsonb; reactions jsonb;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select coalesce(jsonb_agg(x order by x.created_at),'[]'::jsonb) into comments from (
  select c.id,c.user_id,c.body,c.created_at,
   coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member') as name,
   (c.user_id=auth.uid() or public.mod_is_manager(p_location_id)) as can_delete
  from public.preshift_comments c join public.profiles p on p.id=c.user_id
  where c.post_id=p_post_id order by c.created_at desc limit 100
 ) x;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into reactions from (
  select r.emoji,count(*) as count,bool_or(r.user_id=auth.uid()) as mine
  from public.preshift_reactions r where r.post_id=p_post_id group by r.emoji
 ) x;
 return jsonb_build_object('comments',comments,'reactions',reactions);
end; $$;
create or replace function public.team_profile_post_author(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select author_id into uid from public.preshift_posts where id=p_post_id and location_id=p_location_id;
 if uid is null then raise exception 'Post author is unavailable.';end if;
 return public.team_profile_resolve(p_location_id,uid,null);
end;$$;
revoke all on function public.team_profile_post_author(uuid,uuid) from public,anon,authenticated;
grant execute on function public.team_profile_post_author(uuid,uuid) to authenticated;
revoke all on function public.preshift_post_social(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preshift_post_social(uuid,uuid) to authenticated;
create or replace function public.closeout_peer_recognition(p_location_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean; result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a date range of at most one year.';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.closeout_id,'day',v.business_date,'recipient_id',v.recipient_id,'voter_id',case when manager or v.voter_id=auth.uid() then v.voter_id else null end,'recipient',coalesce(nullif(r.preferred_name,''),nullif(r.full_name,''),'Teammate'),'voter',case when manager or v.voter_id=auth.uid() then coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Teammate') else null end,'reason',v.reason) order by v.created_at desc),'[]'::jsonb) into result
 from public.closeout_peer_votes v join public.daily_closeouts c on c.id=v.closeout_id
 left join public.profiles r on r.id=v.recipient_id left join public.profiles p on p.id=v.voter_id
 where v.location_id=p_location_id and v.business_date between p_from and p_to and c.deleted_at is null and c.status='submitted' and (manager or v.voter_id=auth.uid() or v.recipient_id=auth.uid());
 return result;
end;$$;
revoke all on function public.closeout_peer_recognition(uuid,date,date) from public,anon,authenticated;
grant execute on function public.closeout_peer_recognition(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
