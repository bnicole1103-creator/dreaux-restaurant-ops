begin;
create table if not exists public.operations_inquiry_sync (
 location_id uuid primary key references public.locations(id),received text not null default to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 source_id text not null default '',last_success timestamptz,last_error text
);
alter table public.operations_inquiry_sync enable row level security;
revoke all on public.operations_inquiry_sync from public,anon,authenticated;
grant select,insert,update on public.operations_inquiry_sync to service_role;
insert into public.operations_inquiry_sync(location_id) select id from public.locations where is_active and lower(regexp_replace(name,'[^a-zA-Z0-9]','','g')) like 'justini%' on conflict do nothing;
create or replace function public.operations_inquiry_advance(p_location_id uuid,p_received text,p_id text) returns void language sql security definer set search_path='' as $$
 update public.operations_inquiry_sync set received=p_received,source_id=p_id,last_success=now(),last_error=null where location_id=p_location_id and (received,source_id)<(p_received,p_id);
$$;
revoke all on function public.operations_inquiry_advance(uuid,text,text) from public,anon,authenticated;
grant execute on function public.operations_inquiry_advance(uuid,text,text) to service_role;
-- The existing one-minute scheduler and its private dispatch token are reused.
create or replace function push_private.operations_tick() returns void language plpgsql security definer set search_path='' as $$
declare token text;base text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='justinis_push_dispatch';
 if token is null then return;end if;
 base:='https://ipgkhvnedtkfqtfflgow.supabase.co/functions/v1/operations-dispatch';
 perform net.http_post(url:=base,headers:=jsonb_build_object('Content-Type','application/json','x-push-dispatch-token',token),body:='{}'::jsonb,timeout_milliseconds:=55000);
end;$$;
do $$ declare j bigint;begin
 for j in select jobid from cron.job where jobname='justinis-operations-controls' loop perform cron.unschedule(j);end loop;
 perform cron.schedule('justinis-operations-controls','* * * * *','select push_private.operations_tick()');
end $$;
-- Automatic post/quiz alerts are enabled only by an explicit saved audience rule.
create or replace function push_private.operations_post_enqueue(l uuid,c text,obj uuid,v integer,d date,path text) returns void language plpgsql security definer set search_path='' as $$
declare at_time timestamptz;person record;key text;
begin
 if not exists(select 1 from public.operations_controls cfg cross join lateral jsonb_array_elements(cfg.rules) x where cfg.location_id=l and x->>'event'=c and (x->>'enabled')::boolean) then return;end if;
 at_time:=greatest(now(),(d+time '04:00') at time zone 'America/Chicago');key:='auto:'||c||':'||obj||':'||v;
 for person in select m.user_id,m.role from public.location_memberships m where m.location_id=l and m.status='active' loop
 if staff_ops_private.control_match(l,person.user_id,c,d,person.role,exists(select 1 from public.staff_scheduled_shifts where location_id=l and business_date=d and user_id=person.user_id and shift_key not like 'offday:%'),false) then
 insert into public.push_queue(device_id,location_id,category,event_key,object_id,object_version,payload,available_at,expires_at)
 select device.id,l,c,key,obj,v,jsonb_build_object('title',case when c='quiz' then 'JusTini’s quiz' else 'JusTini’s pre-shift' end,'body','A new update is available. Open the app to view it.','url',path,'tag',key,'business_date',d),at_time,at_time+interval '24 hours'
 from public.push_devices device where device.user_id=person.user_id and push_private.member(l,device.user_id) and exists(select 1 from public.push_preferences_config p where p.location_id=l and p.user_id=device.user_id) on conflict(device_id,event_key) do nothing;
 end if;end loop;return;
end;$$;
create or replace function push_private.operations_post() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='daily_quizzes' then if new.published then perform push_private.operations_post_enqueue(new.location_id,'quiz',new.id,new.version,new.quiz_date,'/quizzes');end if;
 elsif new.deleted_at is null then perform push_private.operations_post_enqueue(new.location_id,'preshift',new.id,new.version,new.shift_date,'/preshift');end if;
 return new;
end;$$;
create or replace function public.operations_notifications_tick() returns void language plpgsql security definer set search_path='' as $$
declare r record;d date:=((now() at time zone 'America/Chicago')-interval '4 hours')::date;
begin
 for r in select * from public.daily_quizzes where published and quiz_date between d and d+1 loop perform push_private.operations_post_enqueue(r.location_id,'quiz',r.id,r.version,r.quiz_date,'/quizzes');end loop;
 for r in select * from public.preshift_posts where deleted_at is null and shift_date between d and d+1 loop perform push_private.operations_post_enqueue(r.location_id,'preshift',r.id,r.version,r.shift_date,'/preshift');end loop;
end;$$;
revoke all on function public.operations_notifications_tick() from public,anon,authenticated;
grant execute on function public.operations_notifications_tick() to service_role;
drop trigger if exists operations_post_alert on public.preshift_posts;
create trigger operations_post_alert after insert or update on public.preshift_posts for each row execute function push_private.operations_post();
drop trigger if exists operations_quiz_alert on public.daily_quizzes;
create trigger operations_quiz_alert after insert or update on public.daily_quizzes for each row execute function push_private.operations_post();
create or replace function push_private.eligible(q public.push_queue,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when q.category='inquiries' then push_private.member(q.location_id,u)
 and exists(select 1 from public.operations_alerts a where a.location_id=q.location_id and a.user_id=u and 'inquiry:'||a.source||':'||a.source_id=q.event_key)
 when q.event_key like 'auto:%' and q.category in ('preshift','quiz') then push_private.member(q.location_id,u)
 and exists(select 1 from public.push_preferences_config p where p.location_id=q.location_id and p.user_id=u)
 and not exists(select 1 from public.push_post_notifications n where n.location_id=q.location_id and n.category=q.category and n.object_id=q.object_id and n.object_version=q.object_version)
 and case q.category when 'quiz' then exists(select 1 from public.daily_quizzes x where x.id=q.object_id and x.location_id=q.location_id and x.published and x.version=q.object_version) else exists(select 1 from public.preshift_posts x where x.id=q.object_id and x.location_id=q.location_id and x.deleted_at is null and x.version=q.object_version) end
 else push_private.eligible_before_controls(q,u) end
 and staff_ops_private.control_match(q.location_id,u,q.category,coalesce((q.payload->>'business_date')::date,((q.available_at at time zone 'America/Chicago')-interval '4 hours')::date),
 (select role from public.location_memberships where location_id=q.location_id and user_id=u and status='active'),
 exists(select 1 from public.staff_scheduled_shifts where location_id=q.location_id and business_date=coalesce((q.payload->>'business_date')::date,((q.available_at at time zone 'America/Chicago')-interval '4 hours')::date) and user_id=u and shift_key not like 'offday:%'),q.event_key not like 'auto:%');
$$;
revoke all on all functions in schema push_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
