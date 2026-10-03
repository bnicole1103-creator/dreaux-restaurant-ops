begin;

create or replace function public.quiz_reward_value(p_score integer,p_total integer)
returns integer language sql immutable set search_path='' as $$
 select case when p_total>0 and p_score=p_total then 5
  when p_total>0 and p_score between 0 and p_total and p_score::numeric*5>=p_total::numeric*4 then 3 else 0 end;
$$;
revoke all on function public.quiz_reward_value(integer,integer) from public,anon,authenticated;
alter table public.daily_quiz_attempts add column if not exists reward_points integer not null default 0;
create or replace function public.quiz_stamp_rewards()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.reward_points:=public.quiz_reward_value((new.result->>'score')::integer,(new.result->>'total')::integer);
 new.result:=new.result||jsonb_build_object('reward_points',new.reward_points,'completion_points',0,'bonus_points',new.reward_points);
 new.submitted_at:=now();return new;
end; $$;
revoke all on function public.quiz_stamp_rewards() from public,anon,authenticated;
drop trigger if exists quiz_stamp_rewards on public.daily_quiz_attempts;
create trigger quiz_stamp_rewards before insert on public.daily_quiz_attempts for each row execute function public.quiz_stamp_rewards();
update public.daily_quiz_attempts set reward_points=public.quiz_reward_value((result->>'score')::integer,(result->>'total')::integer),
 result=result||jsonb_build_object('reward_points',public.quiz_reward_value((result->>'score')::integer,(result->>'total')::integer),'completion_points',0,'bonus_points',public.quiz_reward_value((result->>'score')::integer,(result->>'total')::integer));

create table if not exists public.quiz_requirements (
 quiz_id uuid not null references public.daily_quizzes(id),user_id uuid not null references auth.users(id),
 due_at timestamptz not null,assigned_at timestamptz not null default now(),assigned_by uuid not null references auth.users(id),
 primary key(quiz_id,user_id)
);
create table if not exists public.point_entry_overrides (
 location_id uuid not null references public.locations(id),user_id uuid not null references auth.users(id),entry_key text not null,
 points integer not null check(points between -10000 and 10000),reason text not null,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(location_id,user_id,entry_key)
);
create table if not exists public.point_entry_edit_audit (
 id bigint generated always as identity primary key,location_id uuid not null,user_id uuid not null,entry_key text not null,
 previous_points integer not null,new_points integer not null,reason text not null,
 changed_by uuid not null,changed_at timestamptz not null default now()
);
alter table public.quiz_requirements enable row level security;
alter table public.point_entry_overrides enable row level security;
alter table public.point_entry_edit_audit enable row level security;
revoke all on public.quiz_requirements,public.point_entry_overrides,public.point_entry_edit_audit from public,anon,authenticated;

create or replace function public.quiz_manager_roster(p_location_id uuid,p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if not exists(select 1 from public.daily_quizzes where id=p_quiz_id and location_id=p_location_id) then raise exception 'Quiz not found.';end if;
 return jsonb_build_object('due_at',(select ((quiz_date+1)+time '04:00') at time zone 'America/Chicago' from public.daily_quizzes where id=p_quiz_id),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member'),
   'required',r.user_id is not null,'submitted',exists(select 1 from public.daily_quiz_attempts a where a.quiz_id=p_quiz_id and a.user_id=m.user_id)) order by p.full_name)
   from public.location_memberships m join public.profiles p on p.id=m.user_id
   left join public.quiz_requirements r on r.quiz_id=p_quiz_id and r.user_id=m.user_id
   where m.location_id=p_location_id and m.status='active'),'[]'::jsonb));
end; $$;

create or replace function public.quiz_manager_set_roster(p_location_id uuid,p_quiz_id uuid,p_users uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare q public.daily_quizzes%rowtype; due timestamptz; u uuid;
begin
 if public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 select * into q from public.daily_quizzes where id=p_quiz_id and location_id=p_location_id for update;
 if q.id is null or not q.published then raise exception 'Publish this quiz before assigning staff.';end if;
 due:=((q.quiz_date+1)+time '04:00') at time zone 'America/Chicago';
 if now()>=due then raise exception 'The deadline has passed. The GM can waive a deduction in Points.';end if;
 if p_users is null then raise exception 'Select the required staff.';end if;
 foreach u in array p_users loop
  if not exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=u and m.status='active') then raise exception 'Active staff at this location required.';end if;
 end loop;
 delete from public.quiz_requirements where quiz_id=q.id and not(user_id=any(p_users));
 insert into public.quiz_requirements(quiz_id,user_id,due_at,assigned_by)
 select q.id,x,due,auth.uid() from (select distinct unnest(p_users) x) staff
 on conflict(quiz_id,user_id) do nothing;
end; $$;

create or replace function public.quiz_cancel_future_requirements()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.published and not new.published then
  delete from public.quiz_requirements where quiz_id=new.id and due_at>now();
 end if;return new;
end; $$;
revoke all on function public.quiz_cancel_future_requirements() from public,anon,authenticated;
drop trigger if exists quiz_cancel_future_requirements on public.daily_quizzes;
create trigger quiz_cancel_future_requirements after update of published on public.daily_quizzes for each row execute function public.quiz_cancel_future_requirements();

