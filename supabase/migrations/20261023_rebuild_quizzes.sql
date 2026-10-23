begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('justinis-rebuild-v1',0));
create schema if not exists rebuild_private;
revoke all on schema rebuild_private from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.app_access_assert(uuid,text,text)') is null or to_regprocedure('staff_ops_private.sync_quizzes(uuid,date)') is null then raise exception 'Existing permissions and confirmed-schedule work are required.';end if;
end;$$;
-- Existing quizzes keep their existing answer-release behavior. New quizzes start unreleased.
alter table public.daily_quizzes add column if not exists answers_released boolean not null default true;
alter table public.daily_quiz_attempts add column if not exists quiz_version integer;
create or replace function rebuild_private.attempt_version_stamp() returns trigger language plpgsql security definer set search_path='' as $$begin
 select version into new.quiz_version from public.daily_quizzes where id=new.quiz_id;return new;end;$$;
drop trigger if exists rebuild_attempt_version on public.daily_quiz_attempts;
create trigger rebuild_attempt_version before insert on public.daily_quiz_attempts for each row execute function rebuild_private.attempt_version_stamp();
-- Remove only the exact location/date uniqueness; retain all other constraints.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.daily_quizzes'::regclass and contype='u'
 and (select array_agg(a.attname::text order by a.attname) from unnest(conkey) k join pg_attribute a on a.attrelid=conrelid and a.attnum=k)=array['location_id','quiz_date']::text[]
 loop execute format('alter table public.daily_quizzes drop constraint %I',c.conname);end loop;
