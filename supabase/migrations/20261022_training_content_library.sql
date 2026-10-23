begin;
-- Extend the installed training workspace without replacing existing recipe APIs.
do $upgrade$
declare target regprocedure; definition text;
begin
 if to_regprocedure('public.training_guide_create_text(uuid,text,text,text,jsonb)') is null
 or to_regprocedure('public.app_access_assert(uuid,text,text)') is null then
  raise exception 'Install the existing page permissions and pasted study guide SQL first.';
 end if;
 alter table public.training_study_guides drop constraint if exists training_study_guides_kind_check;
 alter table public.training_study_guides add constraint training_study_guides_kind_check check(kind in ('cocktails','food','service'));
 foreach target in array array[
  'public.training_guides_load(uuid,text)'::regprocedure,
  'public.training_guide_create_text(uuid,text,text,text,jsonb)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  definition:=replace(definition,'''cocktails'',''food'')','''cocktails'',''food'',''service'')');
  if strpos(definition,'''service''')=0 then raise exception 'Cannot extend training function %. No changes applied.',target;end if;
  if strpos(definition,'-- training-source-access-v1')=0 then
   definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n -- training-source-access-v1\n perform public.app_access_assert(p_location_id,''training'',''guides'');\n perform public.app_access_assert(p_location_id,''training'',case when p_kind=''cocktails'' then ''cocktails'' when p_kind=''food'' then ''food'' else ''service'' end);','i');
  end if;
  execute definition;
 end loop;
 -- Older installations created this claim after page guards were installed.
 definition:=pg_get_functiondef('public.training_guide_generation_claim(uuid)'::regprocedure);
 if strpos(definition,'-- training-source-access-v1')=0 then
  definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n -- training-source-access-v1\n perform public.app_access_assert(p_location_id,''training'',''guides'');','i');execute definition;
 end if;
end;$upgrade$;

-- Wrap the current catalog so schedule, reports and other prior additions remain.
do $catalog$
begin
 if to_regprocedure('public.app_access_catalog_before_training_library()') is null then
  alter function public.app_access_catalog() rename to app_access_catalog_before_training_library;
 end if;
end;$catalog$;
create or replace function public.app_access_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_set(c,'{training}',coalesce(c->'training','[]'::jsonb)||case when coalesce(c->'training','[]'::jsonb) ? 'service' then '[]'::jsonb else '["service"]'::jsonb end)
 from (select public.app_access_catalog_before_training_library() c) original;
$$;
revoke all on function public.app_access_catalog() from public,anon;
grant execute on function public.app_access_catalog() to authenticated;

create table if not exists public.training_content_library(
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 shelf text not null check(shelf in ('menu','service')),
 title text not null,body text not null,
 filename text not null default '',asset_data text not null default '',
 version integer not null default 1,
 created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists training_content_location_shelf on public.training_content_library(location_id,shelf);
alter table public.training_content_library enable row level security;
revoke all on public.training_content_library from public,anon,authenticated;

create or replace function public.training_content_assert(p_location_id uuid,p_shelf text,p_write boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 if p_shelf is null or p_shelf not in ('menu','service') then raise exception 'Choose menu descriptions or service guides.';end if;
 perform public.app_access_assert(p_location_id,'training',case when p_shelf='menu' then 'food' else 'service' end);
 if p_write and public.closeout_is_gm(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
end;$$;

create or replace function public.training_content_load(p_location_id uuid,p_shelf text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.training_content_assert(p_location_id,p_shelf);
 return (select coalesce(jsonb_agg(to_jsonb(d)-'asset_data' order by d.title),'[]'::jsonb) from public.training_content_library d where d.location_id=p_location_id and d.shelf=p_shelf);
end;$$;

create or replace function public.training_content_get(p_location_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.training_content_library;
begin
 select * into d from public.training_content_library where id=p_id and location_id=p_location_id;
 if not found then raise exception 'Training document unavailable.';end if;
 perform public.training_content_assert(p_location_id,d.shelf);
 return to_jsonb(d);
end;$$;

create or replace function public.training_content_save(p_location_id uuid,p_id uuid,p_version integer,p_shelf text,p_title text,p_body text,p_filename text,p_asset text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.training_content_library;
begin
 perform public.training_content_assert(p_location_id,p_shelf,true);
 if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_body is null or length(btrim(p_body))<1 or length(p_body)>12000
 or p_filename is null or length(p_filename)>255 or p_asset is null or length(p_asset)>7000000 then raise exception 'Enter a title and 1–12,000 characters of content. Attachments must be up to 5 MB.';end if;
 if p_asset<>'' and p_asset!~'^data:(application/pdf|image/(png|jpeg|webp));base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'Choose a valid PDF or image attachment.';end if;
 if p_id is null then
  insert into public.training_content_library(location_id,shelf,title,body,filename,asset_data,created_by,updated_by)
  values(p_location_id,p_shelf,btrim(p_title),p_body,p_filename,p_asset,auth.uid(),auth.uid()) returning * into d;
 else
  update public.training_content_library set title=btrim(p_title),body=p_body,filename=p_filename,asset_data=p_asset,version=version+1,updated_at=now(),updated_by=auth.uid()
  where id=p_id and location_id=p_location_id and shelf=p_shelf and version=p_version returning * into d;
  if not found then raise exception 'This document changed or is unavailable. Close this draft and reopen the latest content.';end if;
 end if;
 return to_jsonb(d);
end;$$;

create or replace function public.training_content_import_claim(p_location_id uuid,p_section text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true or public.closeout_is_gm(p_location_id) is not true then raise exception 'Management access required.' using errcode='42501';end if;
 if p_section is null or p_section not in ('food','cocktails','service') then raise exception 'Choose a training section.';end if;
 perform public.app_access_assert(p_location_id,'training',p_section);
 insert into public.training_guide_generation_limits(location_id,user_id,last_at) values(p_location_id,auth.uid(),now())
 on conflict(location_id,user_id) do update set last_at=excluded.last_at where public.training_guide_generation_limits.last_at<=now()-interval '30 seconds';
 if not found then raise exception 'Wait 30 seconds between document reading and guide generation requests.';end if;
 return true;
end;$$;
revoke all on function public.training_content_assert(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.training_content_load(uuid,text),public.training_content_get(uuid,uuid),public.training_content_save(uuid,uuid,integer,text,text,text,text,text),public.training_content_import_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.training_content_load(uuid,text),public.training_content_get(uuid,uuid),public.training_content_save(uuid,uuid,integer,text,text,text,text,text),public.training_content_import_claim(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
