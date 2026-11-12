BEGIN;
SET LOCAL lock_timeout='5s';
DO $check$ BEGIN
 IF to_regprocedure('crew_ops_private.canonical(uuid,date,jsonb)') IS NULL OR to_regprocedure('crew_ops_private.apply_day(uuid,date,jsonb)') IS NULL OR to_regprocedure('staff_ops_private.apply_controls(uuid,date)') IS NULL OR to_regprocedure('public.staff_tasks_assign(uuid,uuid,integer,date,text,uuid[],uuid)') IS NULL OR to_regprocedure('public.disposal_requirement_assign(uuid,date,uuid,boolean)') IS NULL THEN RAISE EXCEPTION 'Existing shared schedule, task and disposal tools are required. No changes applied.';END IF;
END $check$;
CREATE SCHEMA IF NOT EXISTS roster_work_private;
REVOKE ALL ON SCHEMA roster_work_private FROM PUBLIC,anon,authenticated;
DO $keep$ BEGIN
 IF to_regprocedure('roster_work_private.canonical_before(uuid,date,jsonb)') IS NULL THEN
 ALTER FUNCTION crew_ops_private.canonical(uuid,date,jsonb) SET SCHEMA roster_work_private;
 ALTER FUNCTION roster_work_private.canonical(uuid,date,jsonb) RENAME TO canonical_before;
 ALTER FUNCTION crew_ops_private.apply_day(uuid,date,jsonb) SET SCHEMA roster_work_private;
 ALTER FUNCTION roster_work_private.apply_day(uuid,date,jsonb) RENAME TO apply_day_before;
 ALTER FUNCTION staff_ops_private.apply_controls(uuid,date) SET SCHEMA roster_work_private;
 ALTER FUNCTION roster_work_private.apply_controls(uuid,date) RENAME TO controls_before;
 ALTER FUNCTION public.crew_schedule_tools_load(uuid,date) SET SCHEMA roster_work_private;
 ALTER FUNCTION roster_work_private.crew_schedule_tools_load(uuid,date) RENAME TO load_before;
 ALTER FUNCTION staff_ops_private.recurring_match(uuid,uuid,text,date) SET SCHEMA roster_work_private;
 ALTER FUNCTION roster_work_private.recurring_match(uuid,uuid,text,date) RENAME TO recurring_before;
 END IF;
