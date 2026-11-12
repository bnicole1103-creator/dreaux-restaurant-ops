begin;
-- Patch the installed calculations without replacing their other guards.
do $patch$
declare signature text; original text; updated text; pattern text;
begin
 pattern := $rx$coalesce\(\s*overrides->\(s->>'id'\)->>'group',\s*settings.role_groups->>lower\(btrim\(s->>'role'\)\),\s*case\s+when s->>'role' ~\* '\\mbartender\\M' then 'bar'\s+when s->>'role' ~\* '\\mserver\\M' then 'floor'\s+else 'exclude'\s+end\s*\)$rx$;
 foreach signature in array array['sales_month_private.targets_before_dining(uuid,date)','closeout_fix_private.targets_before_personal(uuid,date)'] loop
 original:=pg_get_functiondef(signature::regprocedure);
 if position('-- position-targets-v1' in original)>0 then continue;end if;
 if (select count(*) from regexp_matches(original,pattern,'g'))<>2 then
 raise exception 'Unexpected allocation definition in %. No changes applied.',signature;end if;
 updated:=regexp_replace(original,pattern,$replacement$case when s->>'role' ~* 'bartender' then 'bar' else 'floor' end$replacement$,'g');
 if position('bar_cents:=round(team_cents*settings.bar_percent/100);' in updated)=0 then raise exception 'Pool calculation changed in %.',signature;end if;
 updated:=replace(updated,'bar_cents:=round(team_cents*settings.bar_percent/100);',$replacement$
 -- position-targets-v1
 bar_cents:=case
 when not exists(select 1 from jsonb_array_elements(cache.rows) s where s->>'role' ~* 'bartender' and sales_month_private.selling_hours(p_location,p_date,s,overrides)>0) then 0
 when not exists(select 1 from jsonb_array_elements(cache.rows) s where s->>'role' !~* 'bartender' and sales_month_private.selling_hours(p_location,p_date,s,overrides)>0) then team_cents
 else round(team_cents*settings.bar_percent/100) end;
 $replacement$);
 execute updated;
 end loop;
end $patch$;
commit;
