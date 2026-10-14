begin;
-- Do not replace quiz, closeout, or assigned task rules.
do $$begin
 if to_regprocedure('public.points_source_entries(uuid)') is null or to_regprocedure('staff_ops_private.cutoff(date)') is null then raise exception 'Install the staff obligations migration first.';end if;
end;$$;
create table if not exists public.disposal_requirements(
 location_id uuid not null references public.locations(id),business_date date not null,
 user_id uuid not null references public.profiles(id),assigned_at timestamptz not null default now(),
 assigned_by uuid not null,active boolean not null default true,updated_at timestamptz not null default now(),updated_by uuid not null,
 primary key(location_id,business_date,user_id)
);
create table if not exists public.disposal_zero_reports(
 location_id uuid not null,business_date date not null,user_id uuid not null,submitted_at timestamptz not null default now(),
 primary key(location_id,business_date,user_id),
 foreign key(location_id,business_date,user_id) references public.disposal_requirements(location_id,business_date,user_id)
);
alter table public.disposal_requirements enable row level security;
alter table public.disposal_zero_reports enable row level security;
revoke all on public.disposal_requirements,public.disposal_zero_reports from public,anon,authenticated;
create or replace function staff_ops_private.disposal_completed(p_location uuid,p_day date,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.disposal_zero_reports z where z.location_id=p_location and z.business_date=p_day and z.user_id=p_user and z.submitted_at<staff_ops_private.cutoff(p_day))
 or exists(select 1 from public.inventory_disposal_sheets d where d.location_id=p_location and d.user_id=p_user
 and d.submitted_at>=((p_day+time '04:00') at time zone 'America/Chicago') and d.submitted_at<staff_ops_private.cutoff(p_day)
 and to_jsonb(d)->>'deleted_at' is null);
$$;
revoke all on function staff_ops_private.disposal_completed(uuid,date,uuid) from public,anon,authenticated;
create or replace function public.disposal_requirement_assign(p_location_id uuid,p_day date,p_user_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.mod_is_manager(p_location_id) is not true then raise exception 'Manager access required.' using errcode='42501';end if;
 if p_active is null or p_day is null then raise exception 'Select a service date and assignment state.';end if;
 if p_active and (p_day<((now() at time zone 'America/Chicago')-interval '4 hours')::date or now()>=staff_ops_private.cutoff(p_day)) then raise exception 'Assign disposal forms before the deadline; past days cannot be assigned.';end if;
 if not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=p_user_id and status='active') then raise exception 'Choose an active employee at this location.';end if;
 insert into public.disposal_requirements(location_id,business_date,user_id,assigned_by,updated_by,active)
 values(p_location_id,p_day,p_user_id,auth.uid(),auth.uid(),p_active)
 on conflict(location_id,business_date,user_id) do update set active=excluded.active,updated_at=now(),updated_by=auth.uid(),
 assigned_at=case when excluded.active and not disposal_requirements.active then now() else disposal_requirements.assigned_at end;
end;$$;
create or replace function public.disposal_requirement_none(p_location_id uuid,p_day date) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 if p_day is distinct from ((now() at time zone 'America/Chicago')-interval '4 hours')::date then raise exception 'Confirm no disposals for the current service day only.';end if;
 if not exists(select 1 from public.disposal_requirements where location_id=p_location_id and business_date=p_day and user_id=auth.uid() and active) then raise exception 'No active disposal assignment for you on this day.';end if;
 insert into public.disposal_zero_reports(location_id,business_date,user_id) values(p_location_id,p_day,auth.uid()) on conflict do nothing;
end;$$;
create or replace function public.disposal_requirements_day(p_location_id uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 if p_day is null then raise exception 'Select a service date.';end if;
 manager:=public.mod_is_manager(p_location_id) is true;
 return jsonb_build_object('manager',manager,'user_id',auth.uid(),'day',p_day,'deadline',staff_ops_private.cutoff(p_day),'open',now()<staff_ops_private.cutoff(p_day),
 'employees',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',x.user_id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee'))) from (select distinct user_id from public.location_memberships where location_id=p_location_id and status='active') x join public.profiles p on p.id=x.user_id),'[]'::jsonb) else '[]'::jsonb end,
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee'),'completed',staff_ops_private.disposal_completed(p_location_id,p_day,r.user_id),'no_disposals',exists(select 1 from public.disposal_zero_reports z where z.location_id=r.location_id and z.business_date=r.business_date and z.user_id=r.user_id))) from public.disposal_requirements r join public.profiles p on p.id=r.user_id where r.location_id=p_location_id and r.business_date=p_day and r.active and (manager or r.user_id=auth.uid())),'[]'::jsonb));
end;$$;
revoke all on function public.disposal_requirement_assign(uuid,date,uuid,boolean),public.disposal_requirement_none(uuid,date),public.disposal_requirements_day(uuid,date) from public,anon;
grant execute on function public.disposal_requirement_assign(uuid,date,uuid,boolean),public.disposal_requirement_none(uuid,date),public.disposal_requirements_day(uuid,date) to authenticated;
do $$begin
 if to_regprocedure('staff_ops_private.points_before_disposal(uuid)') is null then
 alter function public.points_source_entries(uuid) set schema staff_ops_private;
 alter function staff_ops_private.points_source_entries(uuid) rename to points_before_disposal;
 end if;
end;$$;
revoke all on function staff_ops_private.points_before_disposal(uuid) from public,anon,authenticated;
create or replace function public.points_source_entries(p_location_id uuid)
returns table(user_id uuid,business_date date,entry_key text,points integer,description text)
language sql stable security definer set search_path='' as $$
 select * from staff_ops_private.points_before_disposal(p_location_id)
 union all
 select r.user_id,r.business_date,'missed-disposal:'||r.business_date::text||':'||r.user_id::text,-10,'Missing assigned disposal form'::text
 from public.disposal_requirements r
 where r.location_id=p_location_id and r.active and r.assigned_at<staff_ops_private.cutoff(r.business_date)
 and now()>=staff_ops_private.cutoff(r.business_date)
 and not staff_ops_private.disposal_completed(r.location_id,r.business_date,r.user_id);
$$;
revoke all on function public.points_source_entries(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
