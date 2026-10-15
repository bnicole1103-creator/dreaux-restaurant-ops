begin;
create table if not exists public.app_theme_studio(
 location_id uuid primary key references public.locations(id),
 version integer not null default 1,
 config jsonb not null,
 updated_by uuid not null,
 updated_at timestamptz not null default now()
);
alter table public.app_theme_studio enable row level security;
revoke all on public.app_theme_studio from public,anon,authenticated;

create or replace function public.app_theme_tokens_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;fonts text[]:=array['system','serif','rounded','mono','script','editorial','condensed','friendly','modern','allura','greatvibes','parisienne','sacramento','dancing'];
begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 for k,v in select key,value from jsonb_each(p) loop
  if k in ('background','card','text','muted','accent','accentText','border') then
   if jsonb_typeof(v)<>'string' or (p->>k)!~'^#[0-9a-fA-F]{6}$' then return false;end if;
  elsif k in ('font','titleFont','headingFont','labelFont','buttonFont') then
   if jsonb_typeof(v)<>'string' or not((p->>k)=any(fonts)) then return false;end if;
  elsif k in ('radius','borderWidth') then
   if jsonb_typeof(v)<>'number' then return false;end if;
   if (p->>k)::numeric<>trunc((p->>k)::numeric) or (p->>k)::numeric<0
    or (p->>k)::numeric>(case when k='radius' then 32 else 3 end) then return false;end if;
  elsif k='shadow' then
   if coalesce(p->>k,'') not in ('none','soft','lifted') then return false;end if;
  elsif k='surface' then
   if coalesce(p->>k,'') not in ('solid','tint','stripes','gradient') then return false;end if;
  elsif k='art' then
   if coalesce(p->>k,'') not in ('none','floral','botanical','gameday','courtside','coquette','disco','spring','summer','autumn','winter','halloween','christmas','valentine','mardigras','roseatelier','daisydays','wildflower','blackgold','matchpoint','clubhouse','cherryclub','pearlribbon','champagnesocial','midnightmuse','citruscoast','goldenhour','cozycabin','aprilrain','newyear','thanksgiving','easter','fourth') then return false;end if;
  else return false;
  end if;
 end loop;
 return true;
end;$$;

create or replace function public.app_theme_config_valid(p jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare k text;v jsonb;item jsonb;catalog jsonb:=public.app_access_catalog();ids text[]:=array[]::text[];
begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p))<>4 or not(p ?& array['base','pages','sections','presets']) then return false;end if;
 if p->'base'<>'null'::jsonb and public.app_theme_tokens_valid(p->'base') is not true then return false;end if;
 if jsonb_typeof(p->'pages') is distinct from 'object' or jsonb_typeof(p->'sections') is distinct from 'object' or jsonb_typeof(p->'presets') is distinct from 'array' then return false;end if;
 if (select count(*) from jsonb_object_keys(p->'sections'))>150 or jsonb_array_length(p->'presets')>30 then return false;end if;
 for k,v in select key,value from jsonb_each(p->'pages') loop
  if not(catalog ? k) or public.app_theme_tokens_valid(v) is not true then return false;end if;
 end loop;
 for k,v in select key,value from jsonb_each(p->'sections') loop
  if array_length(string_to_array(k,'.'),1)<>2 or not(catalog ? split_part(k,'.',1))
   or not((catalog->split_part(k,'.',1)) ? split_part(k,'.',2)) or split_part(k,'.',2)='*'
   or public.app_theme_tokens_valid(v) is not true then return false;end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'presets') loop
  if jsonb_typeof(item)<>'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(item))<>3 or not(item ?& array['id','name','tokens']) then return false;end if;
  if jsonb_typeof(item->'id')<>'string' or (item->>'id')!~'^[0-9a-fA-F-]{36}$'
   or (item->>'id')=any(ids) or jsonb_typeof(item->'name')<>'string'
   or length(btrim(item->>'name')) not between 1 and 80 or public.app_theme_tokens_valid(item->'tokens') is not true then return false;end if;
  ids:=array_append(ids,item->>'id');
 end loop;
 return true;
end;$$;

create or replace function public.app_theme_load(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Active location membership required.' using errcode='42501';
 end if;
 return coalesce((select jsonb_build_object('version',version,'config',config) from public.app_theme_studio where location_id=p_location_id),
  jsonb_build_object('version',0,'config','{"base":null,"pages":{},"sections":{},"presets":[]}'::jsonb));
end;$$;

create or replace function public.app_theme_save(p_location_id uuid,p_version integer,p_config jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
 if auth.uid() is null or public.closeout_is_gm(p_location_id) is not true
  or public.app_access_allowed(p_location_id,'settings','styling') is not true then
  raise exception 'Management styling access required.' using errcode='42501';
 end if;
 if p_config is null or octet_length(p_config::text)>150000 or public.app_theme_config_valid(p_config) is not true then
  raise exception 'Choose valid theme colors, fonts, page scopes and preset settings.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('app-theme:'||p_location_id::text,0));
 select version into current_version from public.app_theme_studio where location_id=p_location_id;
 if coalesce(current_version,0) is distinct from p_version then
  raise exception 'Studio changed in another session. Reload the saved Studio before saving again.' using errcode='40001';
 end if;
 insert into public.app_theme_studio(location_id,version,config,updated_by)
 values(p_location_id,p_version+1,p_config,auth.uid())
 on conflict(location_id) do update set version=excluded.version,config=excluded.config,updated_by=excluded.updated_by,updated_at=now();
 return public.app_theme_load(p_location_id);
end;$$;

revoke all on function public.app_theme_tokens_valid(jsonb),public.app_theme_config_valid(jsonb),
 public.app_theme_load(uuid),public.app_theme_save(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.app_theme_load(uuid),public.app_theme_save(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
