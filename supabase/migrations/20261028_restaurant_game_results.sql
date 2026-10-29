begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('justinis-restaurant-game-results',0));

do $requirements$
begin
 if to_regprocedure('public.closeout_is_member(uuid)') is null
 or to_regprocedure('public.mod_is_manager(uuid)') is null
 or to_regprocedure('public.points_source_entries(uuid)') is null then
  raise exception 'Membership and points prerequisites are missing. No update applied.';
 end if;
end;$requirements$;

create table if not exists public.restaurant_game_rounds(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references auth.users(id),
 request_id uuid not null,
 business_date date not null,
 game_id text not null check(game_id in ('order','table','sell','spot','rush','match','detective','switch','floor','script')),
 source text not null check(source in ('daily_challenge','games_page')),
 correct_count integer not null check(correct_count>=0),
 total integer not null check(total between 1 and 25 and correct_count<=total),
 score integer not null check(score>=0),
 completed_at timestamptz not null default clock_timestamp(),
 unique(location_id,user_id,request_id)
);
create index if not exists restaurant_game_rounds_profile
 on public.restaurant_game_rounds(location_id,user_id,business_date desc,completed_at desc);

create table if not exists public.restaurant_game_weekly_awards(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references auth.users(id),
 week_start date not null,
 milestone text not null check(milestone in ('THREE_DAYS','TEN_ROUNDS_THREE_GAMES')),
 points integer not null check(points=5),
 awarded_at timestamptz not null default clock_timestamp(),
 unique(location_id,user_id,week_start,milestone)
);
create index if not exists restaurant_game_awards_profile
 on public.restaurant_game_weekly_awards(location_id,user_id,week_start desc);

alter table public.restaurant_game_rounds enable row level security;
alter table public.restaurant_game_weekly_awards enable row level security;
revoke all on public.restaurant_game_rounds,public.restaurant_game_weekly_awards from public,anon,authenticated;

create schema if not exists game_points_private;
revoke all on schema game_points_private from public,anon,authenticated;
do $wrap_points$
begin
 if to_regprocedure('game_points_private.source_before_games(uuid)') is null then
  alter function public.points_source_entries(uuid) set schema game_points_private;
  alter function game_points_private.points_source_entries(uuid) rename to source_before_games;
 end if;
end;$wrap_points$;

create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $function$
 select * from game_points_private.source_before_games(p_location_id)
 union all
 select a.user_id,a.week_start,('game-award:'||a.id::text),a.points,
  case a.milestone when 'THREE_DAYS' then 'Restaurant games: practiced on three service days'
   else 'Restaurant games: ten qualifying rounds across three games' end
 from public.restaurant_game_weekly_awards a where a.location_id=p_location_id;
$function$;