-- Private canonical entries shared by the leaderboard and GM editor.
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 select t.user_id,t.business_date::date,'reward:'||(to_jsonb(t)->>'id'),t.points::integer,t.description::text
 from public.reward_point_transactions t where t.location_id=p_location_id
  and not exists(select 1 from public.daily_closeouts c where c.id=t.closeout_id and to_jsonb(c)->>'deleted_at' is not null)
 union all
 select t.user_id,t.business_date,'rating:'||t.source_key,t.points,
  coalesce((select a.rule_snapshot->>'reason' from public.manager_point_awards a where 'award:'||a.request_id::text=t.source_key and a.location_id=t.location_id),'Manager performance adjustment')::text
 from public.mod_rating_points t where t.location_id=p_location_id
 union all
 select a.user_id,q.quiz_date,'quiz:'||q.id::text,a.reward_points,('Pre-shift quiz: '||q.title)::text
 from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id where q.location_id=p_location_id
 union all
 select r.user_id,q.quiz_date,'missed:'||q.id::text,-10,('Missed pre-shift quiz: '||q.title)::text
 from public.quiz_requirements r join public.daily_quizzes q on q.id=r.quiz_id where q.location_id=p_location_id and now()>=r.due_at
  and not exists(select 1 from public.daily_quiz_attempts a where a.quiz_id=r.quiz_id and a.user_id=r.user_id and a.submitted_at<=r.due_at);
$$;
revoke all on function public.points_source_entries(uuid) from public,anon,authenticated;

create or replace function public.mod_points_dashboard(p_location_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_start date:=date_trunc('month',p_month)::date; payload jsonb;
begin
 if public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if month_start is null then raise exception 'Select a month.';end if;
 with events as (
  select s.user_id,s.business_date,s.entry_key,coalesce(o.points,s.points) as points,s.description
  from public.points_source_entries(p_location_id) s left join public.point_entry_overrides o
   on o.location_id=p_location_id and o.user_id=s.user_id and o.entry_key=s.entry_key
 ), totals as (
  select m.user_id,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member') as name,100+coalesce(sum(e.points),0) as total
  from public.location_memberships m left join public.profiles p on p.id=m.user_id
  left join events e on e.user_id=m.user_id and e.business_date>=month_start and e.business_date<month_start+interval '1 month'
  where m.location_id=p_location_id and m.status='active' group by m.user_id,p.preferred_name,p.full_name
 ), standings as(select *,dense_rank() over(order by total desc) as rank from totals)
 select jsonb_build_object('standings',coalesce((select jsonb_agg(to_jsonb(s) order by rank,name) from standings s),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by business_date desc,entry_key) from (
   select business_date,entry_key,points,description from events where user_id=auth.uid() and business_date>=month_start and business_date<month_start+interval '1 month'
  ) h),'[]'::jsonb)) into payload;return payload;
end; $$;

