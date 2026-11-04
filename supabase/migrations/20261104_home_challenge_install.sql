begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('justinis-manager-daily-challenges',0));

do $requirements$
begin
 if to_regprocedure('public.closeout_is_member(uuid)') is null
 or to_regprocedure('public.mod_is_manager(uuid)') is null
 or to_regclass('public.restaurant_game_rounds') is null then
  raise exception 'Restaurant game and membership prerequisites are missing. No update applied.';
 end if;
end;$requirements$;

create table if not exists public.restaurant_daily_challenges(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 game_id text not null check(game_id in ('order','table','sell','spot','rush','match','detective','switch','floor','script')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 focus text not null default '' check(length(focus)<=500),
 published_by uuid not null references auth.users(id),
 published_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 archived_at timestamptz,
 check(ends_at>starts_at),
 check(ends_at-starts_at<=interval '31 days')
);
create index if not exists restaurant_daily_challenges_active
 on public.restaurant_daily_challenges(location_id,starts_at,ends_at) where archived_at is null;
alter table public.restaurant_daily_challenges enable row level security;
revoke all on public.restaurant_daily_challenges from public,anon,authenticated;

create or replace function public.restaurant_daily_challenge_load(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare active_row public.restaurant_daily_challenges%rowtype;next_row public.restaurant_daily_challenges%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active employee access required.' using errcode='42501';end if;
 select * into active_row from public.restaurant_daily_challenges where location_id=p_location_id and archived_at is null and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
 select * into next_row from public.restaurant_daily_challenges where location_id=p_location_id and archived_at is null and starts_at>now() order by starts_at limit 1;
 return jsonb_build_object('manager',public.mod_is_manager(p_location_id) is true,'active',case when active_row.id is null then null else to_jsonb(active_row)-array['location_id','published_by','archived_at'] end,'next',case when next_row.id is null then null else to_jsonb(next_row)-array['location_id','published_by','archived_at'] end);
end;$function$;

create or replace function public.restaurant_daily_challenge_publish(p_location_id uuid,p_id uuid,p_game_id text,p_starts_at timestamptz,p_ends_at timestamptz,p_focus text default '')
returns jsonb language plpgsql security definer set search_path='' as $function$
declare saved public.restaurant_daily_challenges%rowtype;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_game_id not in ('order','table','sell','spot','rush','match','detective','switch','floor','script') then raise exception 'Choose a valid restaurant game.';end if;
 if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '31 days' then raise exception 'Choose a challenge period of no more than 31 days.';end if;
 if length(coalesce(p_focus,''))>500 then raise exception 'Keep the service focus within 500 characters.';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-challenge:'||p_location_id::text,0));
 if p_id is not null and not exists(select 1 from public.restaurant_daily_challenges where id=p_id and location_id=p_location_id and archived_at is null) then raise exception 'This challenge changed. Reload before editing.';end if;
 update public.restaurant_daily_challenges set archived_at=clock_timestamp(),updated_at=clock_timestamp()
 where location_id=p_location_id and archived_at is null and id is distinct from p_id and tstzrange(starts_at,ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)');
 if p_id is null then
  insert into public.restaurant_daily_challenges(location_id,game_id,starts_at,ends_at,focus,published_by)
  values(p_location_id,p_game_id,p_starts_at,p_ends_at,btrim(coalesce(p_focus,'')),auth.uid()) returning * into saved;
 else
  update public.restaurant_daily_challenges set game_id=p_game_id,starts_at=p_starts_at,ends_at=p_ends_at,focus=btrim(coalesce(p_focus,'')),published_by=auth.uid(),published_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_id and location_id=p_location_id and archived_at is null returning * into saved;
 end if;
 return to_jsonb(saved)-array['location_id','published_by','archived_at'];
end;$function$;

create or replace function public.restaurant_daily_challenge_round_guard()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.source='daily_challenge' and not exists(
  select 1 from public.restaurant_daily_challenges c where c.location_id=new.location_id and c.archived_at is null and c.game_id=new.game_id and c.starts_at<=new.completed_at and c.ends_at>new.completed_at
 ) then raise exception 'This is not the currently published daily challenge. Return Home and open the assigned challenge.';
 end if;
 return new;
end;$function$;

drop trigger if exists restaurant_daily_challenge_round_guard on public.restaurant_game_rounds;
create trigger restaurant_daily_challenge_round_guard before insert on public.restaurant_game_rounds for each row execute function public.restaurant_daily_challenge_round_guard();

revoke all on function public.restaurant_daily_challenge_load(uuid),public.restaurant_daily_challenge_publish(uuid,uuid,text,timestamptz,timestamptz,text),public.restaurant_daily_challenge_round_guard() from public,anon,authenticated;
grant execute on function public.restaurant_daily_challenge_load(uuid),public.restaurant_daily_challenge_publish(uuid,uuid,text,timestamptz,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;

select true as manager_daily_challenges_installed,false as production_behavior_verified;

begin;
create or replace function public.restaurant_daily_challenge_stop(p_location_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-challenge:'||p_location_id::text,0));
 update public.restaurant_daily_challenges set archived_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and location_id=p_location_id and archived_at is null;
 if not found then raise exception 'Challenge unavailable. Refresh Home.';end if;
end;$$;
revoke all on function public.restaurant_daily_challenge_stop(uuid,uuid) from public,anon,authenticated;
grant execute on function public.restaurant_daily_challenge_stop(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