create or replace function public.restaurant_game_round_submit(
 p_location_id uuid,p_request_id uuid,p_game_id text,p_correct integer,p_total integer,p_source text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 day date:=((now() at time zone 'America/Chicago')-interval '4 hours')::date;
 week date; prior public.restaurant_game_rounds%rowtype; saved public.restaurant_game_rounds%rowtype;
 practice_days integer; qualifying_rounds integer; practiced_games integer; earned jsonb:='[]'::jsonb;
 section text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active employee access required.' using errcode='42501';
 end if;
 if p_request_id is null then raise exception 'A round request ID is required.';end if;
 if p_game_id not in ('order','table','sell','spot','rush','match','detective','switch','floor','script') then raise exception 'Choose a valid restaurant game.';end if;
 if p_total is null or p_total not between 1 and 25 or p_correct is null or p_correct<0 or p_correct>p_total then raise exception 'The completed score is invalid.';end if;
 if p_source not in ('daily_challenge','games_page') then raise exception 'The game source is invalid.';end if;
 section:=case when p_game_id in ('order','match','switch') then 'food' when p_game_id='floor' then 'sections' else 'service' end;
 perform public.app_access_assert(p_location_id,case when p_game_id='floor' then 'floor' else 'training' end,section);

 select * into prior from public.restaurant_game_rounds
 where location_id=p_location_id and user_id=auth.uid() and request_id=p_request_id;
 if prior.id is not null then
  if prior.game_id<>p_game_id or prior.correct_count<>p_correct or prior.total<>p_total or prior.source<>p_source then
   raise exception 'This round request was already used with different results.';
  end if;
  return jsonb_build_object('saved',true,'id',prior.id,'awards','[]'::jsonb,'already_saved',true);
 end if;

 week:=day-(extract(isodow from day)::integer-1);
 perform pg_advisory_xact_lock(hashtextextended('game-week:'||p_location_id::text||':'||auth.uid()::text||':'||week::text,0));
 insert into public.restaurant_game_rounds(location_id,user_id,request_id,business_date,game_id,source,correct_count,total,score)
 values(p_location_id,auth.uid(),p_request_id,day,p_game_id,p_source,p_correct,p_total,p_correct*10)
 returning * into saved;

 select count(distinct business_date),count(*),count(distinct game_id)
 into practice_days,qualifying_rounds,practiced_games
 from (
  select business_date,game_id from public.restaurant_game_rounds
  where location_id=p_location_id and user_id=auth.uid() and business_date between week and week+6
  group by business_date,game_id
 ) qualifying;

 if practice_days>=3 then
  insert into public.restaurant_game_weekly_awards(location_id,user_id,week_start,milestone,points)
  values(p_location_id,auth.uid(),week,'THREE_DAYS',5) on conflict do nothing;
  if found then earned:=earned||jsonb_build_array(jsonb_build_object('milestone','THREE_DAYS','points',5));end if;
 end if;
 if qualifying_rounds>=10 and practiced_games>=3 then
  insert into public.restaurant_game_weekly_awards(location_id,user_id,week_start,milestone,points)
  values(p_location_id,auth.uid(),week,'TEN_ROUNDS_THREE_GAMES',5) on conflict do nothing;
  if found then earned:=earned||jsonb_build_array(jsonb_build_object('milestone','TEN_ROUNDS_THREE_GAMES','points',5));end if;
 end if;
 return jsonb_build_object('saved',true,'id',saved.id,'awards',earned,'already_saved',false);
end;$function$;

create or replace function public.restaurant_game_results_load(
 p_location_id uuid,p_user_id uuid default null,p_from date default null,p_to date default null
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare target uuid:=coalesce(p_user_id,auth.uid()); manager boolean; from_day date:=coalesce(p_from,((now() at time zone 'America/Chicago')::date-29));to_day date:=coalesce(p_to,(now() at time zone 'America/Chicago')::date);rows jsonb;awards jsonb;summary jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 if p_user_id is not null and p_user_id<>auth.uid() and not manager then raise exception 'Management access required.' using errcode='42501';end if;
 if p_user_id is not null and not exists(select 1 from public.location_memberships m where m.location_id=p_location_id and m.user_id=p_user_id and (m.status='active' or manager)) then raise exception 'Employee profile not found.';end if;
 if from_day is null or to_day is null or to_day<from_day or to_day-from_day>366 then raise exception 'Choose a date range of at most one year.';end if;

 select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_at desc),'[]'::jsonb) into rows from (
  select r.id,r.user_id,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member') name,r.business_date,r.game_id,r.source,r.score,r.total,r.correct_count,r.completed_at
  from public.restaurant_game_rounds r join public.profiles p on p.id=r.user_id
  where r.location_id=p_location_id and r.business_date between from_day and to_day
   and (case when p_user_id is not null then r.user_id=target when manager then true else r.user_id=auth.uid() end)
  order by r.completed_at desc limit 100
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.week_start desc,x.awarded_at desc),'[]'::jsonb) into awards from (
  select a.id,a.user_id,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team member') name,a.week_start,a.milestone,a.points,a.awarded_at
  from public.restaurant_game_weekly_awards a join public.profiles p on p.id=a.user_id
  where a.location_id=p_location_id and a.week_start<=to_day and a.week_start+6>=from_day
   and (case when p_user_id is not null then a.user_id=target when manager then true else a.user_id=auth.uid() end)
 ) x;
 select jsonb_build_object(
  'rounds',count(*),'practice_days',count(distinct r.business_date),
  'average_percent',coalesce(round(avg(r.correct_count::numeric/nullif(r.total,0))*100),0),
  'points_earned',coalesce((select sum(a.points) from public.restaurant_game_weekly_awards a where a.location_id=p_location_id and a.week_start<=to_day and a.week_start+6>=from_day and (case when p_user_id is not null then a.user_id=target when manager then true else a.user_id=auth.uid() end)),0),
  'best',coalesce((select jsonb_agg(to_jsonb(b) order by b.game_id) from (select game_id,max(correct_count) best_score,(array_agg(total order by correct_count desc,completed_at desc))[1] best_total,count(*) rounds from public.restaurant_game_rounds r where r.location_id=p_location_id and r.business_date between from_day and to_day and (case when p_user_id is not null then r.user_id=target when manager then true else r.user_id=auth.uid() end) group by game_id)b),'[]'::jsonb)
 ) into summary
 from public.restaurant_game_rounds r where r.location_id=p_location_id and r.business_date between from_day and to_day
 and (case when p_user_id is not null then r.user_id=target when manager then true else r.user_id=auth.uid() end);
 return jsonb_build_object('manager',manager,'summary',summary,'rows',rows,'awards',awards);
end;$function$;

revoke all on function game_points_private.source_before_games(uuid) from public,anon,authenticated;
revoke all on function public.points_source_entries(uuid),public.restaurant_game_round_submit(uuid,uuid,text,integer,integer,text),public.restaurant_game_results_load(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.restaurant_game_round_submit(uuid,uuid,text,integer,integer,text),public.restaurant_game_results_load(uuid,uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
