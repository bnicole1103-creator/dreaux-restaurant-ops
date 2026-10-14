begin;
create schema if not exists staff_preview_private;
revoke all on schema staff_preview_private from public,anon,authenticated;
create table if not exists staff_preview_private.sessions(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 gm_id uuid not null references public.profiles(id),target_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes',revoked_at timestamptz
);
create table if not exists staff_preview_private.layouts(
 location_id uuid not null references public.locations(id),page text not null,scope text not null,
 version integer not null default 0,draft jsonb not null default '{}',published jsonb not null default '{}',
 changed_by uuid,changed_at timestamptz not null default now(),primary key(location_id,page,scope)
);
create table if not exists staff_preview_private.audit(
 id bigint generated always as identity primary key,location_id uuid not null,page text,scope text,actor uuid not null,
 action text not null,recorded_at timestamptz not null default now(),before_value jsonb,after_value jsonb
);
revoke all on all tables in schema staff_preview_private from public,anon,authenticated;
create or replace function public.staff_view_roster(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Employee'),'role',m.role::text) order by p.full_name)
 from public.location_memberships m join public.profiles p on p.id=m.user_id where m.location_id=p_location_id and m.status='active'),'[]'::jsonb);
end;$$;
create or replace function public.staff_view_start(p_location_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare token uuid;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501';end if;
 if not exists(select 1 from public.location_memberships where location_id=p_location_id and user_id=p_user_id and status='active') then raise exception 'Choose an active employee at this location.';end if;
 update staff_preview_private.sessions set revoked_at=now() where gm_id=auth.uid() and revoked_at is null;
 insert into staff_preview_private.sessions(location_id,gm_id,target_id) values(p_location_id,auth.uid(),p_user_id) returning id into token;
 return jsonb_build_object('id',token,'expires_at',now()+interval '15 minutes');
end;$$;
create or replace function public.staff_view_check(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare s staff_preview_private.sessions;u record;role_name text;org uuid;begin
 select * into s from staff_preview_private.sessions where id=p_session_id and gm_id=auth.uid() and revoked_at is null and expires_at>now();
 if not found or auth.uid() is null or public.closeout_is_member(s.location_id) is not true or public.closeout_is_gm(s.location_id) is not true then raise exception 'Staff preview expired or access was revoked. Start a new preview.' using errcode='42501';end if;
 select role::text into role_name from public.location_memberships where location_id=s.location_id and user_id=s.target_id and status='active';
 if role_name is null then raise exception 'Employee is no longer active at this location.' using errcode='42501';end if;
 select id,email,raw_user_meta_data,raw_app_meta_data,email_confirmed_at,created_at,banned_until,deleted_at into u from auth.users where id=s.target_id;
 if not found then raise exception 'Employee authentication account is unavailable.';end if;
 if u.deleted_at is not null or u.banned_until>now() then raise exception 'Employee sign-in is disabled; a staff preview cannot be started.' using errcode='42501';end if;
 select organization_id into org from public.locations where id=s.location_id and is_active;
 if org is null then raise exception 'Location is not active.';end if;
 return jsonb_build_object('location_id',s.location_id,'organization_id',org,'target_id',s.target_id,'role',role_name,'expires_at',s.expires_at,
 'user',jsonb_build_object('id',u.id,'email',u.email,'aud','authenticated','role','authenticated','created_at',u.created_at,'email_confirmed_at',u.email_confirmed_at,'user_metadata',coalesce(u.raw_user_meta_data,'{}'::jsonb),'app_metadata',coalesce(u.raw_app_meta_data,'{}'::jsonb)));
end;$$;
create or replace function public.staff_view_end(p_session_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update staff_preview_private.sessions set revoked_at=now() where id=p_session_id and gm_id=auth.uid();
end;$$;
create or replace function staff_preview_private.validate_layout(p_page text,p_scope text,p_changes jsonb) returns void language plpgsql set search_path='' as $$declare e record;v record;begin
 if p_page is null or p_page!~'^/[A-Za-z0-9/_:-]*$' or length(p_page)>200 or p_scope not in ('all','server','bartender','host','busser','kitchen','employee') or p_scope is null then raise exception 'Choose a staff page and layout scope.';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>100000 or (select count(*) from jsonb_object_keys(p_changes))>500 then raise exception 'Invalid staff layout.';end if;
 for e in select * from jsonb_each(p_changes) loop
 if e.key!~'^[A-Za-z0-9_.-]{1,160}$' or jsonb_typeof(e.value) is distinct from 'object' then raise exception 'Invalid screen element.';end if;
 for v in select * from jsonb_each(e.value) loop
 if v.key='text' then if jsonb_typeof(v.value)<>'string' or length(v.value#>>'{}')>2000 then raise exception 'Wording must be at most 2000 characters.';end if;
 elsif v.key='hidden' then if jsonb_typeof(v.value)<>'boolean' then raise exception 'Invalid visibility.';end if;
 elsif v.key='order' then if jsonb_typeof(v.value)<>'number' or (v.value#>>'{}')!~'^[0-9]{1,4}$' then raise exception 'Invalid section order.';end if;
 elsif v.key='parent' then if jsonb_typeof(v.value)<>'string' or (v.value#>>'{}')!~'^[A-Za-z0-9_.-]{1,160}$' then raise exception 'Invalid section parent.';end if;
 else raise exception 'Unsupported layout property.';end if;
 end loop;end loop;
end;$$;
create or replace function public.staff_layout_editor(p_location_id uuid,p_page text,p_scope text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r staff_preview_private.layouts;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501';end if;
 perform staff_preview_private.validate_layout(p_page,p_scope,'{}');
 select * into r from staff_preview_private.layouts where location_id=p_location_id and page=p_page and scope=p_scope;
 return jsonb_build_object('version',coalesce(r.version,0),'draft',coalesce(r.draft,'{}'::jsonb),'published',coalesce(r.published,'{}'::jsonb));
end;$$;
create or replace function public.staff_layout_save(p_location_id uuid,p_page text,p_scope text,p_version integer,p_changes jsonb,p_publish boolean) returns jsonb language plpgsql security definer set search_path='' as $$declare before jsonb;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'General manager access required.' using errcode='42501';end if;
 perform staff_preview_private.validate_layout(p_page,p_scope,p_changes);
 if p_publish is null then raise exception 'Choose save draft or publish.';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-layout:'||p_location_id::text||p_page||p_scope,0));
 before:=public.staff_layout_editor(p_location_id,p_page,p_scope);
 if p_version is distinct from (before->>'version')::integer then raise exception 'Another manager changed this layout. Reload before saving.';end if;
 insert into staff_preview_private.layouts(location_id,page,scope,version,draft,published,changed_by)
 values(p_location_id,p_page,p_scope,p_version+1,p_changes,case when p_publish then p_changes else before->'published' end,auth.uid())
 on conflict(location_id,page,scope) do update set version=excluded.version,draft=excluded.draft,published=excluded.published,changed_by=auth.uid(),changed_at=now();
 insert into staff_preview_private.audit(location_id,page,scope,actor,action,before_value,after_value) values(p_location_id,p_page,p_scope,auth.uid(),case when p_publish then 'publish' else 'draft' end,before,public.staff_layout_editor(p_location_id,p_page,p_scope));
 return public.staff_layout_editor(p_location_id,p_page,p_scope);
end;$$;
create or replace function public.staff_layout_load(p_location_id uuid,p_page text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare role_name text;begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 select role::text into role_name from public.location_memberships where location_id=p_location_id and user_id=auth.uid() and status='active';
 if public.mod_is_manager(p_location_id) is true then return jsonb_build_object('all','{}'::jsonb,'role','{}'::jsonb,'role_name',role_name);end if;
 return jsonb_build_object('role_name',role_name,
 'all',coalesce((select published from staff_preview_private.layouts where location_id=p_location_id and page=p_page and scope='all'),'{}'::jsonb),
 'role',coalesce((select published from staff_preview_private.layouts where location_id=p_location_id and page=p_page and scope=role_name),'{}'::jsonb));
end;$$;
-- Read-only schedule snapshot. Preview never refreshes external integrations.
create or replace function public.staff_view_schedule(p_location_id uuid,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 return coalesce((select jsonb_build_object('schedule_date',schedule_date,'rows',rows,'synced_at',synced_at,'configured',true,'error',last_error) from public.home_schedule_cache where location_id=p_location_id and schedule_date=p_day),jsonb_build_object('schedule_date',p_day,'rows','[]'::jsonb,'configured',false,'error','No cached schedule available. Preview never starts a sync.'));
end;$$;
revoke all on all functions in schema staff_preview_private from public,anon,authenticated;
revoke all on function public.staff_view_roster(uuid),public.staff_view_start(uuid,uuid),public.staff_view_check(uuid),public.staff_view_end(uuid),public.staff_layout_editor(uuid,text,text),public.staff_layout_save(uuid,text,text,integer,jsonb,boolean),public.staff_layout_load(uuid,text),public.staff_view_schedule(uuid,date) from public,anon;
grant execute on function public.staff_view_roster(uuid),public.staff_view_start(uuid,uuid),public.staff_view_check(uuid),public.staff_view_end(uuid),public.staff_layout_editor(uuid,text,text),public.staff_layout_save(uuid,text,text,integer,jsonb,boolean),public.staff_layout_load(uuid,text),public.staff_view_schedule(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
