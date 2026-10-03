begin;
create table if not exists public.preshift_posts (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 author_id uuid not null references public.profiles(id),
 title text not null check (length(btrim(title)) between 1 and 160),
 body text not null check (length(btrim(body)) between 1 and 12000),
 shift_date date not null,
 pinned boolean not null default false,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),
 deleted_at timestamptz
);
create index if not exists preshift_posts_feed_idx on public.preshift_posts(location_id,created_at desc) where deleted_at is null;
alter table public.preshift_posts enable row level security;
revoke all on public.preshift_posts from public,anon,authenticated;

create or replace function public.preshift_feed(p_location_id uuid,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) then raise exception 'Location access required.' using errcode='42501'; end if;
 select jsonb_build_object('posts',coalesce((select jsonb_agg(to_jsonb(q) order by q.pinned desc,q.created_at desc,q.id desc) from (
  select t.id,t.title,t.body,t.shift_date,t.pinned,t.version,t.created_at,t.updated_at,
   coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Manager') as author
  from public.preshift_posts t left join public.profiles p on p.id=t.author_id
  where t.location_id=p_location_id and t.deleted_at is null
  order by t.pinned desc,t.created_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,50),1000))
 ) q),'[]'::jsonb),'total',(select count(*) from public.preshift_posts where location_id=p_location_id and deleted_at is null)) into result;
 return result;
end; $$;

create or replace function public.preshift_post_save(p_location_id uuid,p_id uuid,p_version integer,p_title text,p_body text,p_shift_date date,p_pinned boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare post_id uuid;
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not public.mod_is_manager(p_location_id) then raise exception 'Manager access required.' using errcode='42501'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_body is null or length(btrim(p_body)) not between 1 and 12000 or p_shift_date is null then raise exception 'Enter a title, post, and shift date.'; end if;
 if p_id is null then
  insert into public.preshift_posts(location_id,author_id,updated_by,title,body,shift_date,pinned)
  values(p_location_id,auth.uid(),auth.uid(),btrim(p_title),btrim(p_body),p_shift_date,coalesce(p_pinned,false)) returning id into post_id;
 else
  update public.preshift_posts set title=btrim(p_title),body=btrim(p_body),shift_date=p_shift_date,pinned=coalesce(p_pinned,false),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_id and location_id=p_location_id and deleted_at is null and version=p_version returning id into post_id;
  if post_id is null then raise exception 'This post changed or was removed. Refresh before editing.'; end if;
 end if;
 return post_id;
end; $$;

create or replace function public.preshift_post_remove(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.closeout_is_member(p_location_id) or not public.mod_is_manager(p_location_id) then raise exception 'Manager access required.' using errcode='42501'; end if;
 update public.preshift_posts set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1
 where id=p_id and location_id=p_location_id and deleted_at is null and version=p_version;
 if not found then raise exception 'This post changed or was removed. Refresh before removing.'; end if;
end; $$;
revoke all on function public.preshift_feed(uuid,integer),public.preshift_post_save(uuid,uuid,integer,text,text,date,boolean),public.preshift_post_remove(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.preshift_feed(uuid,integer),public.preshift_post_save(uuid,uuid,integer,text,text,date,boolean),public.preshift_post_remove(uuid,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
