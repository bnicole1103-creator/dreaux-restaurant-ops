BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-visual-studio-v1',0));

-- Add size validation without replacing authorization, version checks or audit logic.
DO $geometry$
DECLARE
 definition text; matches integer;
 anchor text:='elsif[[:space:]]+property[.]key[[:space:]]*=[[:space:]]*''hidden''[[:space:]]+then';
 branch text:=$branch$-- justinis-element-geometry-v1
   elsif property.key in ('width','minHeight','iconSize') then
    if jsonb_typeof(property.value) is distinct from 'number'
     or (property.value#>>'{}') !~ '^[0-9]+$'
    then raise exception 'Element dimensions must be whole pixels.';end if;
    if property.key='iconSize' then
     if (property.value#>>'{}')::numeric not between 16 and 160
     then raise exception 'Icon size must be 16–160 pixels.';end if;
    elsif (property.value#>>'{}')::numeric not between 44 and 2000
    then raise exception 'Width and minimum height must be 44–2000 pixels.';end if;
   elsif property.key in ('offsetX','offsetY') then
    if jsonb_typeof(property.value) is distinct from 'number'
     or (property.value#>>'{}') !~ '^-?[0-9]+$'
     or abs((property.value#>>'{}')::numeric)>2000
    then raise exception 'Element offsets must be whole pixels within 2000.';end if;
   elsif property.key='hidden' then$branch$;
BEGIN
 IF to_regprocedure('public.page_design_save(uuid,text,integer,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Existing screen editor is required. No changes applied.';
 END IF;
 definition:=pg_get_functiondef('public.page_design_save(uuid,text,integer,jsonb)'::regprocedure);
 IF position('justinis-element-geometry-v1' in definition)=0 THEN
  SELECT count(*) INTO matches FROM regexp_matches(definition,anchor,'gi');
  IF matches<>1 OR position('page_design_audit' in definition)=0
   OR position('closeout_is_gm' in definition)=0 OR position('pg_advisory_xact_lock' in definition)=0 THEN
   RAISE EXCEPTION 'Screen editor validator changed. No changes applied; export page_design_save for reconciliation.';
  END IF;
  definition:=regexp_replace(definition,anchor,branch,'i');
  EXECUTE definition;
 END IF;
END;
$geometry$;

-- A new read-only endpoint. Existing closeout and points functions remain intact.
DO $check$
DECLARE existing regprocedure:=to_regprocedure('public.cash_reconciliation_day_v1(uuid,date)');
BEGIN
 IF existing IS NOT NULL
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=existing)<>'4db48462d9e67c9a35e3b95d7318c168' THEN
  RAISE EXCEPTION 'An unfamiliar cash function already exists. No changes applied; export it for reconciliation.';
 END IF;
END;
$check$;
CREATE OR REPLACE FUNCTION public.cash_reconciliation_day_v1(p_location_id uuid,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $cash$
DECLARE result jsonb; staff_rows jsonb; total numeric; count_rows integer; missing_cash integer;
 confirmed boolean:=NULL; missing_required integer:=NULL;
BEGIN
 -- justinis-cash-compare-v1
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
  OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Manager access required.' USING errcode='42501';
 END IF;
 PERFORM public.app_access_assert(p_location_id,'summary','cash');
 IF p_day IS NULL OR p_day>((now() AT TIME ZONE 'America/Chicago')-interval '4 hours')::date THEN
  RAISE EXCEPTION 'Choose a current or past service day.';
 END IF;
 result:=public.closeout_summary_day(p_location_id,p_day);
 IF (result->>'manager')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Manager summary access required.' USING errcode='42501';END IF;
 IF jsonb_typeof(result->'manager_closeouts') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Manager closeout data is missing from the summary connection.';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','user_id',c->>'user_id',
  'name',coalesce((SELECT coalesce(nullif(p->>'preferred_name',''),nullif(p->>'full_name',''))
   FROM jsonb_array_elements(coalesce(result->'profiles','[]'::jsonb)) p WHERE p->>'id'=c->>'user_id' LIMIT 1),'Employee name unavailable'),
  'cash_deposit',CASE WHEN coalesce(c->'omitted_questions','[]'::jsonb)?'staff_5' THEN NULL ELSE c->'cash_deposit' END)),'[]'::jsonb),
  coalesce(sum(CASE WHEN coalesce(c->'omitted_questions','[]'::jsonb)?'staff_5' THEN NULL ELSE (c->>'cash_deposit')::numeric END),0),count(*)::integer,
  count(*) FILTER(WHERE c->>'cash_deposit' IS NULL OR coalesce(c->'omitted_questions','[]'::jsonb)?'staff_5')::integer
 INTO staff_rows,total,count_rows,missing_cash FROM jsonb_array_elements(coalesce(result->'closeouts','[]'::jsonb)) c;
 IF to_regprocedure('staff_ops_private.roster_ready(uuid,date)') IS NOT NULL THEN
  EXECUTE 'SELECT staff_ops_private.roster_ready($1,$2)' INTO confirmed USING p_location_id,p_day;
 END IF;
 IF to_regclass('public.staff_scheduled_shifts') IS NOT NULL THEN
  EXECUTE $expected$SELECT count(*)::integer FROM public.staff_scheduled_shifts s
   WHERE s.location_id=$1 AND s.business_date=$2 AND s.requires_closeout
    AND lower(s.role_name)!~'(^|[^a-z])(manager|management|mod|gm|owner|supervisor)([^a-z]|$)'
    AND NOT EXISTS(SELECT 1 FROM public.daily_closeouts c WHERE c.location_id=s.location_id
     AND c.user_id=s.user_id AND c.closeout_date=s.business_date AND c.status='submitted' AND c.deleted_at IS NULL
     AND c.scheduled_start::time=(s.start_at AT TIME ZONE 'America/Chicago')::time)$expected$
   INTO missing_required USING p_location_id,p_day;
 END IF;
 RETURN jsonb_build_object('staff_total',round(total,2),'staff_count',count_rows,'missing_cash',missing_cash,
  'roster_confirmed',confirmed,'missing_required_closeouts',missing_required,'staff',staff_rows,
  'manager_closeouts',result->'manager_closeouts');
END;
$cash$;
REVOKE ALL ON FUNCTION public.cash_reconciliation_day_v1(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cash_reconciliation_day_v1(uuid,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS visual_studio_sql_installed, false AS production_behavior_verified;
