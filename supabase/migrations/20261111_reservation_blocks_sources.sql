begin;
do $$begin
 if to_regprocedure('public.reservation_capacity_load(uuid,date)') is null or to_regprocedure('public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb)') is null then raise exception 'Install the reservation capacity planner first. No changes applied.';end if;
end$$;
create table if not exists capacity_private.blocks(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 scope text not null check(scope in ('day','table','section','room')),room_id uuid,section_id uuid,table_ids uuid[] not null default '{}',
 starts_at timestamptz not null,ends_at timestamptz not null,reason text not null,version integer not null default 1,
 created_by uuid not null,updated_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),removed_at timestamptz,
 check(ends_at>starts_at),check(length(reason) between 1 and 500)
);
alter table capacity_private.blocks enable row level security;
revoke all on capacity_private.blocks from public,anon,authenticated;
create index if not exists reservation_blocks_window on capacity_private.blocks(location_id,starts_at,ends_at) where removed_at is null;
create or replace function capacity_private.block_config(l uuid,d date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg jsonb;begin
 if to_regprocedure('capacity_private.effective_config(uuid,date)') is not null then execute 'select capacity_private.effective_config($1,$2)' into cfg using l,d;else select config into cfg from capacity_private.days where location_id=l and day=d;end if;
 return cfg;
end$$;
create or replace function capacity_private.block_rows(l uuid,a timestamptz,z timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('tableIds',case when b.scope='day' then (select coalesce(jsonb_agg(t.id),'[]') from public.floor_tables t where t.location_id=l) when b.scope='room' then (select coalesce(jsonb_agg(t.id),'[]') from public.floor_tables t where t.location_id=l and t.room_id=b.room_id) else to_jsonb(b.table_ids) end) order by b.starts_at,b.id),'[]') from capacity_private.blocks b where b.location_id=l and b.removed_at is null and b.starts_at<z and a<b.ends_at;
$$;
create or replace function public.reservation_sources(p_location_id uuid,p_keys text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;links jsonb:='{}';begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'floor','reservations') is not true then raise exception 'Reservation access required.' using errcode='42501';end if;
 if coalesce(cardinality(p_keys),0)>250 then raise exception 'Too many reservation keys.';end if;
 if to_regclass('inquiry_booking_private.links') is not null then execute 'select coalesce(jsonb_object_agg(reservation_id::text,source),''{}''::jsonb) from inquiry_booking_private.links where location_id=$1 and reservation_id::text=any($2)' into links using p_location_id,p_keys;end if;
 select coalesce(jsonb_object_agg(r.id::text,coalesce(links->>r.id::text,nullif(to_jsonb(r)->>'imported_source',''),nullif(to_jsonb(r)->>'source',''),'Not recorded')),'{}') into result from public.reservations r where r.location_id=p_location_id and r.id::text=any(p_keys);
 return result;
end$$;
do $$begin
 if to_regprocedure('capacity_private.load_before_blocks(uuid,date)') is null then alter function public.reservation_capacity_load(uuid,date) set schema capacity_private;alter function capacity_private.reservation_capacity_load(uuid,date) rename to load_before_blocks;end if;
 if to_regprocedure('capacity_private.apply_before_blocks(uuid,date,text,jsonb,jsonb)') is null then alter function public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb) set schema capacity_private;alter function capacity_private.reservation_capacity_apply(uuid,date,text,jsonb,jsonb) rename to apply_before_blocks;end if;
