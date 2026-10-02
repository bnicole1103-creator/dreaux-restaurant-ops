begin;

create or replace function public.quiz_staff_month(p_location_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_start date:=date_trunc('month',p_month)::date; payload jsonb;
begin
 if public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location membership required.' using errcode='42501';
 end if;
 if month_start is null then raise exception 'Select a month.'; end if;
 with attempts as (
  select q.id as quiz_id,q.quiz_date,q.title,a.result,a.submitted_at,
   (a.result->>'score')::integer as points,(a.result->>'total')::integer as possible
  from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id
  where q.location_id=p_location_id and a.user_id=auth.uid()
   and q.quiz_date>=month_start and q.quiz_date<month_start+interval '1 month'
 ), running as (
  select *,sum(points) over(order by quiz_date,submitted_at,quiz_id rows unbounded preceding) as running_points
  from attempts
 )
 select jsonb_build_object('month',month_start,'points',coalesce(sum(points),0),
  'possible',coalesce(sum(possible),0),'completed',count(*),
  'attempts',coalesce(jsonb_agg(jsonb_build_object('quiz_id',quiz_id,'quiz_date',quiz_date,'title',title,
   'result',result,'submitted_at',submitted_at,'running_points',running_points)
   order by quiz_date desc,submitted_at desc,quiz_id),'[]'::jsonb))
 into payload from running;
 return payload;
end; $$;

create or replace function public.quiz_manager_future(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'quiz_date',q.quiz_date,
  'title',q.title,'version',q.version,'published',q.published,'question_count',jsonb_array_length(q.questions),
  'submission_count',(select count(*) from public.daily_quiz_attempts a where a.quiz_id=q.id))
  order by q.quiz_date,q.title)
  from public.daily_quizzes q where q.location_id=p_location_id
   and q.quiz_date>(now() at time zone 'America/Chicago')::date),'[]'::jsonb);
end; $$;

revoke all on function public.quiz_staff_month(uuid,date),public.quiz_manager_future(uuid) from public,anon,authenticated;
grant execute on function public.quiz_staff_month(uuid,date),public.quiz_manager_future(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
