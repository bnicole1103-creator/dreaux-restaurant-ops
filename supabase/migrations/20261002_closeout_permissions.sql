begin;

create or replace function public.closeout_is_gm(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
   select 1 from public.location_memberships m
   join public.locations l on l.id=m.location_id
   join public.organization_memberships o on o.organization_id=l.organization_id
     and o.user_id=m.user_id and o.status='active'
   where m.location_id=p_location_id and m.user_id=auth.uid()
     and m.status='active' and m.role='general_manager'
 );
$$;
revoke all on function public.closeout_is_gm(uuid) from public,anon,authenticated;
grant execute on function public.closeout_is_gm(uuid) to authenticated;

-- Enforce GM-only settings even when a manager calls the old save RPC directly.
create or replace function public.closeout_guard_settings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not public.closeout_is_gm(new.location_id) then
   raise exception 'General manager access required to edit settings.' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function public.closeout_guard_settings() from public,anon,authenticated;
drop trigger if exists closeout_settings_gm_only on public.closeout_settings;
create trigger closeout_settings_gm_only before insert or update on public.closeout_settings
for each row execute function public.closeout_guard_settings();

create or replace function public.closeout_create_shift(p_location_id uuid,p_date date,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; org uuid; name text:=btrim(p_name);
begin
 if not public.mod_is_manager(p_location_id) then
   raise exception 'Manager access required.' using errcode='42501';
 end if;
 if p_date is null or p_date>(now() at time zone 'America/Chicago')::date
   or name is null or length(name) not between 1 and 100 then
   raise exception 'Choose a valid shift name and a date up to today.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('closeout-shift:'||p_location_id::text||':'||p_date::text,0));
 select * into s from public.shifts
 where location_id=p_location_id and shift_date=p_date and status<>'cancelled'
   and lower(btrim(shift_name))=lower(name)
 order by created_at,id limit 1;
 if s.id is null then
   select organization_id into org from public.locations where id=p_location_id;
   s.status:='open';
   if p_date<(now() at time zone 'America/Chicago')::date then s.status:='closed'; end if;
   insert into public.shifts(id,organization_id,location_id,shift_date,shift_name,status,opened_by,opened_at)
   values(gen_random_uuid(),org,p_location_id,p_date,name,
     s.status,
     auth.uid(),now()) returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'organization_id',s.organization_id,'location_id',s.location_id,
   'shift_date',s.shift_date,'shift_name',s.shift_name,'status',s.status);
end; $$;
revoke all on function public.closeout_create_shift(uuid,date,text) from public,anon,authenticated;
grant execute on function public.closeout_create_shift(uuid,date,text) to authenticated;

-- Managers can load existing shifts and team summaries.
alter table public.shifts enable row level security;
drop policy if exists closeout_manager_read_shifts on public.shifts;
create policy closeout_manager_read_shifts on public.shifts for select to authenticated
using (public.mod_is_manager(location_id));

-- Staff retain access to their own closeout, but cannot read a teammate's summary.
alter table public.daily_closeouts enable row level security;
drop policy if exists closeout_read_scope on public.daily_closeouts;
create policy closeout_read_scope on public.daily_closeouts as restrictive for select to authenticated
using (user_id=auth.uid() or public.mod_is_manager(location_id));
drop policy if exists closeout_manager_read_summary on public.daily_closeouts;
create policy closeout_manager_read_summary on public.daily_closeouts for select to authenticated
using (public.mod_is_manager(location_id));

alter table public.daily_closeout_tables enable row level security;
drop policy if exists closeout_tables_read_scope on public.daily_closeout_tables;
create policy closeout_tables_read_scope on public.daily_closeout_tables as restrictive for select to authenticated
using (exists(select 1 from public.daily_closeouts c where c.id=closeout_id
  and (c.user_id=auth.uid() or public.mod_is_manager(c.location_id))));
drop policy if exists closeout_manager_read_summary_tables on public.daily_closeout_tables;
create policy closeout_manager_read_summary_tables on public.daily_closeout_tables for select to authenticated
using (exists(select 1 from public.daily_closeouts c where c.id=closeout_id
  and public.mod_is_manager(c.location_id)));

commit;
notify pgrst,'reload schema';

begin;
create table if not exists public.closeout_permissions (
 location_id uuid not null references public.locations(id),
 user_id uuid not null references auth.users(id),
 access_level text not null check(access_level in ('staff','manager','general_manager')),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(location_id,user_id)
);
create table if not exists public.closeout_permission_audit (
 id uuid primary key default gen_random_uuid(), location_id uuid not null,
 user_id uuid not null, changed_by uuid not null, previous_access text not null,
 new_access text not null, created_at timestamptz not null default now()
);
alter table public.closeout_permissions enable row level security;
alter table public.closeout_permission_audit enable row level security;
revoke all on public.closeout_permissions,public.closeout_permission_audit from public,anon,authenticated;