end$$;
create or replace function public.reservation_capacity_load(p_location_id uuid,p_day date) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d jsonb;b jsonb;sources jsonb;begin
 d:=capacity_private.load_before_blocks(p_location_id,p_day);
 b:=capacity_private.block_rows(p_location_id,to_timestamp((d->>'open')::numeric*60),to_timestamp((d->>'close')::numeric*60));
 sources:=public.reservation_sources(p_location_id,array(select x->>'id' from jsonb_array_elements(d->'bookings') x where not coalesce((x->>'live')::boolean,false)));
 d:=d||jsonb_build_object('blocks',b,'bookings',(select coalesce(jsonb_agg(x||jsonb_build_object('source',case when coalesce((x->>'live')::boolean,false) then coalesce((select h.source from public.floor_seating_history_v1 h where 'live:'||h.session_id::text=x->>'id'),'Seated party') else sources->>(x->>'id') end)),'[]') from jsonb_array_elements(d->'bookings') x),'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'tableIds',p.table_ids)),'[]') from public.floor_section_plans p where p.location_id=p_location_id and p.cancelled_at is null and p.starts_at<to_timestamp((d->>'close')::numeric*60) and to_timestamp((d->>'open')::numeric*60)<p.ends_at));
 return d||jsonb_build_object('fingerprint',md5((d-'now'-'slots'-'canManage')::text));
end$$;
create or replace function public.reservation_block_save(p_location_id uuid,p_id uuid,p_version integer,p_values jsonb,p_remove boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare prior capacity_private.blocks;rid uuid:=coalesce(p_id,gen_random_uuid());a timestamptz;z timestamptz;ids uuid[];scope_name text;room uuid;section uuid;b jsonb;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true or public.app_access_allowed(p_location_id,'floor','reservations') is not true then raise exception 'Management reservation access required.' using errcode='42501';end if;
 lock table public.reservations,public.table_sessions,public.table_session_tables,public.floor_tables,public.rooms,capacity_private.days,capacity_private.blocks in share row exclusive mode;
 if to_regclass('capacity_private.weekdays') is not null then execute 'lock table capacity_private.weekdays in share row exclusive mode';end if;
 select * into prior from capacity_private.blocks where id=rid and location_id=p_location_id and removed_at is null for update;
 if p_id is not null and (prior.id is null or prior.version is distinct from p_version) then raise exception 'Block changed. Refresh before editing.' using errcode='40001';end if;
 if p_remove then
 if prior.id is null then raise exception 'Block unavailable.';end if;
 update capacity_private.blocks set removed_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1 where id=rid;
 else
 a:=(p_values->>'starts_at')::timestamptz;z:=(p_values->>'ends_at')::timestamptz;scope_name:=p_values->>'scope';room:=nullif(p_values->>'room_id','')::uuid;section:=nullif(p_values->>'section_id','')::uuid;
 if a is null or z is null or z<=a or z>a+interval '366 days' or scope_name is null or scope_name not in ('day','table','section','room') or length(btrim(coalesce(p_values->>'reason',''))) not between 1 and 500 then raise exception 'Choose a scope, valid start/end dates and times, and a reason.';end if;
 if scope_name='room' then
 if not exists(select 1 from public.rooms where id=room and location_id=p_location_id) then raise exception 'Room unavailable.';end if;
 select array_agg(id) into ids from public.floor_tables where location_id=p_location_id and room_id=room;
 elsif scope_name='section' then select table_ids into ids from public.floor_section_plans where id=section and location_id=p_location_id and cancelled_at is null;if not found then raise exception 'Section unavailable.';end if;
 elsif scope_name='table' then select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_values->'table_ids');
 else select array_agg(id) into ids from public.floor_tables where location_id=p_location_id;end if;
 if scope_name<>'day' and coalesce(cardinality(ids),0)=0 then raise exception 'Choose at least one table.';end if;
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.floor_tables t where t.id=x and t.location_id=p_location_id)) then raise exception 'Table unavailable.';end if;
 if exists(select 1 from public.reservations r where r.location_id=p_location_id and lower(coalesce(r.status,'')) not in ('cancelled','canceled','removed','completed','departed','no_show') and to_jsonb(r)->>'deleted_at' is null and r.reservation_time is not null and ((r.reservation_date+r.reservation_time::time) at time zone 'America/Chicago')<z and a<((r.reservation_date+r.reservation_time::time) at time zone 'America/Chicago')+make_interval(mins=>coalesce((select minutes from capacity_private.lengths where reservation_id=r.id),(capacity_private.block_config(r.location_id,r.reservation_date)->>'duration')::integer,90)+coalesce((capacity_private.block_config(r.location_id,r.reservation_date)->>'buffer')::integer,15)) and (scope_name='day' or ids&&coalesce(r.table_ids,array[r.table_id]))) then raise exception 'An existing reservation overlaps this block. Move or cancel that booking first.';end if;
 if a<=now() and exists(select 1 from public.table_sessions s join public.shifts sh on sh.id=s.shift_id where sh.location_id=p_location_id and s.closed_at is null and (scope_name='day' or s.table_id=any(ids) or exists(select 1 from public.table_session_tables st where st.table_session_id=s.id and st.table_id=any(ids)))) then raise exception 'Guests are currently seated in this block. Clear those parties or choose a later start.';end if;
 insert into capacity_private.blocks(id,location_id,scope,room_id,section_id,table_ids,starts_at,ends_at,reason,created_by,updated_by) values(rid,p_location_id,scope_name,room,section,coalesce(ids,'{}'),a,z,btrim(p_values->>'reason'),auth.uid(),auth.uid()) on conflict(id) do update set scope=excluded.scope,room_id=excluded.room_id,section_id=excluded.section_id,table_ids=excluded.table_ids,starts_at=excluded.starts_at,ends_at=excluded.ends_at,reason=excluded.reason,version=blocks.version+1,updated_by=auth.uid(),updated_at=clock_timestamp();
 end if;
 insert into capacity_private.audit(location_id,day,actor,action,details) values(p_location_id,coalesce((a at time zone 'America/Chicago')::date,(prior.starts_at at time zone 'America/Chicago')::date),auth.uid(),case when p_remove then 'block_removed' when p_id is null then 'block_added' else 'block_edited' end,jsonb_build_object('before',to_jsonb(prior),'after',(select to_jsonb(x) from capacity_private.blocks x where id=rid)));
 return rid;
