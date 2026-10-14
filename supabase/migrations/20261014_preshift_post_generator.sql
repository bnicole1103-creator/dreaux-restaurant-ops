begin;
create schema if not exists preshift_writing_private;
revoke all on schema preshift_writing_private from public,anon,authenticated;
create table if not exists preshift_writing_private.generation_requests (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 user_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists preshift_post_generation_user_time on preshift_writing_private.generation_requests(user_id,created_at);
alter table preshift_writing_private.generation_requests enable row level security;
revoke all on preshift_writing_private.generation_requests from public,anon,authenticated;
create or replace function public.preshift_post_generation_claim(p_location_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then
 raise exception 'Manager access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('preshift-writing:'||auth.uid()::text,0));
 if exists(select 1 from preshift_writing_private.generation_requests where user_id=auth.uid() and created_at>now()-interval '15 seconds') then raise exception 'Wait 15 seconds before generating another pre-shift.';end if;
 if (select count(*) from preshift_writing_private.generation_requests where user_id=auth.uid() and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily pre-shift generation limit reached. You can still write or edit your post.';end if;
 insert into preshift_writing_private.generation_requests(location_id,user_id) values(p_location_id,auth.uid());
 return true;
end;$$;
revoke all on function public.preshift_post_generation_claim(uuid) from public,anon,authenticated;
grant execute on function public.preshift_post_generation_claim(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
