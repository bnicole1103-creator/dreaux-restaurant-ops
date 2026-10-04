begin;
alter table public.closeout_permissions drop constraint if exists closeout_permissions_access_level_check;
alter table public.closeout_permissions add constraint closeout_permissions_access_level_check
 check(access_level in ('staff','manager','general_manager','owner'));
create or replace function public.closeout_is_gm(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.closeout_is_member(p_location_id) and exists (
 select 1 from public.location_memberships m left join public.closeout_permissions p
 on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=auth.uid() and
 coalesce(p.access_level,case when m.role='owner' then 'owner' when m.role='general_manager' then 'general_manager' else 'staff' end) in ('owner','general_manager'));
$$;
create or replace function public.mod_is_manager(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.closeout_is_member(p_location_id) and exists (
 select 1 from public.location_memberships m left join public.closeout_permissions p
 on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=auth.uid() and
 coalesce(p.access_level,case when m.role='owner' then 'owner' when m.role='general_manager' then 'general_manager'
 when m.role in ('manager','assistant_manager') then 'manager' else 'staff' end) in ('owner','manager','general_manager'));
$$;

create or replace function public.closeout_permission_roster(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.closeout_is_gm(p_location_id) then raise exception 'Owner or general manager access required.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(pr.preferred_name,''),pr.full_name,'Staff member'),
 'job_role',m.role,'access_level',coalesce(p.access_level,case when m.role='owner' then 'owner' when m.role='general_manager' then 'general_manager'
 when m.role in ('manager','assistant_manager') then 'manager' else 'staff' end)) order by pr.full_name,m.user_id),'[]'::jsonb)
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
 if not public.closeout_is_gm(p_location_id) then raise exception 'Owner or general manager access required.' using errcode='42501'; end if;
 if p_access is null or p_access not in ('staff','manager','general_manager','owner') then raise exception 'Invalid access level.'; end if;
 select coalesce(p.access_level,case when m.role='owner' then 'owner' when m.role='general_manager' then 'general_manager'
 when m.role in ('manager','assistant_manager') then 'manager' else 'staff' end) into previous
 from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 left join public.closeout_permissions p on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id=p_user_id and m.status='active';
 if previous is null then raise exception 'Employee is not active at this location.'; end if;
 if p_expected is distinct from previous then raise exception 'Permissions changed. Reload and try again.'; end if;
 if previous=p_access then return; end if;
 if previous in ('owner','general_manager') and p_access not in ('owner','general_manager') then
 select count(*) into remaining from public.location_memberships m join public.locations l on l.id=m.location_id
 join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id and o.status='active'
 left join public.closeout_permissions p on p.location_id=m.location_id and p.user_id=m.user_id
 where m.location_id=p_location_id and m.user_id<>p_user_id and m.status='active'
 and coalesce(p.access_level,case when m.role='owner' then 'owner' when m.role='general_manager' then 'general_manager' else 'staff' end) in ('owner','general_manager');
 if remaining=0 then raise exception 'Keep at least one active owner or general manager.'; end if;
 end if;
 insert into public.closeout_permissions(location_id,user_id,access_level,updated_by)
 values(p_location_id,p_user_id,p_access,auth.uid()) on conflict(location_id,user_id)
 do update set access_level=excluded.access_level,updated_by=excluded.updated_by,updated_at=now();
 insert into public.closeout_permission_audit(location_id,user_id,changed_by,previous_access,new_access)
 values(p_location_id,p_user_id,auth.uid(),previous,p_access);
end; $$;
revoke all on function public.closeout_is_member(uuid),public.closeout_is_gm(uuid),public.mod_is_manager(uuid),public.closeout_permission_roster(uuid),public.closeout_set_permission(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.closeout_is_member(uuid),public.closeout_is_gm(uuid),public.mod_is_manager(uuid),public.closeout_permission_roster(uuid),public.closeout_set_permission(uuid,uuid,text,text) to authenticated;

create or replace function public.staff_signup_decide(p_request_id uuid,p_approve boolean,p_job_role text,p_access text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.staff_signup_requests%rowtype; org uuid;
begin
 select * into r from public.staff_signup_requests where id=p_request_id for update;
 if r.id is null or not public.closeout_is_gm(r.location_id) then raise exception 'Owner or general manager access required.' using errcode='42501'; end if;
 if r.status<>'pending' then raise exception 'This request was already reviewed. Reload the list.'; end if;
 if p_approve is null then raise exception 'Choose approve or decline.'; end if;
 if p_approve then
  if p_job_role is null or p_job_role not in ('host','server','bartender','busser','kitchen','employee','manager','assistant_manager','general_manager','owner')
    or p_access is null or p_access not in ('staff','manager','general_manager','owner') then raise exception 'Choose a valid job role and access level.'; end if;
  if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=r.user_id and u.email_confirmed_at is not null and p.is_active) then
   raise exception 'The employee must have a confirmed email and active profile.';
  end if;
  select organization_id into org from public.locations where id=r.location_id and is_active;
  if org is null then raise exception 'Location is inactive.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-signup:'||r.user_id::text,0));
  if exists(select 1 from public.location_memberships where location_id=r.location_id and user_id=r.user_id)
   or exists(select 1 from public.organization_memberships where organization_id=org and user_id=r.user_id and status<>'active') then
   raise exception 'Existing membership requires separate review; signup will not replace or reactivate it.';
  end if;
  insert into public.organization_memberships(organization_id,user_id,role,status,invited_by,joined_at)
   values(org,r.user_id,'employee','active',auth.uid(),now()) on conflict(organization_id,user_id) do nothing;
  insert into public.location_memberships(location_id,user_id,role,status) values(r.location_id,r.user_id,p_job_role,'active');
  insert into public.closeout_permissions(location_id,user_id,access_level,updated_by) values(r.location_id,r.user_id,p_access,auth.uid())
   on conflict(location_id,user_id) do update set access_level=excluded.access_level,updated_by=excluded.updated_by,updated_at=now();
  insert into public.closeout_permission_audit(location_id,user_id,changed_by,previous_access,new_access)
   values(r.location_id,r.user_id,auth.uid(),'pending',p_access);
 end if;
 update public.staff_signup_requests set status=case when p_approve then 'approved' else 'declined' end,
  reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
end; $$;


revoke all on function public.staff_signup_decide(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.staff_signup_decide(uuid,boolean,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