end$$;
create or replace function public.reservation_capacity_apply(p_location_id uuid,p_day date,p_fingerprint text,p_assignments jsonb,p_booking jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;e jsonb;b jsonb;start_min numeric;end_min numeric;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'floor','reservations') is not true then raise exception 'Reservation access required.' using errcode='42501';end if;
 lock table public.reservations,public.table_sessions,public.table_session_tables,public.floor_tables,public.rooms,capacity_private.days,capacity_private.blocks in share row exclusive mode;
 if to_regclass('capacity_private.weekdays') is not null then execute 'lock table capacity_private.weekdays in share row exclusive mode';end if;
 d:=public.reservation_capacity_load(p_location_id,p_day);
 for e in select value from jsonb_array_elements(d->'bookings') union all select jsonb_build_object('id','candidate','start',p_booking->'start','end',(p_booking->>'start')::numeric+(p_booking->>'duration')::numeric) where p_booking is not null loop
 start_min:=(e->>'start')::numeric;end_min:=(e->>'end')::numeric+(d->'config'->>'buffer')::integer;
 for b in select value from jsonb_array_elements(d->'blocks') loop
 if start_min<extract(epoch from (b->>'ends_at')::timestamptz)/60 and extract(epoch from (b->>'starts_at')::timestamptz)/60<end_min and (b->>'scope'='day' or exists(select 1 from jsonb_array_elements_text(p_assignments->(e->>'id')) t where b->'tableIds' ? t.value)) then raise exception 'Table plan overlaps a blocked period: %',b->>'reason';end if;
 end loop;end loop;
 if p_booking is not null then perform set_config('capacity.booking_request',coalesce(p_booking->>'request',''),true);perform set_config('capacity.booking_duration',coalesce(p_booking->>'duration',''),true);end if;
 return capacity_private.apply_before_blocks(p_location_id,p_day,p_fingerprint,p_assignments,p_booking);
end$$;
-- Enforce blocks for reservation edits/imports and seating outside the planner too.
create or replace function capacity_private.guard_blocked_use() returns trigger language plpgsql security definer set search_path='' as $$
declare l uuid;a timestamptz;z timestamptz;ids uuid[];b jsonb;duration integer;begin
 if tg_table_name='reservations' then
 if lower(coalesce(new.status,'')) in ('cancelled','canceled','removed','completed','departed','no_show') then return new;end if;
 l:=new.location_id;ids:=coalesce(new.table_ids,array[new.table_id]);
 if new.reservation_time is null then return new;end if;
 a:=(new.reservation_date+new.reservation_time::time) at time zone 'America/Chicago';
 select coalesce((select minutes from capacity_private.lengths where reservation_id=new.id),case when nullif(current_setting('capacity.booking_request',true),'')=to_jsonb(new)->>'external_reservation_id' then nullif(current_setting('capacity.booking_duration',true),'')::integer end,(capacity_private.block_config(l,new.reservation_date)->>'duration')::integer,90) into duration;
 z:=a+make_interval(mins=>duration+coalesce((capacity_private.block_config(l,new.reservation_date)->>'buffer')::integer,15));
 elsif tg_table_name='table_sessions' then
 if new.closed_at is not null then return new;end if;
 select location_id into l from public.shifts where id=new.shift_id;a:=greatest(now(),new.seated_at);z:=a+make_interval(mins=>coalesce((capacity_private.block_config(l,(a at time zone 'America/Chicago')::date)->>'duration')::integer,90)+coalesce((capacity_private.block_config(l,(a at time zone 'America/Chicago')::date)->>'buffer')::integer,15));ids:=array[new.table_id];
 else
 select sh.location_id into l from public.table_sessions s join public.shifts sh on sh.id=s.shift_id where s.id=new.table_session_id and s.closed_at is null;
 if l is null then return new;end if;a:=now();z:=a+make_interval(mins=>coalesce((capacity_private.block_config(l,(a at time zone 'America/Chicago')::date)->>'duration')::integer,90)+coalesce((capacity_private.block_config(l,(a at time zone 'America/Chicago')::date)->>'buffer')::integer,15));ids:=array[new.table_id];end if;
 perform 1 from capacity_private.blocks where location_id=l for share;
 for b in select value from jsonb_array_elements(capacity_private.block_rows(l,a,z)) loop
 if b->>'scope'='day' or exists(select 1 from unnest(ids) t where b->'tableIds' ? t::text) then raise exception 'This time or table is blocked: %',b->>'reason';end if;
 end loop;return new;
