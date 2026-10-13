begin;
create schema if not exists push_private;
revoke all on schema push_private from public,anon,authenticated;
create table if not exists public.push_devices(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 endpoint text not null unique,subscription jsonb not null,updated_at timestamptz not null default now()
);
create table if not exists public.push_preferences_config(
 location_id uuid not null references public.locations(id),user_id uuid not null references public.profiles(id),
 preferences jsonb not null default '{"preshift":true,"quiz":true,"tasks":true,"reminders":true,"stock":true}',
 primary key(location_id,user_id)
);
create table if not exists public.push_queue(
 id uuid primary key default gen_random_uuid(),device_id uuid not null references public.push_devices(id) on delete cascade,
 location_id uuid not null references public.locations(id),category text not null,event_key text not null,
 object_id uuid,object_version integer,payload jsonb not null,available_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',attempts integer not null default 0,
 lease_until timestamptz,lease_token uuid,finished_at timestamptz,last_error text,
 unique(device_id,event_key)
);
create index if not exists push_queue_due on public.push_queue(available_at) where finished_at is null;
alter table public.push_devices enable row level security;
alter table public.push_preferences_config enable row level security;
alter table public.push_queue enable row level security;
revoke all on public.push_devices,public.push_preferences_config,public.push_queue from public,anon,authenticated;
create or replace function push_private.member(l uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.location_memberships m join public.locations loc on loc.id=m.location_id
 join public.organization_memberships o on o.organization_id=loc.organization_id and o.user_id=m.user_id
 where m.location_id=l and m.user_id=u and m.status='active' and o.status='active');$$;