end;$$;
create index if not exists daily_quizzes_date_list on public.daily_quizzes(location_id,quiz_date,id);
create table if not exists rebuild_private.quiz_versions(quiz_id uuid not null references public.daily_quizzes(id),version integer not null,questions jsonb not null,title text not null,actor uuid,recorded_at timestamptz not null default clock_timestamp(),primary key(quiz_id,version));
alter table rebuild_private.quiz_versions enable row level security;
revoke all on rebuild_private.quiz_versions from public,anon,authenticated;
create or replace function rebuild_private.quiz_version_stamp() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into rebuild_private.quiz_versions(quiz_id,version,questions,title,actor) values(new.id,new.version,new.questions,new.title,auth.uid()) on conflict do nothing;return new;end;$$;
drop trigger if exists rebuild_quiz_versions on public.daily_quizzes;
create trigger rebuild_quiz_versions after insert or update on public.daily_quizzes for each row execute function rebuild_private.quiz_version_stamp();
insert into rebuild_private.quiz_versions(quiz_id,version,questions,title,actor) select id,version,questions,title,updated_by from public.daily_quizzes on conflict do nothing;
CREATE OR REPLACE FUNCTION public.quiz_manager_save_v2(p_location_id uuid, p_quiz_id uuid, p_date date, p_title text, p_instructions text, p_questions jsonb, p_publish boolean, p_version integer, p_release boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 q public.daily_quizzes%rowtype;
 item jsonb;
 opt jsonb;
 correct integer;
BEGIN
 -- app-page-access-v1
 perform public.app_access_assert(p_location_id,'quizzes','builder');

 if public.mod_is_manager(p_location_id) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;

 if p_quiz_id is null or p_release is null or p_date is null
    or nullif(btrim(p_title),'') is null
    or length(p_title)>200
    or length(coalesce(p_instructions,''))>4000
    or p_publish is null then
  raise exception 'Enter a date, title, and valid instructions.';
 end if;

 if jsonb_typeof(p_questions) is distinct from 'array' then
  raise exception 'Questions must be a list.';
 end if;

 if jsonb_array_length(p_questions)>50
    or (p_publish and jsonb_array_length(p_questions)=0) then
  raise exception 'Published quizzes require 1–50 questions.';
 end if;

 for item in select value from jsonb_array_elements(p_questions) loop
  if jsonb_typeof(item) is distinct from 'object'
     or jsonb_typeof(item->'prompt') is distinct from 'string'
     or nullif(btrim(item->>'prompt'),'') is null
     or length(item->>'prompt')>2000 then
   raise exception 'Each question needs its text (up to 2000 characters).';
  end if;

  if jsonb_typeof(item->'category') is distinct from 'string'
     or length(item->>'category')>100
     or jsonb_typeof(item->'explanation') is distinct from 'string'
     or length(item->>'explanation')>2000 then
   raise exception 'Enter a valid category and explanation.';
  end if;

  if jsonb_typeof(item->'options') is distinct from 'array' then
   raise exception 'Each question needs choices.';
  end if;

  if jsonb_array_length(item->'options') not between 2 and 6 then
   raise exception 'Each question needs 2–6 choices.';
  end if;

  for opt in select value from jsonb_array_elements(item->'options') loop
   if jsonb_typeof(opt) is distinct from 'string'
      or nullif(btrim(opt#>>'{}'),'') is null
      or length(opt#>>'{}')>1000 then
    raise exception 'Fill in every choice.';
   end if;
  end loop;

  if (
   select count(distinct lower(btrim(value)))
   from jsonb_array_elements_text(item->'options')
  )<>jsonb_array_length(item->'options') then
   raise exception 'Choices must be different.';
  end if;

  if jsonb_typeof(item->'correct') is distinct from 'number'
     or (item->>'correct') !~ '^[0-9]+$' then
   raise exception 'Select a correct answer.';
  end if;

  correct:=(item->>'correct')::integer;

  if correct<0 or correct>=jsonb_array_length(item->'options') then
   raise exception 'Select a valid correct answer.';
  end if;
 end loop;

 perform pg_advisory_xact_lock(
  hashtextextended(
   'daily-quiz:'||p_location_id::text||':'||p_date::text,0
  )
 );

 select * into q
 from public.daily_quizzes
 where id=p_quiz_id for update;
 if q.id is not null and (q.location_id<>p_location_id or q.quiz_date<>p_date) then raise exception 'Quiz identity/date mismatch. Reload the intended quiz.';end if;

 if q.id is null then
  if p_version is distinct from 0 then
   raise exception 'Quiz changed. Reload before saving.';
  end if;

  insert into public.daily_quizzes(
   id,location_id,quiz_date,title,instructions,
   questions,published,updated_by,answers_released
  )
  values(
   p_quiz_id,p_location_id,p_date,btrim(p_title),
   coalesce(p_instructions,''),p_questions,
   p_publish,auth.uid(),p_release
  )
  returning * into q;
 else
  if p_version is distinct from q.version then
   raise exception 'Quiz changed. Reload before saving.';
  end if;

  update public.daily_quizzes
  set title=btrim(p_title),
      instructions=coalesce(p_instructions,''),
      questions=p_questions,
      published=p_publish,
      answers_released=p_release,
      version=version+1,
      updated_by=auth.uid(),
      updated_at=now()
  where id=q.id
  returning * into q;
 end if;

 return to_jsonb(q);
end;
$function$;

create or replace function public.quiz_manager_day_v2(p_location_id uuid,p_date date,p_quiz_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$declare q public.daily_quizzes%rowtype;begin
 perform public.app_access_assert(p_location_id,'quizzes','builder');
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 select * into q from public.daily_quizzes where location_id=p_location_id and quiz_date=p_date and (p_quiz_id is null or id=p_quiz_id) order by updated_at,id limit 1;
 if p_quiz_id is not null and q.id is null then raise exception 'This quiz is unavailable for the selected date.';end if;
 return jsonb_build_object('quiz',case when q.id is null then null else to_jsonb(q) end,'quizzes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'published',published) order by updated_at,id) from public.daily_quizzes where location_id=p_location_id and quiz_date=p_date),'[]'::jsonb),'results',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',coalesce(nullif(p.preferred_name,''),p.full_name,'Staff member'),'result',a.result,'submitted_at',a.submitted_at) order by a.submitted_at) from public.daily_quiz_attempts a left join public.profiles p on p.id=a.user_id where a.quiz_id=q.id),'[]'::jsonb));
end;$$;
create or replace function rebuild_private.staff_result(q public.daily_quizzes,r jsonb)
returns jsonb language sql immutable set search_path='' as $$select case when r is null then null when q.answers_released then r||'{"answers_released":true}'::jsonb else (r-'questions')||'{"questions":[],"answers_released":false}'::jsonb end;$$;
create or replace function public.quiz_staff_day_v2(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform public.app_access_assert(p_location_id,'quizzes','published');
 if public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 return jsonb_build_object('scheduled',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'quiz_date',quiz_date) order by quiz_date,id) from public.daily_quizzes where location_id=p_location_id and published and quiz_date>(now() at time zone 'America/Chicago')::date and quiz_date<=(now() at time zone 'America/Chicago')::date+31),'[]'::jsonb),'quizzes',coalesce((select jsonb_agg(jsonb_build_object('quiz',jsonb_build_object('id',q.id,'version',q.version,'title',q.title,'instructions',q.instructions,'quiz_date',q.quiz_date,'questions',case when q.quiz_date>(now() at time zone 'America/Chicago')::date then '[]'::jsonb else coalesce((select jsonb_agg(value-array['correct','explanation','answer_text','correct_answer','source_quote'] order by n) from jsonb_array_elements(q.questions) with ordinality x(value,n)),'[]'::jsonb) end),'result',rebuild_private.staff_result(q,a.result),'scheduled',q.quiz_date>(now() at time zone 'America/Chicago')::date) order by q.updated_at,q.id) from public.daily_quizzes q left join public.daily_quiz_attempts a on a.quiz_id=q.id and a.user_id=auth.uid() where q.location_id=p_location_id and q.quiz_date=p_date and q.published),'[]'::jsonb));
