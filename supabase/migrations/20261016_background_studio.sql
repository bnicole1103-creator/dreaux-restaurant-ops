begin;
do $$ begin
 if to_regprocedure('public.app_decals_before_backgrounds(jsonb)') is null then
  alter function public.app_decals_valid(jsonb) rename to app_decals_before_backgrounds;
 end if;
 if to_regprocedure('public.app_tokens_before_backgrounds(jsonb)') is null then
  alter function public.app_theme_tokens_valid(jsonb) rename to app_tokens_before_backgrounds;
 end if;
 if to_regprocedure('public.calendar_before_backgrounds(jsonb)') is null then
  alter function public.calendar_style_valid(jsonb) rename to calendar_before_backgrounds;
 end if;
end $$;
create or replace function public.app_decals_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if p->>'decal' in ('coupe','shaker','whiskey','disco-ball','headphones','vinyl','lipstick','heels','handbag','bowtie','golf','basketball-line','dumbbell','oyster','crawfish','monstera','shell','maple','ornament','sparkle-line') then
  return public.app_decals_before_backgrounds(jsonb_set(p,'{decal}','"none"'::jsonb));
 end if;
 return public.app_decals_before_backgrounds(p);
end $$;
create or replace function public.app_background_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; n numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 if p ? 'backgroundPattern' then
  if jsonb_typeof(p->'backgroundPattern') is distinct from 'string' or
   p->>'backgroundPattern' not in ('none','scatter','grid','diagonal','pinstripe','dots','checker','scallop') then return false;end if;
 end if;
 if p ? 'backgroundDecal' then
  if jsonb_typeof(p->'backgroundDecal') is distinct from 'string' or
   public.app_decals_valid(jsonb_build_object('decal',p->'backgroundDecal')) is not true then return false;end if;
 end if;
 if p ? 'backgroundColor' then
  if jsonb_typeof(p->'backgroundColor') is distinct from 'string' or
   p->>'backgroundColor' !~ '^#[0-9a-fA-F]{6}$' then return false;end if;
 end if;
 foreach k in array array['backgroundOpacity','backgroundScale','backgroundRotation'] loop
  if p ? k then
   if jsonb_typeof(p->k) is distinct from 'number' then return false;end if;
   n:=(p->>k)::numeric;
   if k='backgroundOpacity' and n not between 0 and 1 then return false;end if;
   if k='backgroundScale' and (n not between 80 and 360 or n<>trunc(n)) then return false;end if;
   if k='backgroundRotation' and (n not between -45 and 45 or n<>trunc(n)) then return false;end if;
  end if;
 end loop;
 return true;
end $$;
create or replace function public.app_theme_tokens_valid(p jsonb)
returns boolean language sql immutable set search_path='' as $$
 select public.app_background_valid(p) and public.app_tokens_before_backgrounds(
  p-array['backgroundPattern','backgroundDecal','backgroundColor','backgroundOpacity','backgroundScale','backgroundRotation']
 );
$$;
create or replace function public.calendar_style_valid(p_style jsonb)
returns boolean language sql immutable set search_path='' as $$
 select public.app_background_valid(p_style) and public.calendar_before_backgrounds(
  p_style-array['backgroundPattern','backgroundDecal','backgroundColor','backgroundOpacity','backgroundScale','backgroundRotation']
 );
$$;
revoke all on function public.app_decals_before_backgrounds(jsonb),public.app_tokens_before_backgrounds(jsonb),public.calendar_before_backgrounds(jsonb),public.app_background_valid(jsonb),public.app_decals_valid(jsonb),public.app_theme_tokens_valid(jsonb),public.calendar_style_valid(jsonb) from public,anon,authenticated;
do $$ begin
 if to_regprocedure('public.personal_before_backgrounds(jsonb)') is null then
  alter function public.personal_space_valid(jsonb) rename to personal_before_backgrounds;
 end if;
 if to_regprocedure('public.chat_before_backgrounds(jsonb)') is null then
  alter function public.crew_chat_style_valid(jsonb) rename to chat_before_backgrounds;
 end if;
end $$;
create or replace function public.app_wallpaper_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('backgroundPattern','backgroundDecal','backgroundColor','backgroundOpacity','backgroundScale','backgroundRotation')) then return false;end if;
 return public.app_background_valid(p);
end $$;
create or replace function public.personal_space_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' then return false;end if;
 if p ? 'background' and public.app_wallpaper_valid(p->'background') is not true then return false;end if;
 return public.personal_before_backgrounds(p-'background');
end $$;
create or replace function public.crew_chat_style_valid(p_style jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if jsonb_typeof(p_style) is distinct from 'object' then return false;end if;
 foreach k in array array['profile_background','chat_background'] loop
  if p_style ? k and public.app_wallpaper_valid(p_style->k) is not true then return false;end if;
 end loop;
 return public.chat_before_backgrounds(p_style-array['profile_background','chat_background']);
end $$;
revoke all on function public.personal_before_backgrounds(jsonb),public.chat_before_backgrounds(jsonb),public.app_wallpaper_valid(jsonb),public.personal_space_valid(jsonb),public.crew_chat_style_valid(jsonb) from public,anon,authenticated;

-- Rebind table checks to the expanded validators after renaming the originals.
do $$ declare r record; definition text; begin
 for r in select c.conname,c.conrelid,pg_get_constraintdef(c.oid) as definition
  from pg_constraint c where c.contype='c'
   and c.conrelid in ('public.personal_spaces'::regclass,'public.crew_chat_styles'::regclass)
   and pg_get_constraintdef(c.oid) ~ '(personal_before_backgrounds|chat_before_backgrounds)'
 loop
  definition:=replace(replace(r.definition,'personal_before_backgrounds','personal_space_valid'),'chat_before_backgrounds','crew_chat_style_valid');
  execute format('alter table %s drop constraint %I',r.conrelid::regclass,r.conname);
  execute format('alter table %s add constraint %I %s',r.conrelid::regclass,r.conname,definition);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
