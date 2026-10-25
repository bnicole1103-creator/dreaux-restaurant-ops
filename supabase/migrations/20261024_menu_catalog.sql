begin;
do $$ begin
 if to_regprocedure('public.training_content_assert(uuid,text,boolean)') is null or to_regclass('public.preshift_preset_chunks') is null then raise exception 'Install the existing training library and reusable pre-shift notes first.';end if;
end $$;
create schema if not exists menu_catalog_private;
revoke all on schema menu_catalog_private from public,anon,authenticated;
create table if not exists public.restaurant_menu_profiles(location_id uuid primary key references public.locations(id),data jsonb not null,version integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id));
create table if not exists public.restaurant_menu_items(id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),source_key text,data jsonb not null,photo text not null default '',archived boolean not null default false,version integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),unique(location_id,source_key));
alter table public.restaurant_menu_profiles enable row level security;
alter table public.restaurant_menu_items enable row level security;
revoke all on public.restaurant_menu_profiles,public.restaurant_menu_items from public,anon,authenticated;
create or replace function menu_catalog_private.valid_item(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare x jsonb;begin
 if p is null or jsonb_typeof(p) is distinct from 'object' or pg_column_size(p)>25000 or (p-array['name','description','category','service','notes','prices','available','recommend','source_file'])<>'{}'::jsonb then return false;end if;
 if jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 160 or jsonb_typeof(p->'description') is distinct from 'string' or length(btrim(p->>'description')) not between 1 and 12000 or jsonb_typeof(p->'category') is distinct from 'string' or length(btrim(p->>'category')) not between 1 and 100 or coalesce(p->>'service','') not in ('regular','brunch','happy_hour','catering','special') or jsonb_typeof(p->'notes') is distinct from 'string' or length(p->>'notes')>4000 or jsonb_typeof(p->'available') is distinct from 'boolean' or jsonb_typeof(p->'recommend') is distinct from 'boolean' or jsonb_typeof(p->'source_file') is distinct from 'string' or length(p->>'source_file')>255 or jsonb_typeof(p->'prices') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p->'prices') not between 1 and 12 then return false;end if;
 for x in select value from jsonb_array_elements(p->'prices') loop
  if jsonb_typeof(x) is distinct from 'object' or (x-array['label','cents','unit','minimum'])<>'{}'::jsonb or jsonb_typeof(x->'label') is distinct from 'string' or length(btrim(x->>'label')) not between 1 and 100 or jsonb_typeof(x->'unit') is distinct from 'string' or length(btrim(x->>'unit')) not between 1 and 50 or coalesce(x->>'minimum','') !~ '^[0-9]{1,4}$' then return false;end if;
  if (x->>'minimum')::integer not between 1 and 1000 then return false;end if;
  if jsonb_typeof(x->'cents') is distinct from 'null' and (jsonb_typeof(x->'cents') is distinct from 'number' or coalesce(x->>'cents','') !~ '^[0-9]{1,9}$') then return false;end if;
  if x->'cents' is null then return false;end if;
 end loop;
 return true;