end;$$;
-- Legacy date callers are explicit: multiple quizzes must use the ID-aware API.
create or replace function public.quiz_staff_load(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin
 d:=public.quiz_staff_day_v2(p_location_id,p_date);return coalesce(d->'quizzes'->0,'{"quiz":null,"result":null}'::jsonb)||jsonb_build_object('quiz_count',jsonb_array_length(d->'quizzes'));
end;$$;
create or replace function public.quiz_manager_load(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin
 d:=public.quiz_manager_day_v2(p_location_id,p_date,null);if jsonb_array_length(d->'quizzes')>1 then raise exception 'Multiple quizzes exist on this date. Use the updated quiz editor to select the quiz.';end if;return d;
end;$$;
create or replace function public.quiz_manager_save(p_location_id uuid,p_date date,p_title text,p_instructions text,p_questions jsonb,p_publish boolean,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$declare d jsonb;begin
 d:=public.quiz_manager_load(p_location_id,p_date);
 return public.quiz_manager_save_v2(p_location_id,coalesce((d->'quiz'->>'id')::uuid,gen_random_uuid()),p_date,p_title,p_instructions,p_questions,p_publish,p_version,coalesce((d->'quiz'->>'answers_released')::boolean,false));end;$$;
-- Preserve the current audited submission/points engine behind a private wrapper.
do $$begin
 if to_regprocedure('rebuild_private.quiz_submit_before_v2(uuid,integer,jsonb)') is null then
 alter function public.quiz_staff_submit(uuid,integer,jsonb) set schema rebuild_private;
 alter function rebuild_private.quiz_staff_submit(uuid,integer,jsonb) rename to quiz_submit_before_v2;
 end if;
 if to_regprocedure('rebuild_private.quiz_month_before_v2(uuid,date)') is null then
 alter function public.quiz_staff_month(uuid,date) set schema rebuild_private;
 alter function rebuild_private.quiz_staff_month(uuid,date) rename to quiz_month_before_v2;
 end if;
end;$$;
create or replace function public.quiz_staff_submit(p_quiz_id uuid,p_version integer,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare q public.daily_quizzes%rowtype;r jsonb;begin
 select * into q from public.daily_quizzes where id=p_quiz_id for update;
 if q.id is null then raise exception 'Quiz unavailable.';end if;
 perform public.app_access_assert(q.location_id,'quizzes','published');
 r:=rebuild_private.quiz_submit_before_v2(p_quiz_id,p_version,p_answers);
 -- Read the stamped stored result, including exact reward points, rather than the pre-trigger object.
 select a.result into r from public.daily_quiz_attempts a where a.quiz_id=p_quiz_id and a.user_id=auth.uid();
 return rebuild_private.staff_result(q,r);
end;$$;
create or replace function public.quiz_staff_month(p_location_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;items jsonb;begin
 d:=rebuild_private.quiz_month_before_v2(p_location_id,p_month);
 select coalesce(jsonb_agg(a||jsonb_build_object('result',rebuild_private.staff_result(q,a->'result')) order by n),'[]'::jsonb) into items from jsonb_array_elements(d->'attempts') with ordinality x(a,n) join public.daily_quizzes q on q.id=(a->>'quiz_id')::uuid;
 return d||jsonb_build_object('attempts',items);end;$$;
revoke all on all functions in schema rebuild_private from public,anon,authenticated;
revoke all on function public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean),public.quiz_manager_day_v2(uuid,date,uuid),public.quiz_staff_day_v2(uuid,date),public.quiz_staff_load(uuid,date),public.quiz_manager_load(uuid,date),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer),public.quiz_staff_submit(uuid,integer,jsonb),public.quiz_staff_month(uuid,date) from public,anon,authenticated;
grant execute on function public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean),public.quiz_manager_day_v2(uuid,date,uuid),public.quiz_staff_day_v2(uuid,date),public.quiz_staff_load(uuid,date),public.quiz_manager_load(uuid,date),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer),public.quiz_staff_submit(uuid,integer,jsonb),public.quiz_staff_month(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
