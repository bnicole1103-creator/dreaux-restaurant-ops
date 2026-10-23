begin;
do $check$ begin
 if to_regprocedure('crew_ops_private.tools_load_before_controls(uuid,date)') is null
 or to_regprocedure('public.crew_schedule_tools_load(uuid,date)') is null
 or to_regprocedure('push_private.require_gm(uuid)') is null then
  raise exception 'Install Controls Shared Schedule first. No changes applied.';
 end if;
end;$check$;

create table if not exists public.dining_hours_settings (
 location_id uuid primary key references public.locations(id),
 version integer not null default 1,
 days jsonb not null,
 closing_minutes integer not null,
 decline_minutes integer not null,
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(days)='array' and jsonb_array_length(days)=7),
 check(closing_minutes between 0 and 360),
 check(decline_minutes between 15 and 960)
);
alter table public.dining_hours_settings enable row level security;
revoke all on public.dining_hours_settings from public,anon,authenticated;

create or replace function crew_ops_private.dining_settings(l uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((
  select jsonb_build_object('version',version,'days',days,
   'closing_minutes',closing_minutes,'decline_minutes',decline_minutes)
  from public.dining_hours_settings where location_id=l
 ),jsonb_build_object('version',0,'closing_minutes',90,'decline_minutes',480,
  'days','[
   {"closed":false,"open":"11:00","close":"16:00"},
   {"closed":true,"open":"00:00","close":"00:00"},
   {"closed":false,"open":"16:00","close":"21:00"},
   {"closed":false,"open":"12:00","close":"21:00"},
   {"closed":false,"open":"12:00","close":"21:00"},
   {"closed":false,"open":"11:00","close":"22:00"},
   {"closed":false,"open":"11:00","close":"22:00"}
  ]'::jsonb));
$$;

create or replace function public.dining_hours_load(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform push_private.require_gm(p_location_id);
 return crew_ops_private.dining_settings(p_location_id);
end;$$;

create or replace function public.dining_hours_save(
 p_location_id uuid,p_version integer,p_values jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;v integer;op integer;cl integer;buf integer;dur integer;
begin
 perform push_private.require_gm(p_location_id);
 if jsonb_typeof(p_values) is distinct from 'object'
 or jsonb_typeof(p_values->'days') is distinct from 'array'
 or jsonb_array_length(p_values->'days')<>7 then
  raise exception 'Enter all seven weekdays.';
 end if;
 if coalesce(p_values->>'closing_minutes','')!~ '^[0-9]{1,3}$'
 or coalesce(p_values->>'decline_minutes','')!~ '^[0-9]{1,3}$' then
  raise exception 'Enter whole minutes for shift estimates.';
 end if;
 buf:=(p_values->>'closing_minutes')::integer;
 dur:=(p_values->>'decline_minutes')::integer;
 if buf not between 0 and 360 or dur not between 15 and 960 then
  raise exception 'Closing duties must be 0–360 minutes; Business decline must be 0.25–16 hours.';
 end if;
 for d in select value from jsonb_array_elements(p_values->'days') loop
  if jsonb_typeof(d) is distinct from 'object'
  or jsonb_typeof(d->'closed') is distinct from 'boolean'
  or coalesce(d->>'open','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or coalesce(d->>'close','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   raise exception 'Choose valid opening and closing times for each weekday.';
  end if;
  if not (d->>'closed')::boolean then
   op:=extract(hour from (d->>'open')::time)::integer*60+extract(minute from (d->>'open')::time)::integer;
   cl:=extract(hour from (d->>'close')::time)::integer*60+extract(minute from (d->>'close')::time)::integer;
   if op<240 then op:=op+1440;end if;
   if cl<240 then cl:=cl+1440;end if;
   if cl<=op or cl+buf>1680 then
    raise exception 'Dining close must follow opening, with closing duties finished by the 4 AM service-day cutoff.';
   end if;
  end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('dining-hours:'||p_location_id::text,0));
 select version into v from public.dining_hours_settings where location_id=p_location_id;
 if coalesce(v,0) is distinct from p_version then
  raise exception 'Dining hours changed. Reload the page before saving.';
 end if;
 insert into public.dining_hours_settings(location_id,version,days,closing_minutes,decline_minutes,updated_by)
 values(p_location_id,p_version+1,p_values->'days',buf,dur,auth.uid())
 on conflict(location_id) do update set version=excluded.version,days=excluded.days,
  closing_minutes=excluded.closing_minutes,decline_minutes=excluded.decline_minutes,
  updated_by=auth.uid(),updated_at=clock_timestamp();
 return crew_ops_private.dining_settings(p_location_id);
end;$$;

-- Retain the existing access checks and authoritative snapshot.
do $keep$ begin
 if to_regprocedure('crew_ops_private.tools_load_before_dining(uuid,date)') is null then
  alter function public.crew_schedule_tools_load(uuid,date) set schema crew_ops_private;
  alter function crew_ops_private.crew_schedule_tools_load(uuid,date) rename to tools_load_before_dining;
 end if;
end;$keep$;

create or replace function public.crew_schedule_tools_load(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;rows jsonb;
begin
 result:=crew_ops_private.tools_load_before_dining(p_location_id,p_day);
 -- An automatic required-work roster can omit imported Close/Business decline flags.
 -- Recover those flags only for unconfirmed dates, without changing the snapshot.
 select coalesce(jsonb_agg(
  case when coalesce((result->>'override')::boolean,false) then r else
   r||jsonb_build_object(
    'close',coalesce((raw->>'close')::boolean,(r->>'close')::boolean,false),
    'business_decline',coalesce((raw->>'business_decline')::boolean,(r->>'business_decline')::boolean,false)
   ) end order by ord
 ),'[]'::jsonb) into rows
 from jsonb_array_elements(coalesce(result->'rows','[]'::jsonb)) with ordinality t(r,ord)
 left join lateral (
  select x as raw from public.home_schedule_cache c
  cross join lateral jsonb_array_elements(c.rows) x
  where c.location_id=p_location_id and c.schedule_date=p_day
   and x->>'id'=r->>'id' limit 1
 ) cache on true;
 return result||jsonb_build_object('rows',rows,'dining_hours',crew_ops_private.dining_settings(p_location_id),'dining_preserve',exists(select 1 from public.staff_schedule_days where location_id=p_location_id and business_date=p_day and valid and not operations_auto));
end;$$;

revoke all on function crew_ops_private.dining_settings(uuid),crew_ops_private.tools_load_before_dining(uuid,date) from public,anon,authenticated;
revoke all on function public.dining_hours_load(uuid),public.dining_hours_save(uuid,integer,jsonb),public.crew_schedule_tools_load(uuid,date) from public,anon,authenticated;
grant execute on function public.dining_hours_load(uuid),public.dining_hours_save(uuid,integer,jsonb),public.crew_schedule_tools_load(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
