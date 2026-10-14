begin;
create table if not exists public.preshift_view_sessions (
 post_id uuid not null references public.preshift_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 post_version integer not null,
 session_id uuid not null,
 source text not null check(source in ('home','feed')),
 visible_ms bigint not null default 0 check(visible_ms>=0),
 started_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(post_id,user_id,post_version,session_id)
);
create table if not exists public.preshift_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.preshift_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 request_id uuid not null,
 body text not null check(length(body) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,request_id)
);
create table if not exists public.preshift_reactions (
 post_id uuid not null references public.preshift_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 emoji text not null check(emoji in ('👍','❤️','🎉','✅')),
 primary key(post_id,user_id,emoji)
);
alter table public.preshift_view_sessions enable row level security;
alter table public.preshift_comments enable row level security;
alter table public.preshift_reactions enable row level security;
revoke all on public.preshift_view_sessions,public.preshift_comments,public.preshift_reactions from public,anon,authenticated;
create or replace function public.preshift_post_access(p_location_id uuid,p_post_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Location access required.' using errcode='42501';
 end if;
 if not exists(select 1 from public.preshift_posts where id=p_post_id and location_id=p_location_id and deleted_at is null) then
  raise exception 'Post not found.';
 end if;
end; $$;
create or replace function public.preshift_record_view_time(
 p_location_id uuid,p_post_id uuid,p_version integer,p_session uuid,p_source text,p_visible_ms bigint
) returns void language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select version into v from public.preshift_posts where id=p_post_id for share;
 if v is distinct from p_version then raise exception 'Post changed. Refresh first.'; end if;
 if p_session is null or p_source is null or p_source not in ('home','feed') or p_visible_ms is null or p_visible_ms<0 then raise exception 'Invalid viewing receipt.'; end if;
 insert into public.preshift_view_sessions(post_id,user_id,post_version,session_id,source,visible_ms)
 values(p_post_id,auth.uid(),v,p_session,p_source,least(p_visible_ms,10000))
 on conflict(post_id,user_id,post_version,session_id) do update
 set visible_ms=greatest(public.preshift_view_sessions.visible_ms,
  least(p_visible_ms,(extract(epoch from(clock_timestamp()-public.preshift_view_sessions.started_at))*1000)::bigint+10000)),
 updated_at=clock_timestamp();
end; $$;
create or replace function public.preshift_viewing_report(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb; people jsonb;
begin
 report:=public.preshift_activity_report(p_location_id,p_post_id);
 select coalesce(jsonb_agg(person||jsonb_build_object('visible_ms',
  coalesce((select sum(s.visible_ms) from public.preshift_view_sessions s
   where s.post_id=p_post_id and s.user_id=(person->>'user_id')::uuid
   and s.post_version=(report->>'version')::integer),0)) order by n),'[]'::jsonb)
 into people from jsonb_array_elements(report->'rows') with ordinality x(person,n);
 return jsonb_set(report,'{rows}',people);
end; $$;
create or replace function public.preshift_post_social(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare comments jsonb; reactions jsonb;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select coalesce(jsonb_agg(x order by x.created_at),'[]'::jsonb) into comments from (
  select c.id,c.body,c.created_at,
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
create or replace function public.preshift_comment_save(p_location_id uuid,p_post_id uuid,p_request uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 if p_request is null or p_body is null or length(trim(p_body)) not between 1 and 2000 then raise exception 'Comment must contain 1–2000 characters.'; end if;
 insert into public.preshift_comments(post_id,user_id,request_id,body)
 values(p_post_id,auth.uid(),p_request,trim(p_body)) on conflict(user_id,request_id) do nothing;
 select id into result from public.preshift_comments where user_id=auth.uid() and request_id=p_request and post_id=p_post_id;
 if result is null then raise exception 'Request belongs to another post.'; end if;
 return result;
end; $$;
create or replace function public.preshift_comment_delete(p_location_id uuid,p_post_id uuid,p_comment uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 if exists(select 1 from public.preshift_comments where id=p_comment and post_id=p_post_id
  and user_id<>auth.uid()) and public.mod_is_manager(p_location_id) is not true then
  raise exception 'Only your own comments can be removed.' using errcode='42501';
 end if;
 delete from public.preshift_comments where id=p_comment and post_id=p_post_id;
end; $$;
create or replace function public.preshift_reaction_set(p_location_id uuid,p_post_id uuid,p_emoji text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 if p_emoji is null or p_emoji not in ('👍','❤️','🎉','✅') or p_enabled is null then raise exception 'Invalid reaction.'; end if;
 if p_enabled then
  insert into public.preshift_reactions(post_id,user_id,emoji) values(p_post_id,auth.uid(),p_emoji)
  on conflict do nothing;
 else delete from public.preshift_reactions where post_id=p_post_id and user_id=auth.uid() and emoji=p_emoji;
 end if;
end; $$;
revoke all on function public.preshift_post_access(uuid,uuid) from public,anon,authenticated;
revoke all on function public.preshift_record_view_time(uuid,uuid,integer,uuid,text,bigint),public.preshift_viewing_report(uuid,uuid),public.preshift_post_social(uuid,uuid),public.preshift_comment_save(uuid,uuid,uuid,text),public.preshift_comment_delete(uuid,uuid,uuid),public.preshift_reaction_set(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preshift_record_view_time(uuid,uuid,integer,uuid,text,bigint),public.preshift_viewing_report(uuid,uuid),public.preshift_post_social(uuid,uuid),public.preshift_comment_save(uuid,uuid,uuid,text),public.preshift_comment_delete(uuid,uuid,uuid),public.preshift_reaction_set(uuid,uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
