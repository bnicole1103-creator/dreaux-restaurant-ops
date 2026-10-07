begin;
create table if not exists public.preshift_open_receipts (
 post_id uuid not null references public.preshift_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 post_version integer not null check(post_version>0),
 source text not null check(source in ('home','feed')),
 first_opened_at timestamptz not null default clock_timestamp(),
 last_opened_at timestamptz not null default clock_timestamp(),
 primary key(post_id,user_id,post_version,source)
);
alter table public.preshift_open_receipts enable row level security;
revoke all on public.preshift_open_receipts from public,anon,authenticated;
create or replace function public.preshift_record_open(
 p_location_id uuid,p_post_id uuid,p_version integer,p_source text
) returns timestamptz language plpgsql security definer set search_path='' as $$
declare v integer; result timestamptz;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Location access required.' using errcode='42501';
 end if;
 if p_source is null or p_source not in ('home','feed') then raise exception 'Invalid opening source.'; end if;
 select version into v from public.preshift_posts
 where id=p_post_id and location_id=p_location_id and deleted_at is null for share;
 if v is null then raise exception 'Pre-shift not found.'; end if;
 if v is distinct from p_version then raise exception 'This pre-shift changed. Refresh the post.'; end if;
 insert into public.preshift_open_receipts(post_id,user_id,post_version,source)
 values(p_post_id,auth.uid(),v,p_source)
 on conflict(post_id,user_id,post_version,source) do update
 set last_opened_at=clock_timestamp()
 returning first_opened_at into result;
 return result;
end; $$;
create or replace function public.preshift_activity_report(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb; people jsonb;
begin
 report:=public.preshift_read_report(p_location_id,p_post_id);
 select coalesce(jsonb_agg(person || jsonb_build_object(
  'first_opened_at',(select min(o.first_opened_at) from public.preshift_open_receipts o
   where o.post_id=p_post_id and o.user_id=(person->>'user_id')::uuid and o.post_version=(report->>'version')::integer),
  'last_opened_at',(select max(o.last_opened_at) from public.preshift_open_receipts o
   where o.post_id=p_post_id and o.user_id=(person->>'user_id')::uuid and o.post_version=(report->>'version')::integer),
  'home_opened_at',(select min(o.first_opened_at) from public.preshift_open_receipts o
   where o.post_id=p_post_id and o.user_id=(person->>'user_id')::uuid and o.post_version=(report->>'version')::integer and o.source='home'),
  'feed_viewed_at',(select min(o.first_opened_at) from public.preshift_open_receipts o
   where o.post_id=p_post_id and o.user_id=(person->>'user_id')::uuid and o.post_version=(report->>'version')::integer and o.source='feed')
 ) order by n),'[]'::jsonb) into people
 from jsonb_array_elements(report->'rows') with ordinality x(person,n);
 return jsonb_set(report,'{rows}',people);
end; $$;
revoke all on function public.preshift_record_open(uuid,uuid,integer,text),
 public.preshift_activity_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preshift_record_open(uuid,uuid,integer,text),
 public.preshift_activity_report(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
