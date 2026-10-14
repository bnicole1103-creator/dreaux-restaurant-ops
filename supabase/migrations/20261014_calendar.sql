begin;
create table if not exists public.calendar_events (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 event_date date not null,
 title text not null check(length(title) between 1 and 160),
 body text not null default '' check(length(body)<=4000),
 start_time time,
 category text not null default 'event' check(category in ('event','special','meeting','training','other')),
 version integer not null default 1,
 created_by uuid not null references public.profiles(id),
 request_id uuid not null,
 deleted_at timestamptz,
 unique(created_by,request_id)
);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public,anon,authenticated;
create table if not exists public.calendar_schedule_sync (
 location_id uuid not null references public.locations(id) on delete cascade,
 from_date date not null,to_date date not null,
 next_refresh_at timestamptz not null default '-infinity',
 lease_until timestamptz not null default '-infinity',
 primary key(location_id,from_date,to_date)
);
alter table public.calendar_schedule_sync enable row level security;
revoke all on public.calendar_schedule_sync from public,anon,authenticated;
grant all on public.calendar_schedule_sync to service_role;
create or replace function public.calendar_schedule_claim(p_location_id uuid,p_from date,p_to date)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed boolean;
begin
 if p_from is null or p_to is null or p_to-p_from not between 0 and 30 then raise exception 'Choose up to 31 days.'; end if;
 insert into public.calendar_schedule_sync(location_id,from_date,to_date,lease_until)
 values(p_location_id,p_from,p_to,clock_timestamp()+interval '90 seconds')
 on conflict(location_id,from_date,to_date) do update set lease_until=clock_timestamp()+interval '90 seconds'
 where public.calendar_schedule_sync.next_refresh_at<=clock_timestamp() and public.calendar_schedule_sync.lease_until<=clock_timestamp()
 returning true into claimed;
 return coalesce(claimed,false);
end; $$;
create or replace function public.calendar_read(p_location_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare events jsonb; days jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to-p_from not between 0 and 41 then raise exception 'Choose up to 42 days.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.event_date,'title',e.title,'body',e.body,'time',e.start_time,'category',e.category,'version',e.version) order by e.event_date,e.start_time nulls first,e.title),'[]'::jsonb)
 into events from public.calendar_events e where e.location_id=p_location_id and e.event_date between p_from and p_to and e.deleted_at is null;
 select coalesce(jsonb_object_agg(d::date::text,jsonb_build_object(
  'rows',coalesce(c.rows,'[]'::jsonb),'synced_at',c.synced_at,'error',c.last_error,
  'reservations',(select count(*) from public.reservations r where r.location_id=p_location_id and r.reservation_date=d::date and lower(coalesce(r.status,'')) not in ('cancelled','canceled','no_show','no-show'))
 )),'{}'::jsonb) into days
 from pg_catalog.generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
 left join public.home_schedule_cache c on c.location_id=p_location_id and c.schedule_date=d::date;
 return jsonb_build_object('events',events,'days',days);
end; $$;
create or replace function public.calendar_event_save(p_location_id uuid,p_id uuid,p_version integer,p_request uuid,p_date date,p_title text,p_body text,p_time time,p_category text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_date is null or p_title is null or length(trim(p_title)) not between 1 and 160 or length(coalesce(p_body,''))>4000 or p_category is null or p_category not in ('event','special','meeting','training','other') then raise exception 'Check the event date, title and details.';end if;
 if p_id is null then
  if p_request is null then raise exception 'Event request ID required.';end if;
  insert into public.calendar_events(location_id,event_date,title,body,start_time,category,created_by,request_id)
  values(p_location_id,p_date,trim(p_title),coalesce(p_body,''),p_time,p_category,auth.uid(),p_request)
  on conflict(created_by,request_id) do nothing;
  select id into result from public.calendar_events where created_by=auth.uid() and request_id=p_request and location_id=p_location_id;
  if result is null then raise exception 'Request belongs to another location.';end if;
 else
  update public.calendar_events set event_date=p_date,title=trim(p_title),body=coalesce(p_body,''),start_time=p_time,category=p_category,version=version+1
  where id=p_id and location_id=p_location_id and version=p_version and deleted_at is null returning id into result;
  if result is null then raise exception 'Event changed. Refresh before editing.';end if;
 end if;
 return result;
end; $$;
create or replace function public.calendar_event_remove(p_location_id uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 update public.calendar_events set deleted_at=clock_timestamp(),version=version+1 where id=p_id and location_id=p_location_id and version=p_version and deleted_at is null;
 if not found then raise exception 'Event changed. Refresh before removing.';end if;
end; $$;
create or replace function public.calendar_reservations(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a date.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.guest_name,'time',r.reservation_time,'party',r.party_size,'table',r.table_name,'occasion',r.occasion,'birthday',r.is_birthday,'vip',r.is_vip,'notes',r.notes,'status',r.status) order by r.reservation_time nulls last,r.guest_name,r.id) from public.reservations r where r.location_id=p_location_id and r.reservation_date=p_date),'[]'::jsonb);
end; $$;
revoke all on function public.calendar_schedule_claim(uuid,date,date) from public,anon,authenticated;
grant execute on function public.calendar_schedule_claim(uuid,date,date) to service_role;
revoke all on function public.calendar_read(uuid,date,date),public.calendar_event_save(uuid,uuid,integer,uuid,date,text,text,time,text),public.calendar_event_remove(uuid,uuid,integer),public.calendar_reservations(uuid,date) from public,anon,authenticated;
grant execute on function public.calendar_read(uuid,date,date),public.calendar_event_save(uuid,uuid,integer,uuid,date,text,text,time,text),public.calendar_event_remove(uuid,uuid,integer),public.calendar_reservations(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
