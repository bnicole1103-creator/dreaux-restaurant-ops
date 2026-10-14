begin;

create or replace function public.calendar_audience_valid(p_audience jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_audience) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p_audience))<>3 or not(p_audience?'mode' and p_audience?'roles' and p_audience?'users') then return false;end if;
 if coalesce(p_audience->>'mode','') not in ('all','selected') or jsonb_typeof(p_audience->'roles') is distinct from 'array' or jsonb_typeof(p_audience->'users') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_audience->'roles')>10 or jsonb_array_length(p_audience->'users')>100 then return false;end if;
 if exists(select 1 from jsonb_array_elements(p_audience->'roles') r where jsonb_typeof(r)<>'string' or (r#>>'{}') not in ('owner','general_manager','manager','assistant_manager','host','server','bartender','busser','kitchen','employee')) then return false;end if;
 if exists(select 1 from jsonb_array_elements(p_audience->'users') u where jsonb_typeof(u)<>'string' or (u#>>'{}')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then return false;end if;
 if (select count(distinct r) from jsonb_array_elements(p_audience->'roles') r)<>jsonb_array_length(p_audience->'roles') or (select count(distinct lower(u#>>'{}')) from jsonb_array_elements(p_audience->'users') u)<>jsonb_array_length(p_audience->'users') then return false;end if;
 return case when p_audience->>'mode'='all' then jsonb_array_length(p_audience->'roles')+jsonb_array_length(p_audience->'users')=0 else jsonb_array_length(p_audience->'roles')+jsonb_array_length(p_audience->'users')>0 end;
end;$$;

alter table public.calendar_events add column if not exists audience jsonb not null default '{"mode":"all","roles":[],"users":[]}';
alter table public.calendar_events add column if not exists audience_request jsonb;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.calendar_events'::regclass and conname='calendar_events_audience_valid') then
  alter table public.calendar_events add constraint calendar_events_audience_valid check(public.calendar_audience_valid(audience));
 end if;
end;$$;

create or replace function public.calendar_audience_visible(p_location_id uuid,p_audience jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare member_role text;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then return false;end if;
 if public.mod_is_manager(p_location_id) is true then return true;end if;
 select role::text into member_role from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active';
 if member_role is null then return false;end if;
 return coalesce(p_audience->>'mode'='all' or (p_audience->'roles')?member_role or (p_audience->'users')?auth.uid()::text,false);
end;$$;

create or replace function public.calendar_audience_roster(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team Member'),'role',m.role::text) order by coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Team Member'),m.user_id)
 from public.location_memberships m join public.locations l on l.id=m.location_id join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active' join public.profiles p on p.id=m.user_id where m.location_id=p_location_id and m.status='active'),'[]'::jsonb);
end;$$;

create or replace function public.calendar_event_save_audience(
 p_location_id uuid,p_id uuid,p_version integer,p_request uuid,p_date date,p_title text,p_body text,p_time time,p_category text,p_media jsonb,p_style jsonb,p_audience jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; normalized jsonb;payload jsonb;existing public.calendar_events;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if public.calendar_audience_valid(p_audience) is not true then raise exception 'Choose everyone, or at least one role or person.';end if;
 normalized:=jsonb_build_object('mode',p_audience->>'mode','roles',coalesce((select jsonb_agg(r order by r) from jsonb_array_elements_text(p_audience->'roles') r),'[]'::jsonb),'users',coalesce((select jsonb_agg(lower(u) order by lower(u)) from jsonb_array_elements_text(p_audience->'users') u),'[]'::jsonb));
 if exists(select 1 from jsonb_array_elements_text(normalized->'users') u where not exists(
  select 1 from public.location_memberships m join public.locations l on l.id=m.location_id join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active' where m.location_id=p_location_id and m.user_id=u::uuid and m.status='active'
 )) then raise exception 'Every selected person must be active at this location. Refresh the employee list.';end if;
 payload:=jsonb_build_object('date',p_date,'title',p_title,'body',p_body,'time',p_time,'category',p_category,'media',p_media,'style',p_style,'audience',normalized);
 if p_id is null then
  if p_request is null then raise exception 'Calendar request ID required.';end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-event:'||auth.uid()::text||p_request::text,0));
  select * into existing from public.calendar_events where created_by=auth.uid() and request_id=p_request;
  if found then
   if existing.location_id is distinct from p_location_id or existing.audience_request is distinct from payload or existing.deleted_at is not null then raise exception 'This request was already used. Refresh before posting again.';end if;
   return existing.id;
  end if;
 else
  perform 1 from public.calendar_events where id=p_id and location_id=p_location_id and version=p_version and deleted_at is null for update;
  if not found then raise exception 'Calendar update changed. Refresh before editing.';end if;
 end if;
 result:=public.calendar_event_save_rich(p_location_id,p_id,p_version,p_request,p_date,p_title,p_body,p_time,p_category,p_media,p_style);
 update public.calendar_events set audience=normalized,audience_request=case when p_id is null then payload else audience_request end where id=result and location_id=p_location_id;
 return result;
end;$$;

-- Preserve the current calendar data, styling and schedule logic.
-- Enforce audience visibility before event aggregation, and include it for editing.
do $$
declare target regprocedure;definition text;
begin
 target:=to_regprocedure('public.calendar_read(uuid,date,date)');
 if target is null then raise exception 'Install the existing calendar first.';end if;
 definition:=pg_get_functiondef(target);
 if strpos(definition,'calendar_audience_visible(e.location_id,e.audience)')=0 then
  if (length(definition)-length(replace(definition,'e.deleted_at is null','')))/length('e.deleted_at is null')<>1 or strpos(definition,'''id'',e.id')=0 then raise exception 'Calendar read function changed. No changes applied.';end if;
  definition:=replace(definition,'e.deleted_at is null','e.deleted_at is null and public.calendar_audience_visible(e.location_id,e.audience)');
  definition:=replace(definition,'''id'',e.id','''id'',e.id,''audience'',case when public.mod_is_manager(e.location_id) then e.audience else null end');
  execute definition;
 end if;
 target:=to_regprocedure('public.calendar_media_access(text,text)');
 if target is null then raise exception 'Install calendar flyers first.';end if;
 definition:=pg_get_functiondef(target);
 if strpos(definition,'calendar_audience_visible(e.location_id,e.audience)')=0 then
  if (length(definition)-length(replace(definition,'e.deleted_at is null','')))/length('e.deleted_at is null')<>1 then raise exception 'Calendar flyer access function changed. No changes applied.';end if;
  execute replace(definition,'e.deleted_at is null','e.deleted_at is null and public.calendar_audience_visible(e.location_id,e.audience)');
 end if;
end;$$;

revoke all on function public.calendar_audience_valid(jsonb),public.calendar_audience_visible(uuid,jsonb),public.calendar_audience_roster(uuid),public.calendar_event_save_audience(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_audience_roster(uuid),public.calendar_event_save_audience(uuid,uuid,integer,uuid,date,text,text,time,text,jsonb,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
