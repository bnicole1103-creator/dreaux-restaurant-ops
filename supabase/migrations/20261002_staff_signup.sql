begin;

create table if not exists public.staff_signup_links (
 location_id uuid primary key references public.locations(id) on delete cascade,
 token text not null unique default (gen_random_uuid()::text || gen_random_uuid()::text),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.staff_signup_requests (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','declined')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz, reviewed_by uuid references public.profiles(id),
 unique(location_id,user_id)
);
alter table public.staff_signup_links enable row level security;
alter table public.staff_signup_requests enable row level security;
revoke all on public.staff_signup_links,public.staff_signup_requests from public,anon,authenticated;

create or replace function public.staff_signup_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 return jsonb_build_object(
  'verified',exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null),
  'active',exists(select 1 from public.location_memberships m
   join public.locations l on l.id=m.location_id and l.is_active
   join public.profiles p on p.id=m.user_id and p.is_active
   join public.organization_memberships o on o.organization_id=l.organization_id and o.user_id=m.user_id
   where m.user_id=auth.uid() and m.status='active' and o.status='active'),
  'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'location',l.name,'status',r.status) order by r.created_at)
   from public.staff_signup_requests r join public.locations l on l.id=r.location_id where r.user_id=auth.uid()),'[]'::jsonb));
end; $$;

create or replace function public.staff_signup_request(p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare loc uuid; org uuid; person text;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 select nullif(btrim(raw_user_meta_data->>'full_name'),'') into person from auth.users
 where id=auth.uid() and email_confirmed_at is not null;
 if person is null then raise exception 'Confirm your email and provide your full name before requesting access.'; end if;
 select l.id,l.organization_id into loc,org from public.staff_signup_links s
 join public.locations l on l.id=s.location_id and l.is_active where s.token=p_token;
 if loc is null then raise exception 'This registration link is unavailable. Ask your GM for the current link.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-signup:'||auth.uid()::text,0));
 if exists(select 1 from public.location_memberships where location_id=loc and user_id=auth.uid()) then
  raise exception 'You already have a membership here. Ask your GM to check its status.';
 end if;
 if exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and status<>'active') then
  raise exception 'An existing organization membership needs GM review.';
 end if;
 insert into public.profiles(id,full_name) values(auth.uid(),left(person,200)) on conflict(id) do update set full_name=case when btrim(public.profiles.full_name)='' then excluded.full_name else public.profiles.full_name end;
 if exists(select 1 from public.profiles where id=auth.uid() and not is_active) then
  raise exception 'Your account needs GM review.';
 end if;
 insert into public.staff_signup_requests(location_id,user_id) values(loc,auth.uid()) on conflict(location_id,user_id) do nothing;
end; $$;

create or replace function public.staff_signup_link(p_location_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare link text;
begin
 if not public.closeout_is_gm(p_location_id) then raise exception 'General manager access required.' using errcode='42501'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and is_active) then raise exception 'Location is inactive.'; end if;
 insert into public.staff_signup_links(location_id,created_by) values(p_location_id,auth.uid()) on conflict(location_id) do nothing;
 select token into link from public.staff_signup_links where location_id=p_location_id;
 return link;
end; $$;

create or replace function public.staff_signup_queue(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.closeout_is_gm(p_location_id) then raise exception 'General manager access required.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',p.full_name,'email',u.email,'created_at',r.created_at) order by r.created_at)
  from public.staff_signup_requests r join public.profiles p on p.id=r.user_id join auth.users u on u.id=r.user_id
  where r.location_id=p_location_id and r.status='pending'),'[]'::jsonb);
end; $$;

create or replace function public.staff_signup_decide(p_request_id uuid,p_approve boolean,p_job_role text,p_access text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.staff_signup_requests%rowtype; org uuid;
begin
 select * into r from public.staff_signup_requests where id=p_request_id for update;
 if r.id is null or not public.closeout_is_gm(r.location_id) then raise exception 'General manager access required.' using errcode='42501'; end if;
 if r.status<>'pending' then raise exception 'This request was already reviewed. Reload the list.'; end if;
 if p_approve is null then raise exception 'Choose approve or decline.'; end if;
 if p_approve then
  if p_job_role is null or p_job_role not in ('host','server','bartender','busser','kitchen','employee','manager','assistant_manager','general_manager')
    or p_access is null or p_access not in ('staff','manager','general_manager') then raise exception 'Choose a valid job role and access level.'; end if;
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

revoke all on function public.staff_signup_status(),public.staff_signup_request(text),public.staff_signup_link(uuid),public.staff_signup_queue(uuid),public.staff_signup_decide(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.staff_signup_status(),public.staff_signup_request(text),public.staff_signup_link(uuid),public.staff_signup_queue(uuid),public.staff_signup_decide(uuid,boolean,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
