begin;
create table if not exists public.app_decorations (
 location_id uuid primary key references public.locations(id) on delete cascade,
 config jsonb not null default '{"enabled":false,"items":[]}'::jsonb,
 version integer not null default 1,
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.app_decorations enable row level security;
revoke all on public.app_decorations from public,anon,authenticated;
create or replace function public.app_decorations_get(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then
  raise exception 'Location access required.' using errcode='42501';end if;
 select jsonb_build_object('config',config,'version',version) into result
 from public.app_decorations where location_id=p_location_id;
 return coalesce(result,'{"config":{"enabled":false,"items":[]},"version":0}'::jsonb);
end;$$;
create or replace function public.app_decorations_save(p_location_id uuid,p_config jsonb,p_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; current_version integer; keys text[]:=array[]::text[];
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true
 or public.closeout_is_gm(p_location_id) is not true then
  raise exception 'Management access required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'settings','styling');
 if p_config is null or jsonb_typeof(p_config)<>'object' then raise exception 'Invalid decorations.';end if;
 if (p_config - array['enabled','items'])<>'{}'::jsonb
 or jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
 or jsonb_typeof(p_config->'items') is distinct from 'array' then raise exception 'Invalid decorations.';end if;
 if octet_length(p_config::text)>30000 then raise exception 'Decoration settings are too large.';end if;
 if jsonb_array_length(p_config->'items')>8 then raise exception 'Use up to 8 stickers.';end if;
 for item in select value from jsonb_array_elements(p_config->'items') loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid sticker.';end if;
  if (item-array['key','id','size','rotation','spot','page','x','y','opacity','layer'])<>'{}'::jsonb
  or jsonb_typeof(item->'key') is distinct from 'string'
  or coalesce(item->>'key','') !~ '^[A-Za-z0-9_-]{1,64}$'
  or jsonb_typeof(item->'id') is distinct from 'string'
  or coalesce(item->>'id','') not in
  ('pumpkin','ghost','bat','web','candy','maple','leaves','sunflower','pie','tree','snow','snowman','gift','bow','heart','rose','kiss','hearts','mask','crown','fleur','confetti','flower','tulip','butterfly','rainbow','sun','lemon','palm','watermelon','sparkle','cocktail','cheers','star','music','party')
  or jsonb_typeof(item->'spot') is distinct from 'string'
  or coalesce(item->>'spot','') not in ('left','banner','right','free')
  or jsonb_typeof(item->'size') is distinct from 'number'
  or jsonb_typeof(item->'rotation') is distinct from 'number' then raise exception 'Invalid sticker.';end if;
  if (item->>'size')::numeric not between 28 and 200
  or (item->>'size')::numeric<>trunc((item->>'size')::numeric)
  or (item->>'rotation')::numeric not between -30 and 30
  or (item->>'rotation')::numeric<>trunc((item->>'rotation')::numeric)
  or item->>'key'=any(keys) then raise exception 'Invalid sticker size, angle or key.';end if;
  if item ? 'page' then
   if jsonb_typeof(item->'page') is distinct from 'string' or item->>'page' not in
    ('*','/','/floor','/closeout','/preshift','/rewards','/closeout-summary','/tasks','/team','/calendar','/quizzes','/training','/inventory','/inquiry-inbox','/settings') then
    raise exception 'Choose a supported page.';end if;
  end if;
  if item ? 'layer' then
   if jsonb_typeof(item->'layer') is distinct from 'string' or item->>'layer' not in ('front','back') then
    raise exception 'Choose front or back.';end if;
  end if;
  if item ? 'x' then
   if jsonb_typeof(item->'x') is distinct from 'number' then raise exception 'Invalid horizontal position.';end if;
   if (item->>'x')::numeric not between 0 and 100 then raise exception 'Horizontal position must be 0 to 100.';end if;
  end if;
  if item ? 'y' then
   if jsonb_typeof(item->'y') is distinct from 'number' then raise exception 'Invalid vertical position.';end if;
   if (item->>'y')::numeric not between 0 and 50000 or (item->>'y')::numeric<>trunc((item->>'y')::numeric) then
    raise exception 'Vertical position must be a whole number from 0 to 50000.';end if;
  end if;
  if item ? 'opacity' then
   if jsonb_typeof(item->'opacity') is distinct from 'number' then raise exception 'Invalid opacity.';end if;
   if (item->>'opacity')::numeric not between 0 and 1 then raise exception 'Opacity must be 0 to 1.';end if;
  end if;
  keys:=array_append(keys,item->>'key');
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('app-decorations:'||p_location_id::text,0));
 select version into current_version from public.app_decorations where location_id=p_location_id;
 if p_version is distinct from coalesce(current_version,0) then
  raise exception 'Decorations changed. Reload saved decorations and try again.' using errcode='40001';end if;
 insert into public.app_decorations(location_id,config,version,updated_by,updated_at)
 values(p_location_id,p_config,coalesce(current_version,0)+1,auth.uid(),now())
 on conflict(location_id) do update set config=excluded.config,version=excluded.version,
 updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 return public.app_decorations_get(p_location_id);
end;$$;
revoke all on function public.app_decorations_get(uuid),public.app_decorations_save(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.app_decorations_get(uuid),public.app_decorations_save(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
