begin;

-- Extend the existing screen-editor save function without replacing its
-- authorization, version checks, validation or audit handling.
do $migration$
declare
 definition text;
 anchor text:='elsif property.key=''hidden'' then';
 addition text:=$branch$elsif property.key='font' then
    if jsonb_typeof(property.value) is distinct from 'string'
    or (property.value#>>'{}') not in (
     'system','serif','rounded','mono','script',
     'editorial','condensed','friendly','modern',
     'allura','greatvibes','parisienne','sacramento','dancing'
    ) then raise exception 'Invalid font choice.';end if;
   elsif property.key='hidden' then$branch$;
begin
 if to_regprocedure('public.page_design_save(uuid,text,integer,jsonb)') is null then
  raise exception 'The screen editor must be installed before this update.';
 end if;
 definition:=pg_get_functiondef(
  'public.page_design_save(uuid,text,integer,jsonb)'::regprocedure
 );
 if position('property.key=''font''' in definition)=0 then
  if (length(definition)-length(replace(definition,anchor,'')))
     /length(anchor)<>1 then
   raise exception 'The screen editor validator differs. No changes were applied.';
  end if;
  execute replace(definition,anchor,addition);
 end if;
end;
$migration$;

notify pgrst,'reload schema';
commit;
