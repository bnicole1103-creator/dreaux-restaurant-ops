BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS sales_month_private.goal_plans (
 location_id uuid NOT NULL REFERENCES public.locations(id),month date NOT NULL,
 days jsonb NOT NULL,sources jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,month),CHECK(extract(day from month)=1)
);
ALTER TABLE sales_month_private.goal_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_month_private.goal_plans FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.monthly_goal_plan_load(p_location uuid,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE first_day date; plan sales_month_private.goal_plans; goal sales_month_private.targets;
BEGIN
 PERFORM sales_month_private.member(p_location);
 PERFORM public.app_access_assert(p_location,'settings','sales');
 IF public.mod_is_manager(p_location) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month.';END IF;
 first_day:=date_trunc('month',p_month)::date;
 SELECT * INTO plan FROM sales_month_private.goal_plans WHERE location_id=p_location AND month=first_day;
 SELECT * INTO goal FROM sales_month_private.targets WHERE location_id=p_location AND month=first_day;
 RETURN jsonb_build_object('version',coalesce(plan.version,0),'month_version',coalesce(goal.version,0),'target',goal.target,'days',coalesce(plan.days,'[]'),'sources',coalesce(plan.sources,'{}'));
END;$$;
CREATE OR REPLACE FUNCTION public.monthly_goal_plan_save(p_location uuid,p_month date,p_version integer,p_month_version integer,p_days jsonb,p_sources jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE first_day date;last_day date;before_row sales_month_private.goal_plans;after_row sales_month_private.goal_plans;r jsonb;d date;amount numeric;total numeric:=0;seen date[]:='{}';saved jsonb;frozen numeric;
BEGIN
 PERFORM sales_month_private.member(p_location);
 PERFORM public.app_access_assert(p_location,'settings','sales');
 IF public.mod_is_manager(p_location) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month.';END IF;
 first_day:=date_trunc('month',p_month)::date;last_day:=(first_day+interval '1 month')::date-1;
 IF jsonb_typeof(p_days) IS DISTINCT FROM 'array' OR jsonb_array_length(p_days)<>last_day-first_day+1 THEN RAISE EXCEPTION 'Provide one goal for every date of the month.';END IF;
 IF jsonb_typeof(p_sources) IS DISTINCT FROM 'object' OR octet_length(p_sources::text)>10000000 THEN RAISE EXCEPTION 'Report details are too large or invalid.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('monthly-target:'||p_location::text||':'||first_day::text,0));
 SELECT * INTO before_row FROM sales_month_private.goal_plans WHERE location_id=p_location AND month=first_day FOR UPDATE;
 IF coalesce(before_row.version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'The plan changed. Reload before saving.';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_days) ORDER BY value->>'date' LOOP
  IF jsonb_typeof(r->'date') IS DISTINCT FROM 'string' OR (r->>'date')!~'^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(r->'target') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid date or daily goal.';END IF;
  d:=(r->>'date')::date;amount:=(r->>'target')::numeric;
  IF d<first_day OR d>last_day OR d=ANY(seen) OR amount<0 OR amount>100000000 OR amount<>round(amount,2) THEN RAISE EXCEPTION 'Daily dates must be unique, in the month, with nonnegative two-decimal goals.';END IF;
  seen:=array_append(seen,d);total:=total+amount;
  PERFORM pg_advisory_xact_lock(hashtextextended('closeout-target:'||p_location::text||':'||d::text,0));
  SELECT (allocation->>'team_target')::numeric INTO frozen FROM public.closeout_target_days WHERE location_id=p_location AND target_date=d;
  IF FOUND AND frozen IS DISTINCT FROM amount THEN RAISE EXCEPTION 'Targets for % were locked by a closeout (%). Keep that daily amount unchanged.',d,frozen;END IF;
 END LOOP;
 IF total<=0 OR total>100000000 THEN RAISE EXCEPTION 'Monthly total must be greater than zero and at most 100,000,000.';END IF;
 saved:=public.monthly_sales_target_save(p_location,first_day,total,p_month_version);
 INSERT INTO sales_month_private.goal_plans(location_id,month,days,sources,updated_by)
 VALUES(p_location,first_day,p_days,p_sources,auth.uid())
 ON CONFLICT(location_id,month) DO UPDATE SET days=excluded.days,sources=excluded.sources,version=goal_plans.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() RETURNING * INTO after_row;
 INSERT INTO sales_month_private.audit(location_id,changed_by,kind,before_record,after_record)
 VALUES(p_location,auth.uid(),'monthly calendar goal plan',to_jsonb(before_row),to_jsonb(after_row));
 RETURN jsonb_build_object('version',after_row.version,'month_version',(saved->>'version')::integer);
END;$$;
CREATE OR REPLACE FUNCTION public.calendar_sales_goals(p_location uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM sales_month_private.member(p_location);
 PERFORM public.app_access_assert(p_location,'calendar','*');
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>62 THEN RAISE EXCEPTION 'Choose a calendar range of at most 63 days.';END IF;
 SELECT coalesce(jsonb_object_agg(x->>'date',x->'target'),'{}') INTO result
 FROM sales_month_private.goal_plans p CROSS JOIN LATERAL jsonb_array_elements(p.days) x
 WHERE p.location_id=p_location AND p.month BETWEEN date_trunc('month',p_from)::date AND date_trunc('month',p_to)::date
 AND (x->>'date')::date BETWEEN p_from AND p_to;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.monthly_goal_plan_load(uuid,date),public.monthly_goal_plan_save(uuid,date,integer,integer,jsonb,jsonb),public.calendar_sales_goals(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monthly_goal_plan_load(uuid,date),public.monthly_goal_plan_save(uuid,date,integer,integer,jsonb,jsonb),public.calendar_sales_goals(uuid,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS monthly_goal_planner_installed,false AS production_behavior_verified;
