BEGIN;
SET LOCAL lock_timeout='5s';
-- Preserve existing correction authorization, scoring and audit code.
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.closeout_manager_correct(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure);
 IF position('drinks_made_by=next_row.drinks_made_by' in d)=0 THEN
  IF position('''job_role'',''shift_type''' in d)=0 OR position('job_role=next_row.job_role,shift_type=' in d)=0 THEN
   RAISE EXCEPTION 'Correction function differs. Export closeout_manager_correct; no changes applied.';
  END IF;
  d:=replace(d,'''job_role'',''shift_type''','''job_role'',''drinks_made_by'',''shift_type''');
  d:=replace(d,'job_role=next_row.job_role,shift_type=','job_role=next_row.job_role,drinks_made_by=next_row.drinks_made_by,shift_type=');
  EXECUTE d;
 END IF;
 IF to_regprocedure('public.receipt_recipient_details_save(uuid,uuid,integer,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'Recipient receipt save is missing. Export receipt functions; no changes applied.';
 END IF;
END;$patch$;
CREATE OR REPLACE FUNCTION public.closeout_drink_people(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Active location access required.' USING errcode='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',p.id,'name',coalesce(nullif(p.preferred_name,''),p.full_name)) ORDER BY p.full_name,p.id)
 FROM public.profiles p JOIN public.location_memberships m ON m.user_id=p.id
 WHERE m.location_id=p_location_id AND m.status='active'),'[]'::jsonb);
END;$$;
CREATE OR REPLACE FUNCTION public.closeout_require_drink_maker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE check_value boolean;
BEGIN
 IF new.status IS DISTINCT FROM 'submitted' OR new.deleted_at IS NOT NULL THEN RETURN new; END IF;
 check_value:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN
  check_value:=old.status IS DISTINCT FROM 'submitted' OR new.job_role IS DISTINCT FROM old.job_role OR new.drinks_made_by IS DISTINCT FROM old.drinks_made_by;
 END IF;
 -- Do not block unrelated corrections to historical records with no attribution.
 IF NOT check_value THEN RETURN new; END IF;
 IF new.job_role='server' AND new.drinks_made_by IS NULL THEN
  RAISE EXCEPTION 'Choose who made your drinks before submitting.';
 END IF;
 IF new.drinks_made_by IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.location_memberships m WHERE m.location_id=new.location_id AND m.user_id=new.drinks_made_by AND m.status='active'
 ) THEN RAISE EXCEPTION 'Choose an active employee at this location.'; END IF;
 RETURN new;
END;$$;
DROP TRIGGER IF EXISTS zzzzzz_require_drink_maker ON public.daily_closeouts;
CREATE TRIGGER zzzzzz_require_drink_maker BEFORE INSERT OR UPDATE ON public.daily_closeouts FOR EACH ROW EXECUTE FUNCTION public.closeout_require_drink_maker();
REVOKE ALL ON FUNCTION public.closeout_require_drink_maker() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.closeout_drink_people(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.closeout_drink_people(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS drink_attribution_installed,false AS production_behavior_verified;