end $$;
create or replace function public.menu_catalog_load(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare gm boolean;begin
 perform public.training_content_assert(p_location_id,'menu',false);gm:=public.closeout_is_gm(p_location_id) is true;
 return jsonb_build_object('can_edit',gm,'profile',(select to_jsonb(p) from public.restaurant_menu_profiles p where location_id=p_location_id),'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'data',data,'version',version,'archived',archived,'has_photo',photo<>'') order by data->>'service',data->>'category',data->>'name',id) from public.restaurant_menu_items where location_id=p_location_id and (not archived or gm)),'[]'::jsonb));
end $$;
create or replace function public.menu_catalog_get(p_location_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row public.restaurant_menu_items;begin
 perform public.training_content_assert(p_location_id,'menu',false);select * into row from public.restaurant_menu_items where id=p_id and location_id=p_location_id and (not archived or public.closeout_is_gm(p_location_id) is true);if not found then raise exception 'Menu item unavailable.';end if;
 return to_jsonb(row);
end $$;
create or replace function public.menu_catalog_photo(p_location_id uuid,p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare result text;begin
 perform public.training_content_assert(p_location_id,'menu',false);select photo into result from public.restaurant_menu_items where id=p_id and location_id=p_location_id and (not archived or public.closeout_is_gm(p_location_id) is true);if not found then raise exception 'Menu photo unavailable.';end if;return result;
end $$;
create or replace function public.menu_catalog_save(p_location_id uuid,p_id uuid,p_version integer,p_data jsonb,p_photo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.restaurant_menu_items;begin
 perform public.training_content_assert(p_location_id,'menu',true);
 if not menu_catalog_private.valid_item(p_data) then raise exception 'Enter a name, description, category, valid prices and menu settings.';end if;
 if p_photo is null or length(p_photo)>800000 or (p_photo<>'' and p_photo!~'^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$') then raise exception 'Choose a valid prepared photo.';end if;
 if p_id is null then
  if p_version is not null then raise exception 'A new item cannot have a prior version.';end if;
  insert into public.restaurant_menu_items(location_id,data,photo,updated_by) values(p_location_id,p_data,p_photo,auth.uid()) returning * into row;
 else
  update public.restaurant_menu_items set data=p_data,photo=p_photo,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id and location_id=p_location_id and version=p_version returning * into row;
  if not found then raise exception 'This menu item changed. Close the draft, reload the menu, and reopen the latest item.';end if;
 end if;
 return to_jsonb(row)-'photo';
end $$;
create or replace function public.menu_catalog_archive(p_location_id uuid,p_id uuid,p_version integer,p_archived boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform public.training_content_assert(p_location_id,'menu',true);if p_archived is null then raise exception 'Choose archive or restore.';end if;
 update public.restaurant_menu_items set archived=p_archived,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id and location_id=p_location_id and version=p_version;
 if not found then raise exception 'This menu item changed. Reload the menu before archiving or restoring.';end if;return true;
end $$;
create or replace function public.menu_catalog_profile_save(p_location_id uuid,p_version integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.restaurant_menu_profiles;begin
 perform public.training_content_assert(p_location_id,'menu',true);
 if p_data is null or jsonb_typeof(p_data) is distinct from 'object' or (p_data-array['title','description','notes'])<>'{}'::jsonb or jsonb_typeof(p_data->'title') is distinct from 'string' or length(btrim(p_data->>'title')) not between 1 and 160 or jsonb_typeof(p_data->'description') is distinct from 'string' or length(p_data->>'description')>12000 or jsonb_typeof(p_data->'notes') is distinct from 'string' or length(p_data->>'notes')>12000 then raise exception 'Enter a title and restaurant description of up to 12,000 characters.';end if;
 if p_version is null then insert into public.restaurant_menu_profiles(location_id,data,updated_by) values(p_location_id,p_data,auth.uid()) returning * into row;
 else update public.restaurant_menu_profiles set data=p_data,version=version+1,updated_at=now(),updated_by=auth.uid() where location_id=p_location_id and version=p_version returning * into row;if not found then raise exception 'Restaurant details changed. Reload before saving.';end if;end if;return to_jsonb(row);
end $$;
-- Home planning exposes only published menu prices to existing active location members.
-- It does not grant access to restricted training documents or other employees' goals.
create or replace function public.menu_sales_items(p_location_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',data->>'name','category',data->>'category','service',data->>'service','prices',data->'prices') order by data->>'name',id) from public.restaurant_menu_items where location_id=p_location_id and not archived and (data->>'available')::boolean and (data->>'recommend')::boolean),'[]'::jsonb);
end $$;
revoke all on all functions in schema menu_catalog_private from public,anon,authenticated;
revoke all on function public.menu_catalog_load(uuid),public.menu_catalog_get(uuid,uuid),public.menu_catalog_photo(uuid,uuid),public.menu_catalog_save(uuid,uuid,integer,jsonb,text),public.menu_catalog_archive(uuid,uuid,integer,boolean),public.menu_catalog_profile_save(uuid,integer,jsonb),public.menu_sales_items(uuid) from public,anon,authenticated;
grant execute on function public.menu_catalog_load(uuid),public.menu_catalog_get(uuid,uuid),public.menu_catalog_photo(uuid,uuid),public.menu_catalog_save(uuid,uuid,integer,jsonb,text),public.menu_catalog_archive(uuid,uuid,integer,boolean),public.menu_catalog_profile_save(uuid,integer,jsonb),public.menu_sales_items(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
