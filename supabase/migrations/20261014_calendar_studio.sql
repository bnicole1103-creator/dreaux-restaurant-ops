begin;
alter table public.calendar_events add column if not exists media jsonb not null default '[]';
alter table public.calendar_events add column if not exists style jsonb not null default '{"color":"#c47743","font":"modern"}';
create table if not exists public.calendar_month_styles (
 location_id uuid not null references public.locations(id) on delete cascade,
 month_date date not null check(extract(day from month_date)=1),
 config jsonb not null,version integer not null default 1,
 updated_by uuid references public.profiles(id),primary key(location_id,month_date)
);
alter table public.calendar_month_styles enable row level security;
revoke all on public.calendar_month_styles from public,anon,authenticated;
create or replace function public.calendar_style_valid(p_style jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_style)='object' and (select count(*) from jsonb_object_keys(p_style))=2
 and p_style->>'color' ~ '^#[0-9a-fA-F]{6}$'
 and p_style->>'font' in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern'),false)
$$;
create or replace function public.calendar_month_style_save(p_location_id uuid,p_month date,p_config jsonb,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_month is null or extract(day from p_month)<>1 or not public.calendar_style_valid(p_config) then raise exception 'Choose a valid month color and font.';end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-style:'||p_location_id::text||p_month::text,0));
 select version into current_version from public.calendar_month_styles where location_id=p_location_id and month_date=p_month;
 if coalesce(current_version,0) is distinct from p_version then raise exception 'Month style changed. Refresh before saving.';end if;
 insert into public.calendar_month_styles(location_id,month_date,config,updated_by) values(p_location_id,p_month,p_config,auth.uid())
 on conflict(location_id,month_date) do update set config=excluded.config,version=calendar_month_styles.version+1,updated_by=auth.uid();
end;$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('calendar-media','calendar-media',false,15728640,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.calendar_media_access(p_path text,p_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare loc uuid;attached boolean;
begin
 if auth.uid() is null or p_path is null then return false;end if;
 begin loc:=split_part(p_path,'/',1)::uuid;exception when invalid_text_representation then return false;end;
 if public.closeout_is_member(loc) is not true then return false;end if;
 select exists(select 1 from public.calendar_events e cross join lateral jsonb_array_elements(e.media) m where e.location_id=loc and m->>'path'=p_path) into attached;
 if p_action='read' then return exists(select 1 from public.calendar_events e cross join lateral jsonb_array_elements(e.media) m where e.location_id=loc and e.deleted_at is null and m->>'path'=p_path) or (public.mod_is_manager(loc) is true and split_part(p_path,'/',2)=auth.uid()::text);end if;
 if p_action in ('upload','delete') then return public.mod_is_manager(loc) is true and split_part(p_path,'/',2)=auth.uid()::text and not attached;end if;
 return false;
end;$$;
drop policy if exists "calendar flyer read" on storage.objects;
create policy "calendar flyer read" on storage.objects for select to authenticated using(bucket_id='calendar-media' and public.calendar_media_access(name,'read'));
drop policy if exists "calendar flyer upload" on storage.objects;
create policy "calendar flyer upload" on storage.objects for insert to authenticated with check(bucket_id='calendar-media' and public.calendar_media_access(name,'upload'));
drop policy if exists "calendar flyer delete" on storage.objects;
create policy "calendar flyer delete" on storage.objects for delete to authenticated using(bucket_id='calendar-media' and public.calendar_media_access(name,'delete'));
create or replace function public.calendar_event_save_rich(p_location_id uuid,p_id uuid,p_version integer,p_request uuid,p_date date,p_title text,p_body text,p_time time,p_category text,p_media jsonb,p_style jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;m jsonb;path text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if public.calendar_style_valid(p_style) is not true or jsonb_typeof(p_media) is distinct from 'array' then raise exception 'Choose a valid event style and flyers.';end if;
 if jsonb_array_length(p_media)>4 then raise exception 'Attach up to four flyers.';end if;
 for m in select value from jsonb_array_elements(p_media) loop
  path:=m->>'path';
  if jsonb_typeof(m) is distinct from 'object' or path is null or split_part(path,'/',1)<>p_location_id::text or length(coalesce(m->>'name','')) not between 1 and 255 or length(coalesce(m->>'caption',''))>500 then raise exception 'Invalid flyer.';end if;
  if split_part(path,'/',2)<>auth.uid()::text and not exists(select 1 from public.calendar_events e cross join lateral jsonb_array_elements(e.media) a where e.id=p_id and e.location_id=p_location_id and a->>'path'=path) then raise exception 'Flyer belongs to another upload.';end if;
  if not exists(select 1 from storage.objects where bucket_id='calendar-media' and name=path and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp','image/gif')) then raise exception 'Upload the flyer before saving.';end if;
 end loop;
 if (select count(distinct value->>'path') from jsonb_array_elements(p_media))<>jsonb_array_length(p_media) then raise exception 'Duplicate flyer.';end if;
 if p_id is null then
  if p_request is null then raise exception 'Request required.';end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-event:'||auth.uid()::text||p_request::text,0));
  select id into result from public.calendar_events where created_by=auth.uid() and request_id=p_request and location_id=p_location_id;
  if result is not null then return result;end if;
 end if;
 result:=public.calendar_event_save(p_location_id,p_id,p_version,p_request,p_date,p_title,p_body,p_time,p_category);
 update public.calendar_events set media=p_media,style=p_style where id=result and location_id=p_location_id;
 return result;
end;$$;
create or replace function public.calendar_day_posts(p_location_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501';end if;
 if p_date is null then raise exception 'Choose a date.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'title',p.title,'body',p.body,'shift_date',p.shift_date,'presentation',p.presentation,'media',p.media) order by p.pinned desc,p.created_at desc) from public.preshift_posts p where p.location_id=p_location_id and p.shift_date=p_date and p.deleted_at is null),'[]'::jsonb);
end;$$;
create or replace function public.calendar_read(p_location_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare events jsonb; days jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Location access required.' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to-p_from not between 0 and 41 then raise exception 'Choose up to 42 days.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.event_date,'title',e.title,'body',e.body,'time',e.start_time,'category',e.category,'version',e.version,'media',e.media,'style',e.style) order by e.event_date,e.start_time nulls first,e.title),'[]'::jsonb)
 into events from public.calendar_events e where e.location_id=p_location_id and e.event_date between p_from and p_to and e.deleted_at is null;
 select coalesce(jsonb_object_agg(d::date::text,jsonb_build_object(
  'rows',coalesce(c.rows,'[]'::jsonb),'synced_at',c.synced_at,'error',c.last_error,
  'posts',(select count(*) from public.preshift_posts p where p.location_id=p_location_id and p.shift_date=d::date and p.deleted_at is null),
  'reservations',(select count(*) from public.reservations r where r.location_id=p_location_id and r.reservation_date=d::date and lower(coalesce(r.status,'')) not in ('cancelled','canceled','no_show','no-show'))
 )),'{}'::jsonb) into days
 from pg_catalog.generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
 left join public.home_schedule_cache c on c.location_id=p_location_id and c.schedule_date=d::date;
 return jsonb_build_object('events',events,'days',days,'styles',coalesce((select jsonb_object_agg(to_char(month_date,'YYYY-MM'),jsonb_build_object('config',config,'version',version)) from public.calendar_month_styles where location_id=p_location_id and month_date between date_trunc('month',p_from)::date and date_trunc('month',p_to)::date),'{}'::jsonb));
end; $$;
-- Expand only the existing font allowlists; preserve every function's access checks.
do $$
declare r record;definition text;
begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','preshift_private') and p.prokind='f' loop
  definition:=pg_get_functiondef(r.oid);
  if strpos(definition,'(''system'',''serif'',''rounded'',''mono'')')>0 then
   execute replace(definition,'(''system'',''serif'',''rounded'',''mono'')','(''system'',''serif'',''rounded'',''mono'',''script'',''editorial'',''condensed'',''friendly'',''modern'')');
  end if;
 end loop;
end;$$;
revoke all on function public.calendar_style_valid(jsonb),public.calendar_month_style_save(uuid,date,jsonb,integer),public.calendar_event_save_rich(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb),public.calendar_day_posts(uuid,date),public.calendar_media_access(text,text) from public,anon,authenticated;
grant execute on function public.calendar_month_style_save(uuid,date,jsonb,integer),public.calendar_event_save_rich(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb),public.calendar_day_posts(uuid,date),public.calendar_media_access(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
