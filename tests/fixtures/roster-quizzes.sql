create or replace function staff_ops_private.sync_quizzes(p_location uuid,p_day date) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 select confirmed_by into owner_id from public.staff_schedule_days where location_id=p_location and business_date=p_day;
 if owner_id is null or now()>=staff_ops_private.cutoff(p_day) then return;end if;
 delete from public.quiz_requirements r using public.daily_quizzes q where q.id=r.quiz_id and q.location_id=p_location and q.quiz_date=p_day
 and not exists(select 1 from public.staff_scheduled_shifts s where s.location_id=p_location and s.business_date=p_day and s.user_id=r.user_id and s.requires_quiz);
 insert into public.quiz_requirements(quiz_id,user_id,due_at,assigned_by)
 select q.id,s.user_id,staff_ops_private.cutoff(p_day),owner_id from public.daily_quizzes q join (select distinct user_id from public.staff_scheduled_shifts where location_id=p_location and business_date=p_day and requires_quiz) s on true
 where q.location_id=p_location and q.quiz_date=p_day and q.published on conflict(quiz_id,user_id) do nothing;
end;$$;