create or replace function public.closeout_is_member(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
 select 1 from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 where m.location_id=p_location_id and m.user_id=auth.uid() and m.status='active');
$$;
create or replace function public.closeout_is_gm(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.closeout_is_member(p_location_id) and exists (
 select 1 from public.location_memberships m left join public.closeout_permissions p
 on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=auth.uid() and
 coalesce(p.access_level,case when m.role='general_manager' then 'general_manager' else 'staff' end)='general_manager');
$$;
create or replace function public.mod_is_manager(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.closeout_is_member(p_location_id) and exists (
 select 1 from public.location_memberships m left join public.closeout_permissions p
 on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=auth.uid() and
 coalesce(p.access_level,case when m.role='general_manager' then 'general_manager'
 when m.role in ('owner','manager','assistant_manager') then 'manager' else 'staff' end) in ('manager','general_manager'));
$$;

create or replace function public.closeout_permission_roster(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.closeout_is_gm(p_location_id) then raise exception 'General manager access required.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(pr.preferred_name,''),pr.full_name,'Staff member'),
 'job_role',m.role,'access_level',coalesce(p.access_level,case when m.role='general_manager' then 'general_manager'
 when m.role in ('owner','manager','assistant_manager') then 'manager' else 'staff' end)) order by pr.full_name,m.user_id),'[]'::jsonb)
 into result from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 left join public.profiles pr on pr.id=m.user_id
 left join public.closeout_permissions p on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.status='active';
 return result;
end; $$;

create or replace function public.closeout_set_permission(p_location_id uuid,p_user_id uuid,p_access text,p_expected text)
returns void language plpgsql security definer set search_path='' as $$
declare previous text; remaining integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('closeout-permissions:'||p_location_id::text,0));
 if not public.closeout_is_gm(p_location_id) then raise exception 'General manager access required.' using errcode='42501'; end if;
 if p_access is null or p_access not in ('staff','manager','general_manager') then raise exception 'Invalid access level.'; end if;
 select coalesce(p.access_level,case when m.role='general_manager' then 'general_manager'
 when m.role in ('owner','manager','assistant_manager') then 'manager' else 'staff' end) into previous
 from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 left join public.closeout_permissions p on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=p_user_id and m.status='active';
 if previous is null then raise exception 'Employee is not active at this location.'; end if;
 if p_expected is distinct from previous then raise exception 'Permissions changed. Reload and try again.'; end if;
 if previous=p_access then return; end if;
 if previous='general_manager' and p_access<>'general_manager' then
 select count(*) into remaining from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 left join public.closeout_permissions p on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id<>p_user_id and m.status='active'
 and coalesce(p.access_level,case when m.role='general_manager' then 'general_manager' else 'staff' end)='general_manager';
 if remaining=0 then raise exception 'Keep at least one active general manager.'; end if;
 end if;
 insert into public.closeout_permissions(location_id,user_id,access_level,updated_by)
 values(p_location_id,p_user_id,p_access,auth.uid()) on conflict(location_id,user_id)
 do update set access_level=excluded.access_level,updated_by=excluded.updated_by,updated_at=now();
 insert into public.closeout_permission_audit(location_id,user_id,changed_by,previous_access,new_access)
 values(p_location_id,p_user_id,auth.uid(),previous,p_access);
end; $$;
revoke all on function public.closeout_is_member(uuid),public.closeout_is_gm(uuid),public.mod_is_manager(uuid),public.closeout_permission_roster(uuid),public.closeout_set_permission(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.closeout_is_member(uuid),public.closeout_is_gm(uuid),public.mod_is_manager(uuid),public.closeout_permission_roster(uuid),public.closeout_set_permission(uuid,uuid,text,text) to authenticated;

-- The restrictive policies also constrain any older broad SELECT policies.
drop policy if exists closeout_read_scope on public.daily_closeouts;
create policy closeout_read_scope on public.daily_closeouts as restrictive for select to authenticated
using(public.closeout_is_member(location_id) and (user_id=auth.uid() or public.mod_is_manager(location_id)));
drop policy if exists closeout_own_summary on public.daily_closeouts;
create policy closeout_own_summary on public.daily_closeouts for select to authenticated
using(public.closeout_is_member(location_id) and user_id=auth.uid());
drop policy if exists closeout_tables_read_scope on public.daily_closeout_tables;
create policy closeout_tables_read_scope on public.daily_closeout_tables as restrictive for select to authenticated
using(exists(select 1 from public.daily_closeouts c where c.id=closeout_id));
drop policy if exists closeout_own_summary_tables on public.daily_closeout_tables;
create policy closeout_own_summary_tables on public.daily_closeout_tables for select to authenticated
using(exists(select 1 from public.daily_closeouts c where c.id=closeout_id and c.user_id=auth.uid()));
commit;
notify pgrst,'reload schema';