create or replace function public.points_gm_entries(p_location_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_start date:=date_trunc('month',p_month)::date;
begin
 if public.closeout_is_gm(p_location_id) is not true then raise exception 'GM access required.' using errcode='42501';end if;
 if month_start is null then raise exception 'Select a month.';end if;
 return coalesce((select jsonb_agg(to_jsonb(e) order by business_date desc,name,entry_key) from (
  select s.user_id,s.business_date,s.entry_key,s.points as original_points,coalesce(o.points,s.points) as points,s.description,
   coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member') as name,o.reason,o.updated_at,o.updated_by
  from public.points_source_entries(p_location_id) s left join public.profiles p on p.id=s.user_id
  left join public.point_entry_overrides o on o.location_id=p_location_id and o.user_id=s.user_id and o.entry_key=s.entry_key
  where s.business_date>=month_start and s.business_date<month_start+interval '1 month'
 ) e),'[]'::jsonb);
end; $$;

create or replace function public.points_gm_edit(p_location_id uuid,p_user_id uuid,p_entry_key text,p_points integer,p_expected integer,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare original integer; current_points integer; next_points integer;
begin
 if public.closeout_is_gm(p_location_id) is not true then raise exception 'GM access required.' using errcode='42501';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a reason for the edit.';end if;
 if p_points is not null and p_points not between -10000 and 10000 then raise exception 'Points must be between -10000 and 10000.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text||p_user_id::text||p_entry_key,0));
 select s.points into original from public.points_source_entries(p_location_id) s where s.user_id=p_user_id and s.entry_key=p_entry_key;
 if original is null then raise exception 'Point entry not found. Refresh the list.';end if;
 select coalesce((select points from public.point_entry_overrides where location_id=p_location_id and user_id=p_user_id and entry_key=p_entry_key),original) into current_points;
 if current_points is distinct from p_expected then raise exception 'Points changed. Refresh before editing.';end if;
 next_points:=coalesce(p_points,original);
 if p_points is null then delete from public.point_entry_overrides where location_id=p_location_id and user_id=p_user_id and entry_key=p_entry_key;
 else insert into public.point_entry_overrides(location_id,user_id,entry_key,points,reason,updated_by)
  values(p_location_id,p_user_id,p_entry_key,p_points,btrim(p_reason),auth.uid())
  on conflict(location_id,user_id,entry_key) do update set points=excluded.points,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();end if;
 insert into public.point_entry_edit_audit(location_id,user_id,entry_key,previous_points,new_points,reason,changed_by)
 values(p_location_id,p_user_id,p_entry_key,current_points,next_points,btrim(p_reason),auth.uid());
end; $$;

create or replace function public.quiz_staff_month(p_location_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_start date:=date_trunc('month',p_month)::date; payload jsonb;
begin
 if public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 if month_start is null then raise exception 'Select a month.';end if;
 with attempts as (
  select q.id as quiz_id,q.quiz_date,q.title,a.result,a.submitted_at,(a.result->>'score')::integer as correct,(a.result->>'total')::integer as possible,
   coalesce(o.points,a.reward_points) as points
  from public.daily_quiz_attempts a join public.daily_quizzes q on q.id=a.quiz_id
  left join public.point_entry_overrides o on o.location_id=p_location_id and o.user_id=a.user_id and o.entry_key='quiz:'||q.id::text
  where q.location_id=p_location_id and a.user_id=auth.uid() and q.quiz_date>=month_start and q.quiz_date<month_start+interval '1 month'
 ), running as(select *,sum(correct) over(order by quiz_date,submitted_at,quiz_id rows unbounded preceding) as running_score from attempts),
 penalties as(
  select s.business_date,s.entry_key,coalesce(o.points,s.points) as points,s.description
  from public.points_source_entries(p_location_id) s left join public.point_entry_overrides o on o.location_id=p_location_id and o.user_id=s.user_id and o.entry_key=s.entry_key
  where s.user_id=auth.uid() and s.entry_key like 'missed:%' and s.business_date>=month_start and s.business_date<month_start+interval '1 month'
 )
 select jsonb_build_object('month',month_start,'points',coalesce(sum(points),0)+coalesce((select sum(points) from penalties),0),
  'correct',coalesce(sum(correct),0),'possible',coalesce(sum(possible),0),'completed',count(*),
  'requirements',coalesce((select jsonb_agg(jsonb_build_object('quiz_id',q.id,'due_at',r.due_at)) from public.quiz_requirements r join public.daily_quizzes q on q.id=r.quiz_id where q.location_id=p_location_id and r.user_id=auth.uid() and q.quiz_date>=month_start and q.quiz_date<month_start+interval '1 month'),'[]'::jsonb),
  'penalties',coalesce((select jsonb_agg(to_jsonb(p) order by business_date desc) from penalties p),'[]'::jsonb),
  'attempts',coalesce(jsonb_agg(jsonb_build_object('quiz_id',quiz_id,'quiz_date',quiz_date,'title',title,'result',result,'submitted_at',submitted_at,
   'earned_points',points,'running_score',running_score) order by quiz_date desc,submitted_at desc,quiz_id),'[]'::jsonb)) into payload from running;
 return payload;
end; $$;

revoke all on function public.quiz_manager_roster(uuid,uuid),public.quiz_manager_set_roster(uuid,uuid,uuid[]),public.mod_points_dashboard(uuid,date),public.points_gm_entries(uuid,date),public.points_gm_edit(uuid,uuid,text,integer,integer,text),public.quiz_staff_month(uuid,date) from public,anon,authenticated;
grant execute on function public.quiz_manager_roster(uuid,uuid),public.quiz_manager_set_roster(uuid,uuid,uuid[]),public.mod_points_dashboard(uuid,date),public.points_gm_entries(uuid,date),public.points_gm_edit(uuid,uuid,text,integer,integer,text),public.quiz_staff_month(uuid,date) to authenticated;
alter table public.daily_closeouts add column if not exists submitted_at timestamptz;
update public.daily_closeouts set submitted_at=created_at
 where status='submitted' and submitted_at is null;

create or replace function public.closeout_stamp_submission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.submitted_at:=case when new.status='submitted' then now() else null end;
 else
  new.submitted_at:=old.submitted_at;
  if new.status='submitted' and old.submitted_at is null then new.submitted_at:=now(); end if;
 end if;
 return new;
end; $$;
revoke all on function public.closeout_stamp_submission() from public,anon,authenticated;
drop trigger if exists closeout_stamp_submission on public.daily_closeouts;
create trigger closeout_stamp_submission before insert or update on public.daily_closeouts
 for each row execute function public.closeout_stamp_submission();

create or replace function public.closeout_manager_submission(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare loc uuid;
begin
 select location_id into loc from public.shifts where id=p_shift_id;
 if loc is null or public.mod_is_manager(loc) is not true then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 return (select jsonb_build_object('submitted_at',c.submitted_at,'updated_at',c.updated_at)
  from public.mod_closeouts c where c.shift_id=p_shift_id);
end; $$;


revoke all on function public.closeout_manager_submission(uuid) from public,anon,authenticated;
grant execute on function public.closeout_manager_submission(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