create or replace function public.push_preferences(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not push_private.member(p_location_id,auth.uid()) then raise exception 'Location access required.' using errcode='42501';end if;
 return coalesce((select preferences from public.push_preferences_config where location_id=p_location_id and user_id=auth.uid()),'{"preshift":true,"quiz":true,"tasks":true,"reminders":true,"stock":true}'::jsonb);
end;$$;
create or replace function public.push_save_preferences(p_location_id uuid,p_preferences jsonb) returns void language plpgsql security definer set search_path='' as $$
declare k text;
begin
 perform public.push_preferences(p_location_id);
 if jsonb_typeof(p_preferences) is distinct from 'object' then raise exception 'Invalid preferences.';end if;
 if (select count(*) from jsonb_object_keys(p_preferences))<>5 then raise exception 'Invalid preferences.';end if;
 foreach k in array array['preshift','quiz','tasks','reminders','stock'] loop
 if jsonb_typeof(p_preferences->k) is distinct from 'boolean' then raise exception 'Invalid preferences.';end if;end loop;
 insert into public.push_preferences_config(location_id,user_id,preferences) values(p_location_id,auth.uid(),p_preferences)
 on conflict(location_id,user_id) do update set preferences=excluded.preferences;
end;$$;
create or replace function public.push_register_device(p_location_id uuid,p_subscription jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;e text:=p_subscription->>'endpoint';
begin
 perform public.push_preferences(p_location_id);
 if coalesce(length(e),0)>2048 or e !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/[^[:space:]]+$'
 or coalesce(p_subscription#>>'{keys,p256dh}','') !~ '^[A-Za-z0-9_-]{87}=?$'
 or coalesce(p_subscription#>>'{keys,auth}','') !~ '^[A-Za-z0-9_-]{22}={0,2}$'
 then raise exception 'Unsupported or invalid push subscription.';end if;
 if (select count(*) from public.push_devices where user_id=auth.uid())>=10
 and not exists(select 1 from public.push_devices where endpoint=e and user_id=auth.uid()) then raise exception 'Device limit reached. Disable an old device first.';end if;
 insert into public.push_devices(user_id,endpoint,subscription) values(auth.uid(),e,jsonb_build_object('endpoint',e,'keys',p_subscription->'keys'))
 on conflict(endpoint) do update set subscription=excluded.subscription,updated_at=now()
 where public.push_devices.user_id=auth.uid() returning id into result;
 if result is null then raise exception 'This device belongs to another account. Turn off notifications and enable them again.';end if;
 insert into public.push_preferences_config(location_id,user_id) values(p_location_id,auth.uid()) on conflict do nothing;
 return result;
end;$$;
create or replace function public.push_remove_device(p_endpoint text) returns void language sql security definer set search_path='' as $$
 delete from public.push_devices where endpoint=p_endpoint and user_id=auth.uid();$$;
create or replace function push_private.enqueue(l uuid,c text,k text,obj uuid,v integer,t text,b text,path text,u uuid default null,at_time timestamptz default now())
returns void language sql security definer set search_path='' as $$
 insert into public.push_queue(device_id,location_id,category,event_key,object_id,object_version,payload,available_at,expires_at)
 select d.id,l,c,k,obj,v,jsonb_build_object('title',t,'body',b,'url',path,'tag',k),at_time,at_time+interval '24 hours'
 from public.push_devices d join public.push_preferences_config p on p.user_id=d.user_id and p.location_id=l
 where (u is null or d.user_id=u) and push_private.member(l,d.user_id) and coalesce((p.preferences->>c)::boolean,false)
 on conflict(device_id,event_key) do nothing;$$;
create or replace function public.push_test(p_location_id uuid,p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 perform public.push_preferences(p_location_id);
 select id into d from public.push_devices where user_id=auth.uid() and endpoint=p_endpoint;
 if d is null then raise exception 'Enable this device first.';end if;
 if exists(select 1 from public.push_queue where device_id=d and category='test' and available_at>now()-interval '1 minute') then raise exception 'Wait a minute before sending another test.';end if;
 insert into public.push_queue(device_id,location_id,category,event_key,payload)
 values(d,p_location_id,'test','test:'||gen_random_uuid(),'{"title":"JusTini’s","body":"Push notifications are working on this device.","url":"/"}');
end;$$;
create or replace function push_private.changed() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.staff_task_runs%rowtype;
begin
 if tg_table_name='preshift_posts' then
 if new.deleted_at is null and (tg_op='INSERT' or new.version is distinct from old.version) then
 perform push_private.enqueue(new.location_id,'preshift','post:'||new.id||':'||new.version,new.id,new.version,'JusTini’s pre-shift','A pre-shift has been published or updated. Open the app to read it.','/preshift');end if;
 elsif tg_table_name='daily_quizzes' then
 if new.published and new.quiz_date>=(now() at time zone 'America/Chicago')::date
 and (tg_op='INSERT' or not old.published or new.version is distinct from old.version) then
 perform push_private.enqueue(new.location_id,'quiz','quiz:'||new.id||':'||new.version,new.id,new.version,'JusTini’s quiz','A pre-shift quiz is available. Open the app to take it.','/quizzes',null,greatest(now(),new.quiz_date::timestamp at time zone 'America/Chicago'));end if;
 elsif tg_table_name='staff_task_assignees' then
 if new.active and (tg_op='INSERT' or not old.active) then
 select * into r from public.staff_task_runs where id=new.run_id and cancelled_at is null;
 if found then perform push_private.enqueue(r.location_id,'tasks','task:'||r.id||':'||new.user_id||':'||new.version,r.id,null,'JusTini’s tasks','A task list has been assigned to you. Open the app to review it.','/tasks',new.user_id);end if;end if;
 elsif tg_table_name='stock_board_events' then
 if new.action in ('86','restocked') then
 perform push_private.enqueue(new.location_id,'stock','stock:'||new.id,new.item_id,null,'JusTini’s 86 board',case when new.action='86' then 'An item is now unavailable. Check the 86 board.' else 'An item has been restocked. Check the 86 board.' end,'/');end if;
 end if;
 return new;
end;$$;
drop trigger if exists push_post on public.preshift_posts;
create trigger push_post after insert or update on public.preshift_posts for each row execute function push_private.changed();
drop trigger if exists push_quiz on public.daily_quizzes;
create trigger push_quiz after insert or update on public.daily_quizzes for each row execute function push_private.changed();
drop trigger if exists push_task on public.staff_task_assignees;
create trigger push_task after insert or update on public.staff_task_assignees for each row execute function push_private.changed();
drop trigger if exists push_stock on public.stock_board_events;
create trigger push_stock after insert on public.stock_board_events for each row execute function push_private.changed();
create or replace function push_private.eligible(q public.push_queue,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select push_private.member(q.location_id,u) and (q.category='test' or exists(select 1 from public.push_preferences_config p
 where p.location_id=q.location_id and p.user_id=u and coalesce((p.preferences->>q.category)::boolean,false))) and
 case q.category
 when 'preshift' then exists(select 1 from public.preshift_posts where id=q.object_id and deleted_at is null and version=q.object_version)
 when 'quiz' then exists(select 1 from public.daily_quizzes where id=q.object_id and published and version=q.object_version)
 when 'tasks' then exists(select 1 from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.id=q.object_id and r.cancelled_at is null and a.user_id=u and a.active)
 when 'reminders' then exists(select 1 from public.staff_task_runs r join public.staff_task_assignees a on a.run_id=r.id where r.id=q.object_id and r.cancelled_at is null and a.user_id=u and a.active and r.business_date=(now() at time zone 'America/Chicago')::date and (select count(*) from public.staff_task_checks c where c.run_id=r.id and c.user_id=u)<jsonb_array_length(r.items))
 else true end;$$;
create or replace function public.push_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;r record;
begin
 -- One reminder per device/list on its assigned day, only after 10 AM Central.
 if (now() at time zone 'America/Chicago')::time>='10:00'::time then
 for r in select t.*,a.user_id from public.staff_task_runs t join public.staff_task_assignees a on a.run_id=t.id and a.active where t.business_date=(now() at time zone 'America/Chicago')::date and t.cancelled_at is null loop
 perform push_private.enqueue(r.location_id,'reminders','reminder:'||r.id||':'||r.business_date,r.id,null,'JusTini’s task reminder','Check your unfinished task lists for today.','/tasks',r.user_id);end loop;end if;
 delete from public.push_queue where expires_at<now()-interval '7 days';
 update public.push_queue q set finished_at=now(),last_error='Skipped: expired or no longer eligible'
 from public.push_devices d where q.device_id=d.id and q.finished_at is null and (q.expires_at<now() or q.attempts>=5 or not push_private.eligible(q,d.user_id));
 with due as (select id from public.push_queue where finished_at is null and available_at<=now()
 and (lease_until is null or lease_until<now()) order by available_at limit 25 for update skip locked),
 claimed as (update public.push_queue q set lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=attempts+1 from due where q.id=due.id returning q.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'token',q.lease_token,'subscription',d.subscription,'payload',q.payload)),'[]') into result
 from claimed q join public.push_devices d on d.id=q.device_id;
 return result;
end;$$;
create or replace function public.push_finish(p_id uuid,p_token uuid,p_status integer) returns void language plpgsql security definer set search_path='' as $$
declare q public.push_queue%rowtype;
begin
 select * into q from public.push_queue where id=p_id and lease_token=p_token and finished_at is null for update;
 if not found then return;end if;
 if p_status in (404,410) then delete from public.push_devices where id=q.device_id;return;end if;
 update public.push_queue set lease_until=null,lease_token=null,
 finished_at=case when p_status between 200 and 299 or attempts>=5 then now() else null end,
 available_at=case when p_status between 200 and 299 then available_at else now()+make_interval(secs=>least(3600,60*(2^attempts)::integer)) end,
 last_error=case when p_status between 200 and 299 then null else 'Push provider status '||p_status end
 where id=p_id;
end;$$;
revoke all on all functions in schema push_private from public,anon,authenticated;
revoke all on function public.push_preferences(uuid),public.push_save_preferences(uuid,jsonb),public.push_register_device(uuid,jsonb),public.push_remove_device(text),public.push_test(uuid,text),public.push_claim(),public.push_finish(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.push_preferences(uuid),public.push_save_preferences(uuid,jsonb),public.push_register_device(uuid,jsonb),public.push_remove_device(text),public.push_test(uuid,text) to authenticated;
grant execute on function public.push_claim(),public.push_finish(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
