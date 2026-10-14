-- Run once in the restaurant project ipgkhvnedtkfqtfflgow, before installing the UI.
-- Keeps the working push-dispatch sender, device keys and cron unchanged.
begin;
create table if not exists public.push_post_notifications (
 location_id uuid not null references public.locations(id),category text not null check(category in ('preshift','quiz')),
 object_id uuid not null,object_version integer not null,service_date date not null,
 audience text not null check(audience in ('off','scheduled','all')),request_id uuid not null,
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),
 primary key(location_id,category,object_id)
);
create table if not exists public.push_post_notification_requests (
 request_id uuid primary key,location_id uuid not null,category text not null,object_id uuid not null,
 object_version integer not null,audience text not null,requested_by uuid not null,
 queued_devices integer not null,available_at timestamptz not null,created_at timestamptz not null default now()
);
alter table public.push_post_notifications enable row level security;
alter table public.push_post_notification_requests enable row level security;
revoke all on public.push_post_notifications,public.push_post_notification_requests from public,anon,authenticated;
-- Device consent replaces staff category choices. Existing devices stay subscribed.
update public.push_preferences_config set preferences='{"preshift":true,"quiz":true,"tasks":true,"reminders":true,"stock":true}'::jsonb;
create or replace function public.push_preferences(p_location_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not push_private.member(p_location_id,auth.uid()) then raise exception 'Location access required.' using errcode='42501';end if;
 return '{"preshift":true,"quiz":true,"tasks":true,"reminders":true,"stock":true}'::jsonb;
end;$$;
create or replace function public.push_save_preferences(p_location_id uuid,p_preferences jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.push_preferences(p_location_id);
 if p_preferences is distinct from public.push_preferences(p_location_id) then
 raise exception 'The GM chooses alerts. Staff can enable or disable their device only.' using errcode='42501';end if;
 insert into public.push_preferences_config(location_id,user_id,preferences) values(p_location_id,auth.uid(),p_preferences)
 on conflict(location_id,user_id) do update set preferences=excluded.preferences;
end;$$;
create or replace function push_private.require_gm(l uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not push_private.member(l,auth.uid()) or public.closeout_is_gm(l) is not true then
 raise exception 'General manager access required.' using errcode='42501';end if;
end;$$;
-- Automatic post/quiz triggers remain installed but cannot enqueue alerts.
-- Tasks, reminders and stock alerts retain their existing behavior.
create or replace function push_private.enqueue(l uuid,c text,k text,obj uuid,v integer,t text,b text,path text,u uuid default null,at_time timestamptz default now())
returns void language sql security definer set search_path='' as $$
 insert into public.push_queue(device_id,location_id,category,event_key,object_id,object_version,payload,available_at,expires_at)
 select d.id,l,c,k,obj,v,jsonb_build_object('title',t,'body',b,'url',path,'tag',k),at_time,at_time+interval '24 hours'
 from public.push_devices d join public.push_preferences_config p on p.user_id=d.user_id and p.location_id=l
 where c not in ('preshift','quiz') and (u is null or d.user_id=u) and push_private.member(l,d.user_id)
 and coalesce((p.preferences->>c)::boolean,false)
 on conflict(device_id,event_key) do nothing;$$;
create or replace function public.push_post_notification_settings(p_location_id uuid,p_category text,p_object_id uuid,p_version integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform push_private.require_gm(p_location_id);
 if p_category not in ('preshift','quiz') or p_category is null then raise exception 'Invalid post type.';end if;
 select jsonb_build_object('audience',audience,'updated_at',updated_at) into result
 from public.push_post_notifications where location_id=p_location_id and category=p_category and object_id=p_object_id and object_version=p_version;
 return coalesce(result,'{"audience":"off"}'::jsonb);
end;$$;
create or replace function public.push_post_notification_send(p_location_id uuid,p_category text,p_object_id uuid,p_version integer,p_audience text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day date;actual_version integer;at_time timestamptz;count_devices integer;key text;prior public.push_post_notification_requests%rowtype;
begin
 perform push_private.require_gm(p_location_id);
 if p_category is null or p_category not in ('preshift','quiz') or p_audience is null or p_audience not in ('off','scheduled','all') or p_request_id is null or p_version is null then raise exception 'Invalid notification request.';end if;
 -- Serialize retries across posts and changes to the same post.
 perform pg_advisory_xact_lock(hashtextextended('gm-request:'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('gm-post:'||p_location_id::text||p_category||p_object_id::text,0));
 if p_category='preshift' then
 select shift_date,version into day,actual_version from public.preshift_posts
 where id=p_object_id and location_id=p_location_id and deleted_at is null for share;
 else
 select quiz_date,version into day,actual_version from public.daily_quizzes
 where id=p_object_id and location_id=p_location_id and published for share;
 end if;
 if day is null or actual_version is distinct from p_version then raise exception 'This post changed or was unpublished. Refresh before choosing its alert.';end if;
 select * into prior from public.push_post_notification_requests where request_id=p_request_id;
 if found then
 if prior.location_id<>p_location_id or prior.category<>p_category or prior.object_id<>p_object_id or prior.object_version<>p_version or prior.audience<>p_audience or prior.requested_by<>auth.uid() then raise exception 'Request ID already used for another action.';end if;
 return jsonb_build_object('queued_devices',prior.queued_devices,'deferred',prior.available_at>now());
 end if;
 if p_audience='scheduled' and staff_ops_private.roster_ready(p_location_id,day) is not true then
 raise exception 'Confirm the schedule for this post''s service day (%) in Settings first.',day;end if;
 at_time:=greatest(now(),day::timestamp at time zone 'America/Chicago');
 key:='gm:'||p_category||':'||p_object_id::text||':'||p_version::text||':'||p_request_id::text;
 -- Cancel pending older choices; deliveries already received cannot be recalled.
 update public.push_queue set finished_at=now(),last_error='Superseded by GM notification choice'
 where location_id=p_location_id and category=p_category and object_id=p_object_id and finished_at is null;
 insert into public.push_post_notifications(location_id,category,object_id,object_version,service_date,audience,request_id,updated_by)
 values(p_location_id,p_category,p_object_id,p_version,day,p_audience,p_request_id,auth.uid())
 on conflict(location_id,category,object_id) do update set object_version=excluded.object_version,service_date=excluded.service_date,audience=excluded.audience,request_id=excluded.request_id,updated_by=excluded.updated_by,updated_at=now();
 count_devices:=0;
 if p_audience<>'off' then
 insert into public.push_queue(device_id,location_id,category,event_key,object_id,object_version,payload,available_at,expires_at)
 select d.id,p_location_id,p_category,key,p_object_id,p_version,
 jsonb_build_object('title',case when p_category='quiz' then 'JusTini’s quiz' else 'JusTini’s pre-shift' end,
 'body',case when p_category='quiz' then 'A quiz is available. Open the app to view it.' else 'A pre-shift update is available. Open the app to read it.' end,
 'url',case when p_category='quiz' then '/quizzes' else '/preshift' end,'tag',key),at_time,at_time+interval '24 hours'
 from public.push_devices d where push_private.member(p_location_id,d.user_id)
 and exists(select 1 from public.push_preferences_config p where p.location_id=p_location_id and p.user_id=d.user_id)
 and (p_audience='all' or exists(select 1 from public.staff_scheduled_shifts s where s.location_id=p_location_id and s.business_date=day and s.user_id=d.user_id))
 on conflict(device_id,event_key) do nothing;
 get diagnostics count_devices=row_count;
 end if;
 insert into public.push_post_notification_requests(request_id,location_id,category,object_id,object_version,audience,requested_by,queued_devices,available_at)
 values(p_request_id,p_location_id,p_category,p_object_id,p_version,p_audience,auth.uid(),count_devices,at_time);
 return jsonb_build_object('queued_devices',count_devices,'deferred',at_time>now());
end;$$;
-- Recheck source version, active membership, GM choice and roster at delivery.
create or replace function push_private.eligible(q public.push_queue,u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select push_private.member(q.location_id,u) and (q.category='test' or exists(select 1 from public.push_preferences_config p
 where p.location_id=q.location_id and p.user_id=u and coalesce((p.preferences->>q.category)::boolean,false))) and
 (q.category not in ('preshift','quiz') or exists(select 1 from public.push_post_notifications n
 where n.location_id=q.location_id and n.category=q.category and n.object_id=q.object_id and n.object_version=q.object_version
 and q.event_key='gm:'||n.category||':'||n.object_id::text||':'||n.object_version::text||':'||n.request_id::text
 and (n.audience='all' or (n.audience='scheduled' and staff_ops_private.roster_ready(n.location_id,n.service_date)
 and exists(select 1 from public.staff_scheduled_shifts s where s.location_id=n.location_id and s.business_date=n.service_date and s.user_id=u))))) and
 case q.category
 when 'preshift' then exists(select 1 from public.preshift_posts where id=q.object_id and location_id=q.location_id and deleted_at is null and version=q.object_version)
 when 'quiz' then exists(select 1 from public.daily_quizzes where id=q.object_id and location_id=q.location_id and published and version=q.object_version)
 when 'tasks' then exists(select 1 from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.id=q.object_id and r.cancelled_at is null and a.user_id=u and a.active)
 when 'reminders' then exists(select 1 from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.id=q.object_id and r.cancelled_at is null and a.user_id=u and a.active and r.business_date=(now() at time zone 'America/Chicago')::date and (select count(*) from public.staff_task_checks c where c.run_id=r.id and c.user_id=u)<jsonb_array_length(r.items))
 else true end;$$;
-- Cancel post/quiz alerts generated automatically before this update.
update public.push_queue set finished_at=now(),last_error='GM approval required'
where finished_at is null and category in ('preshift','quiz') and event_key not like 'gm:%';
-- Existing RPCs also enforce GM access, including calls from an older browser.
create or replace function public.push_test(p_location_id uuid,p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 perform push_private.require_gm(p_location_id);
 select id into d from public.push_devices where user_id=auth.uid() and endpoint=p_endpoint;
 if d is null then raise exception 'Enable this device first.';end if;
 if exists(select 1 from public.push_queue where device_id=d and category='test' and available_at>now()-interval '1 minute') then raise exception 'Wait a minute before sending another test.';end if;
 insert into public.push_queue(device_id,location_id,category,event_key,payload)
 values(d,p_location_id,'test','test:'||gen_random_uuid(),'{"title":"JusTini’s","body":"Push notifications are working on this device.","url":"/"}');
end;$$;
-- Disable the unused system's automatic post/quiz broadcasts, without altering required work.
create or replace function staff_ops_private.broadcast(p_location uuid,p_day date,p_kind text,p_key text,p_title text,p_body text,p_url text,p_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare policy public.staff_notification_policy;audience text;
begin
 if p_kind in ('preshift','quiz') then return;end if;
 select * into policy from public.staff_notification_policy where location_id=p_location and kind=p_kind;
 if found and not policy.enabled then return;end if;
 audience:=coalesce(policy.audience,case when p_kind='announcement' then 'all' else 'scheduled' end);
 if audience='scheduled' and not staff_ops_private.roster_ready(p_location,p_day) then return;end if;
 insert into public.staff_push_events(location_id,user_id,kind,scheduled_at,ops_source_key,ops_business_date,ops_title,ops_body,ops_url)
 select p_location,m.user_id,p_kind,p_at,p_key,p_day,p_title,p_body,p_url
 from public.location_memberships m where m.location_id=p_location and m.status='active' and public.closeout_is_member_for_tasks(m.location_id,m.user_id)
 and (audience='all' or exists(select 1 from public.staff_scheduled_shifts s where s.location_id=p_location and s.business_date=p_day and s.user_id=m.user_id))
 on conflict(location_id,user_id,ops_source_key) do nothing;
end;$$;
update public.staff_push_events set sent_at=now(),last_error='GM approval required' where sent_at is null and kind in ('preshift','quiz');
-- Restrict legacy management notification RPCs while keeping their existing implementations.
do $$
declare sig text;name text;args text;callargs text;oldname text;
begin
 for sig,name,args,callargs in values
 ('uuid,text,boolean,text','staff_notifications_save','p_location_id uuid,p_kind text,p_enabled boolean,p_audience text','p_location_id,p_kind,p_enabled,p_audience'),
 ('uuid,date,text,text,uuid','staff_notification_send','p_location_id uuid,p_day date,p_title text,p_body text,p_request_id uuid','p_location_id,p_day,p_title,p_body,p_request_id'),
 ('uuid','staff_push_test','p_location_id uuid','p_location_id') loop
 oldname:=name||'_gm_original';
 if to_regprocedure('push_private.'||oldname||'('||sig||')') is null then
 execute format('alter function public.%I(%s) set schema push_private',name,sig);
 execute format('alter function push_private.%I(%s) rename to %I',name,sig,oldname);
 end if;
 execute format('create or replace function public.%I(%s) returns void language plpgsql security definer set search_path='''' as $f$ begin perform push_private.require_gm(p_location_id);perform push_private.%I(%s);end;$f$',name,args,oldname,callargs);
 execute format('revoke all on function public.%I(%s) from public,anon,authenticated',name,sig);
 execute format('grant execute on function public.%I(%s) to authenticated',name,sig);
 end loop;
end;$$;
revoke all on all functions in schema push_private from public,anon,authenticated;
revoke all on function public.push_post_notification_settings(uuid,text,uuid,integer),public.push_post_notification_send(uuid,text,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.push_post_notification_settings(uuid,text,uuid,integer),public.push_post_notification_send(uuid,text,uuid,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
