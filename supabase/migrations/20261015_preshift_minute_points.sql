begin;
do $$begin
 if to_regclass('public.preshift_view_sessions') is null
 or to_regclass('public.staff_scheduled_shifts') is null
 or to_regprocedure('public.points_source_entries(uuid)') is null
 or to_regprocedure('staff_ops_private.roster_ready(uuid,date)') is null
 or to_regprocedure('public.closeout_rule_value(jsonb,text)') is null
 or to_regprocedure('shift_context_private.target_for(uuid,uuid,date,time,text,jsonb)') is null
 or not exists(select 1 from pg_trigger where tgrelid='public.daily_closeouts'::regclass and tgname='zy_closeout_automatic_target' and tgenabled<>'D')
 or not exists(select 1 from pg_trigger where tgrelid='public.daily_closeouts'::regclass and tgname='closeout_sync_scored_points' and tgenabled<>'D')
 then raise exception 'Install viewing receipts, confirmed schedule, automatic closeout targets and closeout scoring first.';end if;
end;$$;
create schema if not exists preshift_points_private;
revoke all on schema preshift_points_private from public,anon,authenticated;
create table if not exists public.preshift_minute_policy(
 location_id uuid primary key references public.locations(id),
 effective_at timestamptz not null default clock_timestamp()
);
insert into public.preshift_minute_policy(location_id) select id from public.locations on conflict do nothing;
create table if not exists public.preshift_minute_requirements(
 post_id uuid primary key references public.preshift_posts(id) on delete cascade,
 required boolean not null default false,
 required_from timestamptz not null default clock_timestamp()
);
create table if not exists public.preshift_view_intervals(
 id bigint generated always as identity primary key,
 post_id uuid not null references public.preshift_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 started_at timestamptz not null,ended_at timestamptz not null,
 check(ended_at>started_at)
);
create index if not exists preshift_intervals_person on public.preshift_view_intervals(post_id,user_id,ended_at);
alter table public.preshift_view_sessions add column if not exists reported_ms bigint;
update public.preshift_view_sessions set reported_ms=visible_ms where reported_ms is null;
alter table public.preshift_view_sessions alter column reported_ms set default 0;
alter table public.preshift_view_sessions alter column reported_ms set not null;
alter table public.preshift_minute_policy enable row level security;
alter table public.preshift_minute_requirements enable row level security;
alter table public.preshift_view_intervals enable row level security;
revoke all on public.preshift_minute_policy,public.preshift_minute_requirements,public.preshift_view_intervals from public,anon,authenticated;
grant select,insert,update,delete on public.preshift_minute_policy,public.preshift_minute_requirements,public.preshift_view_intervals to service_role;
grant usage,select on sequence public.preshift_view_intervals_id_seq to service_role;
-- New management posts are required by default. Existing posts remain unchanged.
create or replace function preshift_points_private.mark_post() returns trigger
language plpgsql security definer set search_path='' as $$
declare managed boolean;
begin
 if nullif(to_jsonb(new)->>'staff_post_request_id','') is not null then return new;end if;
 managed:=coalesce(public.mod_is_manager(new.location_id),false) and auth.uid()=new.author_id;
 if auth.uid() is null then
  managed:=exists(select 1 from public.location_memberships m where m.location_id=new.location_id and m.user_id=new.author_id and m.status='active' and m.role in ('owner','general_manager','manager','assistant_manager'));
 end if;
 if managed then
  insert into public.preshift_minute_policy(location_id) values(new.location_id) on conflict do nothing;
  insert into public.preshift_minute_requirements(post_id,required) values(new.id,true) on conflict do nothing;
 end if;
 return new;
