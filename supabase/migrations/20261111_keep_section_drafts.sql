begin;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.preshift_post_save_sections(uuid,uuid,integer,text,text,date,boolean,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if position('section-keep-draft-v1' in definition)=0 then
  needle:='  if original->>''kind''=''plan'' then';
  if position(needle in definition)=0 then raise exception 'Section publication source changed. No changes made; export its current definition.';end if;
  definition:=replace(definition,needle,'  -- section-keep-draft-v1: preserve unpublished source drafts without publishing or editing them.
  if original->>''kind''=''plan'' and original->>''published_at'' is null and coalesce((r->>''keep_draft'')::boolean,false) then continue;end if;
'||needle);
  execute definition;
 end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
