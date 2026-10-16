begin;
-- Count timestamp-supported historical sessions and expose the actual points cutoff.
do $$begin
 if to_regprocedure('preshift_points_private.viewed_ms(uuid,uuid,timestamp with time zone)') is null
 or to_regclass('public.preshift_minute_policy') is null
 or to_regprocedure('public.preshift_viewing_report(uuid,uuid)') is null then
  raise exception 'The existing pre-shift viewing/one-minute points module must be installed first. No update was applied.';
 end if;
end;$$;
create or replace function preshift_points_private.reading_evidence(p_post uuid,p_user uuid,p_cutoff timestamptz)
returns table(interval_ms bigint,session_lower_bound_ms bigint,eligible_ms bigint)
language sql stable security definer set search_path='' as $$
 with intervals as (
  select coalesce(floor(sum(extract(epoch from(upper(r)-lower(r))))*1000)::bigint,0) ms
  from unnest((select range_agg(tstzrange(started_at,least(ended_at,p_cutoff),'[)'))
   from public.preshift_view_intervals where post_id=p_post and user_id=p_user and started_at<p_cutoff)) r
 ), historical as (
  -- Never sum session totals: two tabs may have been visible at the same time.
  -- If a session continued past the cutoff, subtract ALL elapsed time after it.
  -- This is a conservative lower bound, not an invented reconstruction of activity.
  select coalesce(max(greatest(0,least(s.visible_ms,
   floor(extract(epoch from(least(s.updated_at,p_cutoff)-s.started_at))*1000)::bigint,
   s.visible_ms-ceil(greatest(0,extract(epoch from(s.updated_at-p_cutoff))*1000))::bigint))),0)::bigint ms
  from public.preshift_view_sessions s where s.post_id=p_post and s.user_id=p_user and s.started_at<p_cutoff
 )
 select i.ms,h.ms,greatest(i.ms,h.ms) from intervals i cross join historical h;
$$;
create or replace function preshift_points_private.viewed_ms(p_post uuid,p_user uuid,p_cutoff timestamptz)
returns bigint language sql stable security definer set search_path='' as $$
 select eligible_ms from preshift_points_private.reading_evidence(p_post,p_user,p_cutoff);
$$;
create or replace function preshift_points_private.view_deadline(p_location uuid,p_user uuid,p_day date)
returns timestamptz language sql stable security definer set search_path='' as $$
 select min(least(s.end_at,coalesce((select min(c.submitted_at) from public.daily_closeouts c
  where c.location_id=s.location_id and c.user_id=s.user_id and c.closeout_date=s.business_date
   and c.status='submitted' and c.deleted_at is null),s.end_at)))
 from public.staff_scheduled_shifts s where s.location_id=p_location and s.user_id=p_user and s.business_date=p_day
  and s.end_at>s.start_at and staff_ops_private.roster_ready(s.location_id,s.business_date);
$$;
create or replace function public.preshift_minute_status(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare due timestamptz;applies boolean;elapsed bigint;credited bigint;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select preshift_points_private.view_deadline(p_location_id,auth.uid(),p.shift_date) into due from public.preshift_posts p where p.id=p_post_id;
 select coalesce(r.required and due>=policy.effective_at+interval '60 seconds'
  and greatest(r.required_from,p.created_at)<=due-interval '60 seconds',false) into applies
 from public.preshift_posts p left join public.preshift_minute_requirements r on r.post_id=p.id
 left join public.preshift_minute_policy policy on policy.location_id=p.location_id where p.id=p_post_id;
 elapsed:=preshift_points_private.viewed_ms(p_post_id,auth.uid(),now());
 credited:=preshift_points_private.viewed_ms(p_post_id,auth.uid(),least(now(),coalesce(due,now())));
 return jsonb_build_object('required',coalesce((select required from public.preshift_minute_requirements where post_id=p_post_id),false),
  'can_manage',public.closeout_is_gm(p_location_id),'deadline',due,'applies_to_me',coalesce(applies,false),
  'missed',coalesce(applies and now()>=due and credited<60000,false),'visible_ms',elapsed,'credited_ms',credited);
end;$$;
create or replace function public.preshift_viewing_report(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb;people jsonb;
begin
 -- Retain the original report's management authorization and account filtering.
 report:=public.preshift_activity_report(p_location_id,p_post_id);
 select coalesce(jsonb_agg(person||jsonb_build_object(
  'visible_ms',coalesce((select sum(s.visible_ms) from public.preshift_view_sessions s
   where s.post_id=p_post_id and s.user_id=(person->>'user_id')::uuid and s.post_version=(report->>'version')::integer),0),
  'deadline',d.due,'credited_ms',e.eligible_ms,'interval_ms',e.interval_ms,
  'session_lower_bound_ms',e.session_lower_bound_ms,'applies',coalesce(r.required
   and d.due>=policy.effective_at+interval '60 seconds'
   and greatest(r.required_from,p.created_at)<=d.due-interval '60 seconds',false),
  'deadline_passed',coalesce(now()>=d.due,false)) order by n),'[]'::jsonb)
 into people from jsonb_array_elements(report->'rows') with ordinality x(person,n)
 join public.preshift_posts p on p.id=p_post_id
 left join public.preshift_minute_requirements r on r.post_id=p.id
 left join public.preshift_minute_policy policy on policy.location_id=p.location_id
 cross join lateral(select preshift_points_private.view_deadline(p_location_id,(person->>'user_id')::uuid,p.shift_date) due) d
 cross join lateral preshift_points_private.reading_evidence(p_post_id,(person->>'user_id')::uuid,least(now(),coalesce(d.due,now()))) e;
 return jsonb_set(report,'{rows}',people);
end;$$;
revoke all on function preshift_points_private.reading_evidence(uuid,uuid,timestamptz),preshift_points_private.view_deadline(uuid,uuid,date),preshift_points_private.viewed_ms(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.preshift_minute_status(uuid,uuid),public.preshift_viewing_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preshift_minute_status(uuid,uuid),public.preshift_viewing_report(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