end;$$;
drop trigger if exists preshift_minute_new_post on public.preshift_posts;
create trigger preshift_minute_new_post after insert on public.preshift_posts for each row execute function preshift_points_private.mark_post();
-- Record active viewing intervals; overlapping tabs cannot count twice.
create or replace function public.preshift_record_view_time(
 p_location_id uuid,p_post_id uuid,p_version integer,p_session uuid,p_source text,p_visible_ms bigint
) returns void language plpgsql security definer set search_path='' as $$
declare v integer;s public.preshift_view_sessions;at_time timestamptz;delta_ms bigint;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select version into v from public.preshift_posts where id=p_post_id for share;
 if v is distinct from p_version then raise exception 'Post changed. Refresh first.';end if;
 if p_session is null or p_source is null or p_source not in ('home','feed') or p_visible_ms is null or p_visible_ms<0 then raise exception 'Invalid viewing receipt.';end if;
 insert into public.preshift_view_sessions(post_id,user_id,post_version,session_id,source,visible_ms,reported_ms)
 values(p_post_id,auth.uid(),v,p_session,p_source,0,p_visible_ms) on conflict do nothing;
 select * into s from public.preshift_view_sessions where post_id=p_post_id and user_id=auth.uid() and post_version=v and session_id=p_session for update;
 at_time:=clock_timestamp();
 delta_ms:=greatest(0,least(p_visible_ms-s.reported_ms,floor(extract(epoch from(at_time-s.updated_at))*1000)::bigint));
 if delta_ms>0 then
  insert into public.preshift_view_intervals(post_id,user_id,started_at,ended_at)
  values(p_post_id,auth.uid(),at_time-delta_ms*interval '1 millisecond',at_time);
 end if;
 update public.preshift_view_sessions set visible_ms=visible_ms+delta_ms,reported_ms=greatest(reported_ms,p_visible_ms),updated_at=at_time
 where post_id=p_post_id and user_id=auth.uid() and post_version=v and session_id=p_session;
end;$$;
create or replace function preshift_points_private.viewed_ms(p_post uuid,p_user uuid,p_cutoff timestamptz)
returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(floor(sum(extract(epoch from(upper(r)-lower(r))))*1000)::bigint,0)
 from unnest((select range_agg(tstzrange(started_at,least(ended_at,p_cutoff),'[)'))
 from public.preshift_view_intervals where post_id=p_post and user_id=p_user and started_at<p_cutoff)) r;
