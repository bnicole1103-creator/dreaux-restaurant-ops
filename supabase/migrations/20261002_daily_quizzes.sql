begin;
create table if not exists public.daily_quizzes (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 quiz_date date not null,
 title text not null,
 instructions text not null default '',
 questions jsonb not null default '[]',
 published boolean not null default false,
 version integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 unique(location_id,quiz_date)
);
create table if not exists public.daily_quiz_attempts (
 quiz_id uuid not null references public.daily_quizzes(id),
 user_id uuid not null references auth.users(id),
 answers jsonb not null,
 result jsonb not null,
 submitted_at timestamptz not null default now(),
 primary key(quiz_id,user_id)
);
alter table public.daily_quizzes enable row level security;
alter table public.daily_quiz_attempts enable row level security;
revoke all on public.daily_quizzes,public.daily_quiz_attempts from public,anon,authenticated;

create or replace function public.quiz_manager_load(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype;
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501'; end if;
 select * into q from public.daily_quizzes where location_id=p_location_id and quiz_date=p_date;
 return jsonb_build_object('quiz',case when q.id is null then null else to_jsonb(q) end,
 'results',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',coalesce(nullif(p.preferred_name,''),p.full_name,'Staff member'),'result',a.result,'submitted_at',a.submitted_at) order by a.submitted_at)
 from public.daily_quiz_attempts a left join public.profiles p on p.id=a.user_id where a.quiz_id=q.id),'[]'::jsonb));
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
  if exists(select 1 from public.daily_quiz_attempts where quiz_id=q.id) then raise exception 'This quiz has submissions and is locked. Create the next quiz on another date.'; end if;
  update public.daily_quizzes set title=btrim(p_title),instructions=coalesce(p_instructions,''),questions=p_questions,published=p_publish,version=version+1,updated_by=auth.uid(),updated_at=now() where id=q.id returning * into q;
 end if;
 return to_jsonb(q);
end; $$;

create or replace function public.quiz_staff_load(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype; result jsonb;
begin
 if public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501'; end if;
 select * into q from public.daily_quizzes where location_id=p_location_id and quiz_date=p_date and published
 and quiz_date<=(now() at time zone 'America/Chicago')::date;
 if q.id is null then return jsonb_build_object('quiz',null,'result',null); end if;
 select a.result into result from public.daily_quiz_attempts a where a.quiz_id=q.id and a.user_id=auth.uid();
 return jsonb_build_object('quiz',jsonb_build_object('id',q.id,'version',q.version,'title',q.title,'instructions',q.instructions,'quiz_date',q.quiz_date,
 'questions',coalesce((select jsonb_agg(value-'correct'-'explanation' order by n) from jsonb_array_elements(q.questions) with ordinality x(value,n)),'[]'::jsonb)), 'result',result);
end; $$;

create or replace function public.quiz_staff_submit(p_quiz_id uuid,p_version integer,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype; result jsonb; answer jsonb; item jsonb; pos integer:=0; score integer:=0; details jsonb:='[]'; choice integer;
begin
 select * into q from public.daily_quizzes where id=p_quiz_id for update;
 if q.id is null or public.closeout_is_member(q.location_id) is not true then raise exception 'Active location membership required.' using errcode='42501'; end if;
 if not q.published or q.quiz_date>(now() at time zone 'America/Chicago')::date then raise exception 'This quiz is not available.'; end if;
 select a.result into result from public.daily_quiz_attempts a where a.quiz_id=q.id and a.user_id=auth.uid();
 if result is not null then return result; end if;
 if p_version is distinct from q.version then raise exception 'Quiz changed. Reload it before submitting.'; end if;
 if jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Answer every question.'; end if;
 if jsonb_array_length(p_answers)<>jsonb_array_length(q.questions) then raise exception 'Answer every question.'; end if;
 for item in select value from jsonb_array_elements(q.questions) loop
  answer:=p_answers->pos;
  if jsonb_typeof(answer) is distinct from 'number' or (answer#>>'{}') !~ '^[0-9]+$' then raise exception 'Choose an answer for every question.'; end if;
  choice:=(answer#>>'{}')::integer;
  if choice<0 or choice>=jsonb_array_length(item->'options') then raise exception 'Invalid answer choice.'; end if;
  if choice=(item->>'correct')::integer then score:=score+1; end if;
  details:=details||jsonb_build_array(jsonb_build_object('prompt',item->>'prompt','category',item->>'category','selected',item->'options'->choice,'correct_answer',item->'options'->((item->>'correct')::integer),'correct',choice=(item->>'correct')::integer,'explanation',item->>'explanation'));
  pos:=pos+1;
 end loop;
 result:=jsonb_build_object('score',score,'total',pos,'percent',round(100.0*score/pos,1),'questions',details);
 insert into public.daily_quiz_attempts(quiz_id,user_id,answers,result) values(q.id,auth.uid(),p_answers,result);
 return result;
end; $$;

revoke all on function public.quiz_manager_load(uuid,date),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer),public.quiz_staff_load(uuid,date),public.quiz_staff_submit(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.quiz_manager_load(uuid,date),public.quiz_manager_save(uuid,date,text,text,jsonb,boolean,integer),public.quiz_staff_load(uuid,date),public.quiz_staff_submit(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