END $keep$;
CREATE OR REPLACE FUNCTION roster_work_private.has_tasks(l uuid,d date,u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_task_runs r JOIN public.staff_task_assignees a ON a.run_id=r.id WHERE r.location_id=l AND r.business_date=d AND r.cancelled_at IS NULL AND a.user_id=u AND a.active);
$$;
CREATE OR REPLACE FUNCTION crew_ops_private.canonical(p_location uuid,p_day date,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;key text;input_row jsonb;
BEGIN
 FOR input_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
 FOREACH key IN ARRAY ARRAY['requires_quiz','requires_disposal','requires_tasks'] LOOP
 IF input_row ? key AND jsonb_typeof(input_row->key) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Work requirement choices must be checked or unchecked.';END IF;
 END LOOP;END LOOP;
 result:=roster_work_private.canonical_before(p_location,p_day,p_rows);
 RETURN (SELECT coalesce(jsonb_agg(c||jsonb_build_object(
 'requires_quiz',coalesce((r->>'requires_quiz')::boolean,(SELECT bool_or(s.requires_quiz) FROM public.staff_scheduled_shifts s WHERE s.location_id=p_location AND s.business_date=p_day AND s.user_id=(c->>'user_id')::uuid),true),
 'requires_disposal',coalesce((r->>'requires_disposal')::boolean,EXISTS(SELECT 1 FROM public.disposal_requirements a WHERE a.location_id=p_location AND a.business_date=p_day AND a.user_id=(c->>'user_id')::uuid AND a.active)),
 'requires_tasks',coalesce((r->>'requires_tasks')::boolean,roster_work_private.has_tasks(p_location,p_day,(c->>'user_id')::uuid)),
 'task_template_id',nullif(r->>'task_template_id',''),'task_template_version',nullif(r->>'task_template_version','')::integer
 ) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(result) WITH ORDINALITY x(c,ord) JOIN jsonb_array_elements(p_rows) y(r) ON r->>'id'=c->>'id');
END $$;
CREATE OR REPLACE FUNCTION staff_ops_private.recurring_match(l uuid,u uuid,k text,d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN k LIKE 'task:%' AND EXISTS(SELECT 1 FROM public.crew_schedule_overrides c CROSS JOIN LATERAL jsonb_array_elements(c.rows) r WHERE c.location_id=l AND c.business_date=d AND r->>'user_id'=u::text AND r ? 'requires_tasks') AND NOT EXISTS(SELECT 1 FROM public.crew_schedule_overrides c CROSS JOIN LATERAL jsonb_array_elements(c.rows) r WHERE c.location_id=l AND c.business_date=d AND r->>'user_id'=u::text AND (r->>'requires_tasks')::boolean) THEN false ELSE roster_work_private.recurring_before(l,u,k,d) END;
$$;
CREATE OR REPLACE FUNCTION staff_ops_private.apply_controls(l uuid,d date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF d<((now() AT TIME ZONE 'America/Chicago')-interval '4 hours')::date OR now()>=staff_ops_private.cutoff(d) THEN RETURN;END IF;
 PERFORM roster_work_private.controls_before(l,d);
 UPDATE public.staff_scheduled_shifts s SET requires_quiz=coalesce((r->>'requires_quiz')::boolean,s.requires_quiz),requires_closeout=coalesce((r->>'requires_closeout')::boolean,s.requires_closeout)
 FROM public.crew_schedule_overrides c CROSS JOIN LATERAL jsonb_array_elements(c.rows) r
 WHERE c.location_id=l AND c.business_date=d AND s.location_id=l AND s.business_date=d AND s.shift_key=r->>'id' AND r ? 'requires_quiz';
 PERFORM staff_ops_private.sync_quizzes(l,d);
END $$;
CREATE OR REPLACE FUNCTION crew_ops_private.apply_day(p_location uuid,p_day date,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person record;item jsonb;template public.staff_task_templates%rowtype;wanted boolean;
BEGIN
 PERFORM roster_work_private.apply_day_before(p_location,p_day,p_rows);
 PERFORM staff_ops_private.apply_controls(p_location,p_day);
 FOR person IN SELECT (r->>'user_id')::uuid uid,bool_or((r->>'requires_disposal')::boolean) disposal,bool_or((r->>'requires_tasks')::boolean) tasks FROM jsonb_array_elements(p_rows) r GROUP BY r->>'user_id' LOOP
  IF person.disposal IS NOT NULL THEN PERFORM public.disposal_requirement_assign(p_location,p_day,person.uid,person.disposal);END IF;
  IF person.tasks IS FALSE THEN
   UPDATE public.staff_task_assignees a SET active=false,version=version+1 FROM public.staff_task_runs t
   WHERE a.run_id=t.id AND t.location_id=p_location AND t.business_date=p_day AND t.cancelled_at IS NULL AND a.user_id=person.uid AND a.active
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.items) WITH ORDINALITY x(item,n) WHERE NOT EXISTS(SELECT 1 FROM public.staff_task_checks c WHERE c.run_id=t.id AND c.user_id=a.user_id AND c.item_index=x.n-1));
  ELSIF person.tasks IS TRUE AND NOT roster_work_private.has_tasks(p_location,p_day,person.uid) THEN
   SELECT r INTO item FROM jsonb_array_elements(p_rows) r WHERE r->>'user_id'=person.uid::text AND nullif(r->>'task_template_id','') IS NOT NULL LIMIT 1;
   IF item IS NULL THEN RAISE EXCEPTION 'Choose a reviewed task preset for each employee marked Required task list who has no assigned list.';END IF;
   SELECT * INTO template FROM public.staff_task_templates WHERE id=(item->>'task_template_id')::uuid AND location_id=p_location AND active AND reviewed FOR SHARE;
   IF template.id IS NULL OR template.version IS DISTINCT FROM (item->>'task_template_version')::integer THEN RAISE EXCEPTION 'The task preset changed. Reload and review it before confirming.';END IF;
   PERFORM public.staff_tasks_assign(p_location,template.id,template.version,p_day,'Roster confirmation',ARRAY[person.uid],gen_random_uuid());
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.crew_schedule_tools_load(p_location_id uuid,p_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;rows jsonb;
BEGIN
 result:=roster_work_private.load_before(p_location_id,p_day);
 SELECT coalesce(jsonb_agg(r||jsonb_build_object(
  'requires_quiz',coalesce((r->>'requires_quiz')::boolean,(SELECT bool_or(s.requires_quiz) FROM public.staff_scheduled_shifts s WHERE s.location_id=p_location_id AND s.business_date=p_day AND s.user_id=(r->>'user_id')::uuid),true),
  'requires_disposal',coalesce((r->>'requires_disposal')::boolean,EXISTS(SELECT 1 FROM public.disposal_requirements a WHERE a.location_id=p_location_id AND a.business_date=p_day AND a.user_id=(r->>'user_id')::uuid AND a.active)),
  'requires_tasks',coalesce((r->>'requires_tasks')::boolean,roster_work_private.has_tasks(p_location_id,p_day,(r->>'user_id')::uuid)),
  'has_tasks',roster_work_private.has_tasks(p_location_id,p_day,(r->>'user_id')::uuid)
 ) ORDER BY n),'[]'::jsonb) INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY x(r,n);
 RETURN result||jsonb_build_object('rows',rows,'requirements_supported',true,'task_presets',CASE WHEN (result->>'manager')::boolean THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'version',t.version) ORDER BY t.title),'[]'::jsonb) FROM public.staff_task_templates t WHERE t.location_id=p_location_id AND t.active AND t.reviewed) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA roster_work_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION crew_ops_private.canonical(uuid,date,jsonb),crew_ops_private.apply_day(uuid,date,jsonb),staff_ops_private.apply_controls(uuid,date),staff_ops_private.recurring_match(uuid,uuid,text,date),public.crew_schedule_tools_load(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crew_schedule_tools_load(uuid,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS roster_requirements_installed,false AS production_behavior_verified;
