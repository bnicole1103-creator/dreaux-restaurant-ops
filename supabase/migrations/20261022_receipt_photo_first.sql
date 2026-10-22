begin;
do $$
declare
 definition text;
 old_filter text := 'source.data->>''category'' not in (''Void receipt'',''Comp receipt'')';
 new_filter text := 'source.data->>''source'' is distinct from ''photo''';
 old_kind text := 'r.kind:=case when source.data->>''category''=''Void receipt'' then ''void'' else ''comp'' end;';
 new_kind text := 'r.kind:=case when source.data->>''category''=''Comp receipt'' then ''comp'' else ''void'' end;';
begin
 if to_regprocedure('public.closeout_receipt_save(uuid,uuid,integer,jsonb,text)') is null then
  raise exception 'Run the complete receipt-closeout SQL from the previous message first.';
 end if;
 definition := pg_get_functiondef('public.closeout_receipt_save(uuid,uuid,integer,jsonb,text)'::regprocedure);
 if position(new_filter in definition)=0 then
  if position(old_filter in definition)=0 then
   raise exception 'Receipt import code has changed. No changes applied.';
  end if;
  definition := replace(definition,old_filter,new_filter);
 end if;
 if position(new_kind in definition)=0 then
  if position(old_kind in definition)=0 then
   raise exception 'Receipt type code has changed. No changes applied.';
  end if;
  definition := replace(definition,old_kind,new_kind);
 end if;
 definition := replace(definition,
  'Choose a saved void or comp photo for this employee and date.',
  'Choose a saved receipt photo for this employee and date.');
 execute definition;
end;
$$;
commit;