end$$;
drop trigger if exists reservation_block_guard on public.reservations;
create trigger reservation_block_guard before insert or update of reservation_date,reservation_time,table_ids,table_id,status on public.reservations for each row execute function capacity_private.guard_blocked_use();
drop trigger if exists reservation_block_guard on public.table_sessions;
create trigger reservation_block_guard before insert or update of table_id,closed_at on public.table_sessions for each row execute function capacity_private.guard_blocked_use();
drop trigger if exists reservation_block_guard on public.table_session_tables;
create trigger reservation_block_guard before insert or update on public.table_session_tables for each row execute function capacity_private.guard_blocked_use();
create or replace function public.reservation_guest_remove(p_location_id uuid,p_key text,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;rid uuid;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.app_access_allowed(p_location_id,'floor','reservations') is not true then raise exception 'Reservation access required.' using errcode='42501';end if;
 if p_key like 'live:%' then
 if public.walkin_can_manage(p_location_id) is not true then raise exception 'Seating access required.' using errcode='42501';end if;
 sid:=substring(p_key from 6)::uuid;
 perform 1 from public.table_sessions s join public.shifts sh on sh.id=s.shift_id where s.id=sid and sh.location_id=p_location_id and s.closed_at is null for update of s;
 if not found then raise exception 'Party changed or already cleared. Refresh.';end if;
 select reservation_id into rid from public.floor_seating_history_v1 where session_id=sid;
 if rid is null then select nullif(to_jsonb(s)->>'reservation_id','')::uuid into rid from public.table_sessions s where s.id=sid;end if;
 update public.table_sessions set status='ready',closed_at=clock_timestamp() where id=sid;
 if rid is not null then update public.reservations set status='completed' where id=rid and location_id=p_location_id;end if;
 else
 if exists(select 1 from public.floor_seating_history_v1 h join public.table_sessions s on s.id=h.session_id where h.reservation_id::text=p_key and h.location_id=p_location_id and s.closed_at is null) then raise exception 'This party is seated. Clear its seated party instead.';end if;
 update public.reservations set status='cancelled' where id::text=p_key and location_id=p_location_id and edit_version=p_version and lower(coalesce(status,'')) not in ('seated','completed');
 if not found then raise exception 'Reservation changed or is seated. Refresh and clear its seated party instead.' using errcode='40001';end if;
 end if;
 insert into capacity_private.audit(location_id,day,actor,action,details) values(p_location_id,(now() at time zone 'America/Chicago')::date,auth.uid(),'guest_removed',jsonb_build_object('key',p_key,'session_id',sid,'reservation_id',rid));
end$$;
revoke all on all functions in schema capacity_private from public,anon,authenticated;
revoke all on function public.reservation_capacity_load(uuid,date),public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb),public.reservation_block_save(uuid,uuid,integer,jsonb,boolean),public.reservation_sources(uuid,text[]),public.reservation_guest_remove(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.reservation_capacity_load(uuid,date),public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb),public.reservation_block_save(uuid,uuid,integer,jsonb,boolean),public.reservation_sources(uuid,text[]),public.reservation_guest_remove(uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
