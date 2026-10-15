begin;
create or replace function public.calendar_style_valid(p_style jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if jsonb_typeof(p_style) is distinct from 'object' then return false; end if;
 for k in select jsonb_object_keys(p_style) loop
  if k not in ('color','font','template','outline','paper') then return false; end if;
 end loop;
 if coalesce(p_style->>'color','') !~ '^#[0-9a-fA-F]{6}$'
 or coalesce(p_style->>'font','') not in (
 'system','serif','rounded','mono','script','editorial','condensed','friendly','modern',
 'allura','greatvibes','parisienne','sacramento','dancing') then return false; end if;
 if p_style ? 'paper' and coalesce(p_style->>'paper','') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
 if p_style ? 'template' and coalesce(p_style->>'template','') not in (
 'poster','editorial','playful','minimal','ledger','scrapbook','spotlight',
 'deco','polaroid','blocks','planner',
 'floral','botanical','gameday','courtside','coquette','disco',
 'spring','summer','autumn','winter','halloween','christmas','valentine','mardigras') then return false; end if;
 if p_style ? 'outline' and coalesce(p_style->>'outline','') not in ('thin','double','dashed','none') then return false; end if;
 return true;
end; $$;
notify pgrst,'reload schema';
commit;
