begin;
create table if not exists public.page_designs(
 location_id uuid not null references public.locations(id),page text not null,
 version integer not null default 0,changes jsonb not null default '{}',
 updated_by uuid,updated_at timestamptz not null default now(),primary key(location_id,page)
);
create table if not exists public.page_design_audit(
 id bigint generated always as identity primary key,location_id uuid not null,
 page text not null,changed_by uuid not null,changed_at timestamptz not null default now(),
 before_design jsonb not null,after_design jsonb not null
);
alter table public.page_designs enable row level security;
alter table public.page_design_audit enable row level security;
revoke all on public.page_designs,public.page_design_audit from public,anon,authenticated;
create or replace function public.page_design_load(p_location_id uuid,p_page text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active employee access required.' using errcode='42501';
 end if;
 return coalesce((select jsonb_build_object('version',version,'changes',changes)
 from public.page_designs where location_id=p_location_id and page=p_page),
 jsonb_build_object('version',0,'changes','{}'::jsonb));
end;$$;
create or replace function public.page_design_save(p_location_id uuid,p_page text,p_version integer,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb;entry record;property record;result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'General manager access required.' using errcode='42501';
 end if;
 if p_page is null or p_page !~ '^/[A-Za-z0-9/_:-]*$' or length(p_page)>200
 or jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>500000 then
  raise exception 'Invalid page design.';
 end if;
 if (select count(*) from jsonb_object_keys(p_changes))>2000 then raise exception 'Too many page changes.';end if;
 for entry in select * from jsonb_each(p_changes) loop
  if entry.key !~ '^[A-Za-z0-9_.-]{1,160}$' or jsonb_typeof(entry.value) is distinct from 'object' then raise exception 'Invalid design element.';end if;
  for property in select * from jsonb_each(entry.value) loop
   if property.key='text' then
    if jsonb_typeof(property.value)<>'string' or length(property.value#>>'{}')>2000 then raise exception 'Text must be up to 2000 characters.';end if;
   elsif property.key='hidden' then
    if jsonb_typeof(property.value)<>'boolean' then raise exception 'Invalid visibility.';end if;
   elsif property.key in ('x','y','order') then
    if jsonb_typeof(property.value)<>'number' or (property.value#>>'{}') !~ '^-?[0-9]+$' or abs((property.value#>>'{}')::numeric)>2000 then raise exception 'Invalid position.';end if;
   elsif property.key='parent' then
    if jsonb_typeof(property.value)<>'string' or (property.value#>>'{}') !~ '^[A-Za-z0-9_.-]{1,160}$' then raise exception 'Invalid section parent.';end if;
   else raise exception 'Unsupported design property.';
   end if;
  end loop;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('page-design:'||p_location_id::text||':'||p_page,0));
 prior:=public.page_design_load(p_location_id,p_page);
 if p_version is distinct from (prior->>'version')::integer then raise exception 'Page changed by another manager. Reload before saving.';end if;
 insert into public.page_designs(location_id,page,version,changes,updated_by)
 values(p_location_id,p_page,p_version+1,p_changes,auth.uid())
 on conflict(location_id,page) do update set version=excluded.version,changes=excluded.changes,updated_by=excluded.updated_by,updated_at=now();
 result:=public.page_design_load(p_location_id,p_page);
 insert into public.page_design_audit(location_id,page,changed_by,before_design,after_design)
 values(p_location_id,p_page,auth.uid(),prior,result);
 return result;
end;$$;
create or replace function public.page_design_public(p_key uuid,p_kind text,p_page text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare location uuid;
begin
 if p_kind='walk-in' and p_page='/walk-in/:key' then
  select s.location_id into location from public.walkin_settings s join public.locations l on l.id=s.location_id where s.public_key=p_key and s.enabled and l.is_active;
 elsif p_kind='guest-feedback' and p_page='/guest-feedback/:key' then
  select s.location_id into location from public.guest_feedback_settings s join public.locations l on l.id=s.location_id where s.public_key=p_key and s.enabled and l.is_active;
 end if;
 return coalesce((select jsonb_build_object('version',version,'changes',changes)
 from public.page_designs where location_id=location and page=p_page),jsonb_build_object('version',0,'changes','{}'::jsonb));
end;$$;
revoke all on function public.page_design_load(uuid,text),public.page_design_save(uuid,text,integer,jsonb),public.page_design_public(uuid,text,text) from public,anon,authenticated;
grant execute on function public.page_design_load(uuid,text),public.page_design_save(uuid,text,integer,jsonb) to authenticated;
grant execute on function public.page_design_public(uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
