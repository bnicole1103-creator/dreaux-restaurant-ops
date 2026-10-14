begin;

-- Extend only template choices; retain current fonts, validation and permissions.
do $$
declare
  target regprocedure;
  definition text;
  updated text;
begin
  target := to_regprocedure('public.calendar_style_valid(jsonb)');
  if target is null then
    raise exception 'Install the existing poster calendar SQL first.';
  end if;
  definition := pg_get_functiondef(target);
  if strpos(definition, '''minimal''') > 0
     and strpos(definition, '''ledger''') > 0
     and strpos(definition, '''scrapbook''') > 0
     and strpos(definition, '''spotlight''') > 0 then
    return;
  end if;
  updated := regexp_replace(
    definition,
    '''poster''\s*,\s*''editorial''\s*,\s*''playful''',
    '''poster'',''editorial'',''playful'',''minimal'',''ledger'',''scrapbook'',''spotlight'''
  );
  if updated = definition then
    raise exception 'Calendar validation changed. No changes applied; share the current function definition.';
  end if;
  execute updated;
end;
$$;

notify pgrst, 'reload schema';
commit;
