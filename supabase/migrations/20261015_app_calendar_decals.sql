begin;

-- Keep the existing validators and extend only their decoration settings.
do $$
begin
 if to_regprocedure('public.app_theme_tokens_before_decals(jsonb)') is null then
  alter function public.app_theme_tokens_valid(jsonb)
   rename to app_theme_tokens_before_decals;
 end if;
 if to_regprocedure('public.calendar_style_before_decals(jsonb)') is null then
  alter function public.calendar_style_valid(jsonb)
   rename to calendar_style_before_decals;
 end if;
end;
$$;

create or replace function public.app_decals_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' then return false; end if;
 if p ? 'decal' then
  if jsonb_typeof(p->'decal') is distinct from 'string'
   or coalesce(p->>'decal','') not in (
    'theme','none','magnolia','orchid','olive','vine','butterflies',
    'ribbon','lace','fan','diamonds','laurel','fleurs','beads',
    'martini','champagne','candle','citrus','palm','sunburst',
    'moonstars','constellation','football','tennis','pine',
    'snow','pumpkin','holly','heart','rose'
   ) then return false; end if;
 end if;
 if p ? 'decalPlacement' then
  if jsonb_typeof(p->'decalPlacement') is distinct from 'string'
   or coalesce(p->>'decalPlacement','') not in (
    'corners','garland','center','off'
   ) then return false; end if;
 end if;
 if p ? 'decalSize' then
  if jsonb_typeof(p->'decalSize') is distinct from 'number'
   then return false; end if;
  if (p->>'decalSize')::numeric not between 24 and 160
   or (p->>'decalSize')::numeric <> trunc((p->>'decalSize')::numeric)
   then return false; end if;
 end if;
 if p ? 'decalOpacity' then
  if jsonb_typeof(p->'decalOpacity') is distinct from 'number'
   then return false; end if;
  if (p->>'decalOpacity')::numeric not between 0.05 and 1
   then return false; end if;
 end if;
 return true;
end;
$$;

create or replace function public.app_theme_tokens_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if public.app_decals_valid(p) is not true then return false; end if;
 return public.app_theme_tokens_before_decals(
  p - array['decal','decalPlacement','decalSize','decalOpacity']
 );
end;
$$;

create or replace function public.calendar_style_valid(p_style jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if public.app_decals_valid(p_style) is not true then return false; end if;
 return public.calendar_style_before_decals(
  p_style - array['decal','decalPlacement','decalSize','decalOpacity']
 );
end;
$$;

revoke all on function
 public.app_theme_tokens_before_decals(jsonb),
 public.calendar_style_before_decals(jsonb),
 public.app_decals_valid(jsonb),
 public.app_theme_tokens_valid(jsonb),
 public.calendar_style_valid(jsonb)
from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
