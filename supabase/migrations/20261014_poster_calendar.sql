begin;
create or replace function public.calendar_style_valid(p_style jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if jsonb_typeof(p_style) is distinct from 'object' then return false;end if;
 for k in select jsonb_object_keys(p_style) loop
  if k not in ('color','font','template','outline','paper') then return false;end if;
 end loop;
 if coalesce(p_style->>'color','') !~ '^#[0-9a-fA-F]{6}$'
 or coalesce(p_style->>'font','') not in ('system','serif','rounded','mono','script','editorial','condensed','friendly','modern') then return false;end if;
 if p_style ? 'paper' and coalesce(p_style->>'paper','') !~ '^#[0-9a-fA-F]{6}$' then return false;end if;
 if p_style ? 'template' and coalesce(p_style->>'template','') not in ('poster','editorial','playful') then return false;end if;
 if p_style ? 'outline' and coalesce(p_style->>'outline','') not in ('thin','double','dashed','none') then return false;end if;
 return true;
end;$$;
-- Preserve the existing post saving, media validation, font rules and permissions.
do $$
declare target regprocedure;definition text;
begin
 target:=to_regprocedure('public.preshift_post_save_full(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb)');
 if target is null then raise exception 'Existing post composer must be installed first.';end if;
 definition:=pg_get_functiondef(target);
 if strpos(definition,'-- poster design v2')=0 then
  if strpos(definition,'return pid;')=0 then raise exception 'Post save function changed. No changes applied.';end if;
  definition:=replace(definition,'return pid;',E'-- poster design v2\n if p_presentation ? ''design'' then\n  if public.calendar_style_valid(p_presentation->''design'') is not true then raise exception ''Choose a valid post template and colors.'';end if;\n  update public.preshift_posts set presentation=presentation||jsonb_build_object(''design'',p_presentation->''design'') where id=pid;\n end if;\n return pid;');
  execute definition;
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
