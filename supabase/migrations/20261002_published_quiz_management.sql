begin;
create or replace function public.quiz_manager_published(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'quiz_date',q.quiz_date,'title',q.title,'version',q.version,'question_count',jsonb_array_length(q.questions),'submission_count',(select count(*) from public.daily_quiz_attempts a where a.quiz_id=q.id)) order by q.quiz_date desc)
 from public.daily_quizzes q where q.location_id=p_location_id and q.published),'[]'::jsonb);
end; $$;

create or replace function public.quiz_manager_remove(p_location_id uuid,p_quiz_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype;
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 select * into q from public.daily_quizzes where id=p_quiz_id and location_id=p_location_id for update;
 if q.id is null then raise exception 'Quiz not found at this location.'; end if;
 if p_version is distinct from q.version then raise exception 'Quiz changed. Reload before removing.'; end if;
 update public.daily_quizzes set published=false,version=version+1,updated_by=auth.uid(),updated_at=now() where id=q.id returning * into q;
 return to_jsonb(q);
end; $$;

create or replace function public.quiz_manager_save(p_location_id uuid,p_date date,p_title text,p_instructions text,p_questions jsonb,p_publish boolean,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype; item jsonb; opt jsonb; correct integer;
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 if p_date is null or nullif(btrim(p_title),'') is null or length(p_title)>200 or length(coalesce(p_instructions,''))>4000 or p_publish is null then raise exception 'Enter a date, title, and valid instructions.'; end if;
 if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Questions must be a list.'; end if;
 if jsonb_array_length(p_questions)>50 or (p_publish and jsonb_array_length(p_questions)=0) then raise exception 'Published quizzes require 1–50 questions.'; end if;
 for item in select value from jsonb_array_elements(p_questions) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'prompt') is distinct from 'string' or nullif(btrim(item->>'prompt'),'') is null or length(item->>'prompt')>2000 then raise exception 'Each question needs its text (up to 2000 characters).'; end if;
  if jsonb_typeof(item->'category') is distinct from 'string' or length(item->>'category')>100 or jsonb_typeof(item->'explanation') is distinct from 'string' or length(item->>'explanation')>2000 then raise exception 'Enter a valid category and explanation.'; end if;
  if jsonb_typeof(item->'options') is distinct from 'array' then raise exception 'Each question needs choices.'; end if;
  if jsonb_array_length(item->'options') not between 2 and 6 then raise exception 'Each question needs 2–6 choices.'; end if;
  for opt in select value from jsonb_array_elements(item->'options') loop
   if jsonb_typeof(opt) is distinct from 'string' or nullif(btrim(opt#>>'{}'),'') is null or length(opt#>>'{}')>1000 then raise exception 'Fill in every choice.'; end if;
  end loop;
  if (select count(distinct lower(btrim(value))) from jsonb_array_elements_text(item->'options'))<>jsonb_array_length(item->'options') then raise exception 'Choices must be different.'; end if;
  if jsonb_typeof(item->'correct') is distinct from 'number' or (item->>'correct') !~ '^[0-9]+$' then raise exception 'Select a correct answer.'; end if;
  correct:=(item->>'correct')::integer;
  if correct<0 or correct>=jsonb_array_length(item->'options') then raise exception 'Select a valid correct answer.'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('daily-quiz:'||p_location_id::text||':'||p_date::text,0));
 select * into q from public.daily_quizzes where location_id=p_location_id and quiz_date=p_date for update;
 if q.id is null then
  if p_version is distinct from 0 then raise exception 'Quiz changed. Reload before saving.'; end if;
  insert into public.daily_quizzes(location_id,quiz_date,title,instructions,questions,published,updated_by)
  values(p_location_id,p_date,btrim(p_title),coalesce(p_instructions,''),p_questions,p_publish,auth.uid()) returning * into q;
 else
  if p_version is distinct from q.version then raise exception 'Quiz changed. Reload before saving.'; end if;
  update public.daily_quizzes set title=btrim(p_title),instructions=coalesce(p_instructions,''),questions=p_questions,published=p_publish,version=version+1,updated_by=auth.uid(),updated_at=now() where id=q.id returning * into q;
 end if;
 return to_jsonb(q);
end; $$;

revoke all on function public.quiz_manager_published(uuid),public.quiz_manager_remove(uuid,uuid,integer),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.quiz_manager_published(uuid),public.quiz_manager_remove(uuid,uuid,integer),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer) to authenticated;
notify pgrst,'reload schema';
commit;
