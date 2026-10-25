BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.staff_tasks_due_at(date,time without time zone)') IS NULL OR to_regprocedure('public.staff_tasks_day(uuid,date,boolean)') IS NULL OR to_regprocedure('public.closeout_is_member_for_tasks(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'Install the existing task workflow prerequisites first. No changes applied.';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.staff_task_runs') AND attname='due_at' AND NOT attisdropped) THEN RAISE EXCEPTION 'Task due-time schema is missing. No changes applied.';END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS task_reuse_private;
REVOKE ALL ON SCHEMA task_reuse_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS task_reuse_private.groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),location_id uuid NOT NULL REFERENCES public.locations(id),name text NOT NULL,lists jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_by uuid NOT NULL REFERENCES public.profiles(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS task_reuse_private.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,location_id uuid NOT NULL,actor uuid NOT NULL,action text NOT NULL,details jsonb NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS task_reuse_private.requests(location_id uuid NOT NULL,request_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(location_id,request_id));
ALTER TABLE task_reuse_private.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reuse_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reuse_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA task_reuse_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA task_reuse_private FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION task_reuse_private.authorize(l uuid,section_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member_for_tasks(l,auth.uid()) IS NOT TRUE OR public.staff_tasks_can_manage(l) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501'; END IF;
 PERFORM public.app_access_assert(l,'tasks',section_name);
END $$;
CREATE OR REPLACE FUNCTION task_reuse_private.validate_lists(lists jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb;t jsonb;BEGIN
 IF jsonb_typeof(lists) IS DISTINCT FROM 'array' OR pg_column_size(lists)>250000 THEN RAISE EXCEPTION 'Choose valid task lists.';END IF;
 IF jsonb_array_length(lists) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Choose 1–30 lists.';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(lists) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-ARRAY['title','position','phase','items','due'])<>'{}'::jsonb OR length(btrim(coalesce(x->>'title',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(x->>'position',''))) NOT BETWEEN 1 AND 100 OR coalesce(x->>'phase','') NOT IN ('Morning','Opening','Running','Closing','Weekly','Other') OR jsonb_typeof(x->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Enter a title, position, phase and tasks for every list.';END IF;
  IF jsonb_array_length(x->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Use 1–200 tasks per list.';END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(x->'items') LOOP IF jsonb_typeof(t) IS DISTINCT FROM 'string' OR length(btrim(t#>>'{}')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Tasks must contain 1–1000 characters.';END IF;END LOOP;
  IF x->'due' IS NOT NULL AND x->'due'<>'null'::jsonb AND (jsonb_typeof(x->'due') IS DISTINCT FROM 'string' OR (x->>'due')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'Use HH:MM or no due time.';END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.staff_tasks_management_check(p_location_id uuid,p_run_id uuid,p_user_id uuid,p_item integer,p_done boolean,p_version integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.staff_task_runs;a public.staff_task_assignees;was_done boolean;BEGIN
 PERFORM task_reuse_private.authorize(p_location_id,'team');
 SELECT * INTO r FROM public.staff_task_runs WHERE id=p_run_id AND location_id=p_location_id AND cancelled_at IS NULL FOR SHARE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Assignment unavailable.';END IF;
 SELECT * INTO a FROM public.staff_task_assignees WHERE run_id=r.id AND user_id=p_user_id AND active FOR UPDATE;
 IF a.run_id IS NULL THEN RAISE EXCEPTION 'Employee is not assigned to this list.';END IF;
 IF a.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Task progress changed. Reload before checking it off.';END IF;
 IF p_item IS NULL OR p_item<0 OR p_item>=jsonb_array_length(r.items) OR p_done IS NULL THEN RAISE EXCEPTION 'Choose a valid task.';END IF;
 SELECT EXISTS(SELECT 1 FROM public.staff_task_checks WHERE run_id=r.id AND user_id=p_user_id AND item_index=p_item) INTO was_done;
 IF was_done=p_done THEN RETURN a.version;END IF;
 IF p_done THEN INSERT INTO public.staff_task_checks(run_id,user_id,item_index) VALUES(r.id,p_user_id,p_item);ELSE DELETE FROM public.staff_task_checks WHERE run_id=r.id AND user_id=p_user_id AND item_index=p_item;END IF;
 UPDATE public.staff_task_assignees SET version=version+1 WHERE run_id=r.id AND user_id=p_user_id RETURNING version INTO p_version;
 INSERT INTO task_reuse_private.audit(location_id,actor,action,details) VALUES(p_location_id,auth.uid(),'management check',jsonb_build_object('run',r.id,'employee',p_user_id,'item',p_item,'done',p_done,'prior_done',was_done));
 RETURN p_version;
END $$;
CREATE OR REPLACE FUNCTION public.staff_tasks_saved_bundles(p_location_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM task_reuse_private.authorize(p_location_id,'assign');RETURN coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.name,g.id) FROM task_reuse_private.groups g WHERE location_id=p_location_id),'[]'::jsonb);END $$;
CREATE OR REPLACE FUNCTION public.staff_tasks_save_bundle(p_location_id uuid,p_id uuid,p_version integer,p_name text,p_lists jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g task_reuse_private.groups;BEGIN
 PERFORM task_reuse_private.authorize(p_location_id,'assign');PERFORM task_reuse_private.validate_lists(p_lists);
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Enter a group name of 1–100 characters.';END IF;
 IF p_id IS NULL THEN IF p_version IS NOT NULL THEN RAISE EXCEPTION 'New group cannot have a prior version.';END IF;INSERT INTO task_reuse_private.groups(location_id,name,lists,updated_by) VALUES(p_location_id,btrim(p_name),p_lists,auth.uid()) RETURNING * INTO g;
 ELSE UPDATE task_reuse_private.groups SET name=btrim(p_name),lists=p_lists,version=version+1,updated_by=auth.uid(),updated_at=now() WHERE id=p_id AND location_id=p_location_id AND version=p_version RETURNING * INTO g;IF g.id IS NULL THEN RAISE EXCEPTION 'Saved group changed. Reload before updating.';END IF;END IF;
 INSERT INTO task_reuse_private.audit(location_id,actor,action,details) VALUES(p_location_id,auth.uid(),'save bundle',jsonb_build_object('id',g.id,'version',g.version));RETURN to_jsonb(g);
END $$;
CREATE OR REPLACE FUNCTION public.staff_tasks_assign_bundle(p_location_id uuid,p_day date,p_users uuid[],p_shift text,p_lists jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x jsonb;u uuid;rid uuid;ids jsonb:='[]';payload jsonb;prior task_reuse_private.requests;due timestamptz;BEGIN
 PERFORM task_reuse_private.authorize(p_location_id,'assign');PERFORM task_reuse_private.validate_lists(p_lists);
 IF p_day IS NULL OR p_request_id IS NULL OR p_users IS NULL OR cardinality(p_users) NOT BETWEEN 1 AND 100 OR p_shift IS NULL OR length(p_shift)>100 THEN RAISE EXCEPTION 'Choose a date and 1–100 employees.';END IF;
 FOREACH u IN ARRAY p_users LOOP IF u IS NULL OR public.closeout_is_member_for_tasks(p_location_id,u) IS NOT TRUE THEN RAISE EXCEPTION 'Every assignee must be active in this location.';END IF;END LOOP;
 payload:=jsonb_build_object('day',p_day,'users',p_users,'shift',p_shift,'lists',p_lists);
 PERFORM pg_advisory_xact_lock(hashtextextended('task-bundle:'||p_location_id::text||p_request_id::text,0));
 SELECT * INTO prior FROM task_reuse_private.requests WHERE location_id=p_location_id AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'This request already assigned a different group. Reload before assigning again.';END IF;RETURN prior.result;END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lists) LOOP
  due:=CASE WHEN nullif(x->>'due','') IS NULL THEN NULL ELSE public.staff_tasks_due_at(p_day,(x->>'due')::time) END;
  INSERT INTO public.staff_task_runs(location_id,business_date,shift_label,title,position,phase,items,assigned_by,request_id,due_at) VALUES(p_location_id,p_day,btrim(p_shift),btrim(x->>'title'),btrim(x->>'position'),x->>'phase',x->'items',auth.uid(),gen_random_uuid(),due) RETURNING id INTO rid;
  INSERT INTO public.staff_task_assignees(run_id,user_id) SELECT rid,v FROM unnest(p_users) v GROUP BY v;
  ids:=ids||jsonb_build_array(rid);
 END LOOP;
 INSERT INTO task_reuse_private.requests VALUES(p_location_id,p_request_id,payload,ids);
 INSERT INTO task_reuse_private.audit(location_id,actor,action,details) VALUES(p_location_id,auth.uid(),'assign bundle',payload||jsonb_build_object('runs',ids));RETURN ids;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA task_reuse_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.staff_tasks_management_check(uuid,uuid,uuid,integer,boolean,integer),public.staff_tasks_saved_bundles(uuid),public.staff_tasks_save_bundle(uuid,uuid,integer,text,jsonb),public.staff_tasks_assign_bundle(uuid,date,uuid[],text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_tasks_management_check(uuid,uuid,uuid,integer,boolean,integer),public.staff_tasks_saved_bundles(uuid),public.staff_tasks_save_bundle(uuid,uuid,integer,text,jsonb),public.staff_tasks_assign_bundle(uuid,date,uuid[],text,jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS task_group_tools_installed, false AS production_behavior_verified;
