begin;

-- Extend the live validator while keeping its GM authorization,
-- location checks, version conflict checks, and audit writes.
do $migration$
declare
 definition text;
 anchor text := 'elsif property.key=''hidden'' then';
 addition text := $branch$elsif property.key in ('color','background','borderColor') then
    if jsonb_typeof(property.value) is distinct from 'string'
     or (property.value#>>'{}') !~ '^#[0-9A-Fa-f]{6}$'
    then raise exception 'Choose a six-digit hex color.';end if;
   elsif property.key='fontSize' then
    if jsonb_typeof(property.value) is distinct from 'number'
     or (property.value#>>'{}') !~ '^[0-9]+$'
     or (property.value#>>'{}')::numeric not between 12 and 64
    then raise exception 'Text size must be 12–64 pixels.';end if;
   elsif property.key='align' then
    if jsonb_typeof(property.value) is distinct from 'string'
     or (property.value#>>'{}') not in ('left','center','right')
    then raise exception 'Choose left, center, or right alignment.';end if;
   elsif property.key='kind' then
    if entry.key !~ '^custom\.[0-9a-f-]{36}$'
     or jsonb_typeof(property.value) is distinct from 'string'
     or (property.value#>>'{}') not in ('note','link')
    then raise exception 'Choose an announcement or app shortcut.';end if;
   elsif property.key in ('title','linkLabel') then
    if entry.key !~ '^custom\.[0-9a-f-]{36}$'
     or jsonb_typeof(property.value) is distinct from 'string'
     or length(property.value#>>'{}')>120
    then raise exception 'Custom headings and link labels must be 120 characters or fewer.';end if;
   elsif property.key='href' then
    if entry.key !~ '^custom\.[0-9a-f-]{36}$'
     or jsonb_typeof(property.value) is distinct from 'string'
     or length(property.value#>>'{}')>200
     or (property.value#>>'{}') !~ '^/[A-Za-z0-9/_?=&%.-]*$'
     or left(property.value#>>'{}',2)='//'
    then raise exception 'Choose a page inside this app for the shortcut.';end if;
   elsif property.key='hidden' then$branch$;
 font_branch text := $font$elsif property.key='font' then
    if jsonb_typeof(property.value) is distinct from 'string'
     or (property.value#>>'{}') not in (
      'system','serif','rounded','mono','script',
      'editorial','condensed','friendly','modern',
      'allura','greatvibes','parisienne','sacramento','dancing'
     ) then raise exception 'Invalid font choice.';end if;
   elsif property.key='hidden' then$font$;
begin
 if to_regprocedure('public.page_design_save(uuid,text,integer,jsonb)') is null then
  raise exception 'Install the existing screen editor before this update.';
 end if;
 definition:=pg_get_functiondef(
  'public.page_design_save(uuid,text,integer,jsonb)'::regprocedure
 );
 if position('page-home-editor-v1' in definition)=0 then
  if (length(definition)-length(replace(definition,anchor,'')))
    /length(anchor)<>1 then
   raise exception 'The screen editor validator has changed. No changes applied; share its current definition for a merge.';
  end if;
  if position('property.key=''font''' in definition)=0 then
   definition:=replace(definition,anchor,font_branch);
  end if;
  definition:=replace(
   definition,anchor,
   '-- page-home-editor-v1'||chr(10)||'   '||addition
  );
  execute definition;
 end if;
end;
$migration$;


-- Add panel presentation without replacing authorization or audit logic.
do $panels$
declare
 definition text;
 anchor text := 'elsif property.key=''hidden'' then';
 addition text := $branch$elsif property.key='presentation' then
    if jsonb_typeof(property.value) is distinct from 'string'
     or (property.value#>>'{}') not in ('inline','collapse','popup')
    then raise exception 'Choose a regular section, collapsible panel, or popup.';end if;
   elsif property.key='panelTitle' then
    if jsonb_typeof(property.value) is distinct from 'string'
     or length(property.value#>>'{}')>120
    then raise exception 'Panel wording must be 120 characters or fewer.';end if;
   elsif property.key='defaultOpen' then
    if jsonb_typeof(property.value) is distinct from 'boolean'
    then raise exception 'Invalid panel starting state.';end if;
   elsif property.key='hidden' then$branch$;
begin
 definition:=pg_get_functiondef(
  'public.page_design_save(uuid,text,integer,jsonb)'::regprocedure
 );
 if position('all-page-panels-v1' in definition)=0 then
  if (length(definition)-length(replace(definition,anchor,'')))
    /length(anchor)<>1 then
   raise exception 'The screen editor validator has changed. No changes applied; share its current definition for a merge.';
  end if;
  definition:=replace(definition,anchor,
   '-- all-page-panels-v1'||chr(10)||'   '||addition);
  execute definition;
 end if;
end;
$panels$;

notify pgrst,'reload schema';
commit;