$$;
create or replace function public.preshift_minute_status(p_location_id uuid,p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare due timestamptz;applies boolean;
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 select min(least(s.end_at,coalesce((select min(c.submitted_at) from public.daily_closeouts c
  where c.location_id=s.location_id and c.user_id=s.user_id and c.closeout_date=s.business_date
   and c.status='submitted' and c.deleted_at is null),s.end_at))) into due
 from public.staff_scheduled_shifts s join public.preshift_posts p on p.id=p_post_id
 where s.location_id=p_location_id and s.user_id=auth.uid() and s.business_date=p.shift_date
  and s.end_at>s.start_at and staff_ops_private.roster_ready(s.location_id,s.business_date);
 select coalesce(r.required and due>=policy.effective_at+interval '60 seconds'
  and greatest(r.required_from,p.created_at)<=due-interval '60 seconds',false) into applies
 from public.preshift_posts p left join public.preshift_minute_requirements r on r.post_id=p.id
 left join public.preshift_minute_policy policy on policy.location_id=p.location_id where p.id=p_post_id;
 return jsonb_build_object('required',coalesce((select required from public.preshift_minute_requirements where post_id=p_post_id),false),
 'can_manage',public.closeout_is_gm(p_location_id),'deadline',due,'applies_to_me',coalesce(applies,false),
 'missed',coalesce(applies and now()>=due and preshift_points_private.viewed_ms(p_post_id,auth.uid(),due)<60000,false),
 'visible_ms',preshift_points_private.viewed_ms(p_post_id,auth.uid(),now()));
end;$$;
create or replace function public.preshift_minute_set(p_location_id uuid,p_post_id uuid,p_required boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.preshift_post_access(p_location_id,p_post_id);
 if public.closeout_is_gm(p_location_id) is not true then raise exception 'GM access required.' using errcode='42501';end if;
 if p_required is null then raise exception 'Choose whether viewing is required.';end if;
 insert into public.preshift_minute_requirements(post_id,required) values(p_post_id,p_required)
 on conflict(post_id) do update set required=excluded.required,
 required_from=case when not public.preshift_minute_requirements.required and excluded.required then clock_timestamp() else public.preshift_minute_requirements.required_from end;
end;$$;
-- A submitted closeout may have arrived before its automatic target was ready.
-- Award the configured sales tier once it is ready, without inventing actual sales.
create or replace function preshift_points_private.pending_sales(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language plpgsql stable security definer set search_path='' as $$
declare c public.daily_closeouts;target jsonb;ratio numeric;code text;amount integer;
begin
 for c in select x.* from public.daily_closeouts x join public.preshift_minute_policy p on p.location_id=x.location_id
 where x.location_id=p_location_id and x.status='submitted' and x.deleted_at is null
  and x.submitted_at>=p.effective_at and x.net_sales is not null
  and coalesce((x.automatic_target_snapshot->>'ready')::boolean,false) is not true
  and not(coalesce(to_jsonb(x)->'omitted_questions','[]'::jsonb)?'staff_3')
  and not exists(select 1 from public.reward_point_transactions t where t.closeout_id=x.id
   and t.user_id=x.user_id and t.action_code in ('SALES_TARGET','SALES_110','SALES_125'))
 loop
  target:=shift_context_private.target_for(c.location_id,c.user_id,c.closeout_date,c.scheduled_start::time,c.job_role,
   shift_context_private.target_day(c.location_id,c.closeout_date));
  if coalesce((target->>'ready')::boolean,false) is not true or coalesce((target->>'target')::numeric,0)<=0 then continue;end if;
  ratio:=c.net_sales/(target->>'target')::numeric*100;
  code:=case when ratio>=125 then 'SALES_125' when ratio>=110 then 'SALES_110' when ratio>=100 then 'SALES_TARGET' else null end;
  if code is null then continue;end if;
  amount:=public.closeout_rule_value(coalesce(c.point_rules_snapshot,public.closeout_config_internal(c.location_id)->'rules'),code);
  return query select c.user_id,c.closeout_date,'automatic-sales:'||c.id::text,amount,
   ('Sales target: '||round(ratio,1)::text||'% (automatic target became available after submission)')::text;
 end loop;
end;$$;
-- Preserve all existing quiz, sales, closeout, task and manager-adjustment entries.
do $$begin
 if to_regprocedure('preshift_points_private.source_before_minute(uuid)') is null then
  alter function public.points_source_entries(uuid) set schema preshift_points_private;
  alter function preshift_points_private.points_source_entries(uuid) rename to source_before_minute;
 end if;
end;$$;
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 select * from preshift_points_private.source_before_minute(p_location_id)
 union all
 select * from preshift_points_private.pending_sales(p_location_id)
 union all
 select d.user_id,d.business_date,'missed-preshift-minute:'||d.business_date::text,-5,
 'Required pre-shift not viewed for 60 seconds before closeout or scheduled shift end'::text
 from (
  select s.user_id,s.business_date,min(least(s.end_at,coalesce((
   select min(c.submitted_at) from public.daily_closeouts c
   where c.location_id=s.location_id and c.user_id=s.user_id and c.closeout_date=s.business_date
    and c.status='submitted' and c.deleted_at is null
  ),s.end_at))) deadline
  from public.staff_scheduled_shifts s
  where s.location_id=p_location_id and s.end_at>s.start_at
   and staff_ops_private.roster_ready(s.location_id,s.business_date)
  group by s.user_id,s.business_date
 ) d join public.preshift_minute_policy policy on policy.location_id=p_location_id
 where now()>=d.deadline and d.deadline>=policy.effective_at+interval '60 seconds'
 and exists(
  select 1 from public.preshift_posts p join public.preshift_minute_requirements r on r.post_id=p.id
  where p.location_id=p_location_id and p.shift_date=d.business_date and p.deleted_at is null and r.required
   and greatest(r.required_from,p.created_at)<=d.deadline-interval '60 seconds'
   and preshift_points_private.viewed_ms(p.id,d.user_id,d.deadline)<60000
 );
$$;
revoke all on all functions in schema preshift_points_private from public,anon,authenticated;
revoke all on function public.points_source_entries(uuid) from public,anon,authenticated;
revoke all on function public.preshift_minute_status(uuid,uuid),public.preshift_minute_set(uuid,uuid,boolean),public.preshift_record_view_time(uuid,uuid,integer,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.preshift_minute_status(uuid,uuid),public.preshift_minute_set(uuid,uuid,boolean),public.preshift_record_view_time(uuid,uuid,integer,uuid,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
