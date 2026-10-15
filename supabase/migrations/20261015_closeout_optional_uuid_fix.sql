begin;
do $repair$
declare
 definition text;
 anchor text := 'if auth.uid() is null or jsonb_typeof(p_payload) is distinct from ''object'' or p_request_id is null then';
 normalization text := $normalize$
 -- blank-optional-closeout-ids-v1
 p_payload := p_payload
  || case when jsonb_typeof(p_payload->'money_turned_in_to')='string'
       and (p_payload->>'money_turned_in_to') ~ '^[[:space:]]*$'
     then '{"money_turned_in_to":null}'::jsonb else '{}'::jsonb end
  || case when jsonb_typeof(p_payload->'drinks_made_by')='string'
       and (p_payload->>'drinks_made_by') ~ '^[[:space:]]*$'
     then '{"drinks_made_by":null}'::jsonb else '{}'::jsonb end;
 $normalize$;
begin
 if to_regprocedure('public.closeout_submit_with_tables(jsonb,uuid[],uuid,uuid)') is null then
  raise exception 'The closeout submission function is missing. No changes made.';
 end if;
 definition := pg_get_functiondef('public.closeout_submit_with_tables(jsonb,uuid[],uuid,uuid)'::regprocedure);
 if strpos(definition,'blank-optional-closeout-ids-v1')>0 then return;end if;
 if strpos(definition,anchor)=0 then
  raise exception 'The closeout submission function differs from the supported version. No changes made.';
 end if;
 execute replace(definition,anchor,normalization||anchor);
end;
$repair$;
notify pgrst,'reload schema';
commit;
