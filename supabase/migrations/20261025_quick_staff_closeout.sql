BEGIN;
-- Replace only the inspected guard. Stop rather than overwrite an unknown newer rule.
DO $preflight$
DECLARE body text;
BEGIN
 IF to_regprocedure('public.receipt_pending_closeout_guard()') IS NULL
 OR to_regprocedure('public.closeout_receipt_score()') IS NULL
 OR to_regprocedure('public.closeout_is_member(uuid)') IS NULL
 OR to_regprocedure('rebuild_private.schedule_confirmed(uuid,date)') IS NULL
 THEN RAISE EXCEPTION 'Existing closeout, receipt and confirmed-schedule updates are required first.'; END IF;
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.receipt_pending_closeout_guard()'::regprocedure;
 IF md5(body)<>'dea21528322783be7a055dd45eccd936' AND position('quick-closeout-attached-only-v1' in body)=0
 THEN RAISE EXCEPTION 'The receipt submission guard has changed. Export receipt_pending_closeout_guard() for a safe merge; no update applied.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.daily_closeouts'::regclass AND tgname='zz_receipt_pending_closeout_guard' AND tgfoid='public.receipt_pending_closeout_guard()'::regprocedure AND tgenabled<>'D')
 THEN RAISE EXCEPTION 'Expected receipt guard trigger is unavailable; no update applied.'; END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.receipt_pending_closeout_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
BEGIN
 -- quick-closeout-attached-only-v1: wallet drafts are not submission obligations.
 IF new.status='submitted' AND (TG_OP='INSERT' OR old.status IS DISTINCT FROM 'submitted') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('closeout-submit:'||new.user_id::text||new.id::text,0));
  IF EXISTS(SELECT 1 FROM public.closeout_receipts r
   WHERE r.closeout_key=new.id AND r.deleted_at IS NULL AND (
    r.location_id IS DISTINCT FROM new.location_id OR r.user_id IS DISTINCT FROM new.user_id
    OR r.business_date IS DISTINCT FROM new.closeout_date OR r.ready IS NOT TRUE
    OR r.amount IS NULL OR r.amount<=0 OR r.amount::text IN ('NaN','Infinity','-Infinity') OR r.reason IS NULL
    OR nullif(btrim(r.verifier_name),'') IS NULL
    OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=r.origin_bucket AND o.name=r.file_path)))
  THEN RAISE EXCEPTION 'Finish every attached receipt, or keep it in the private wallet before submitting.'; END IF;
 END IF;
 RETURN new;
END $guard$;
REVOKE ALL ON FUNCTION public.receipt_pending_closeout_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.quick_closeout_context(p_location_id uuid,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $context$
DECLARE confirmed boolean;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 THEN RAISE EXCEPTION 'Active location access required.' USING errcode='42501'; END IF;
 PERFORM public.app_access_assert(p_location_id,'closeout','staff');
 IF p_day IS NULL THEN RAISE EXCEPTION 'Choose a service date.'; END IF;
 confirmed:=rebuild_private.schedule_confirmed(p_location_id,p_day);
 RETURN jsonb_build_object('confirmed',confirmed,'shifts',CASE WHEN confirmed THEN
  coalesce((SELECT jsonb_agg(jsonb_build_object('key',s.shift_key,'start',s.start_at,'end',s.end_at,'role',s.role_name) ORDER BY s.start_at,s.shift_key)
   FROM public.staff_scheduled_shifts s WHERE s.location_id=p_location_id AND s.business_date=p_day
    AND s.user_id=auth.uid() AND s.shift_key NOT LIKE 'offday:%'),'[]'::jsonb)
 ELSE '[]'::jsonb END);
END $context$;

CREATE OR REPLACE FUNCTION public.quick_closeout_keep_receipt(p_location_id uuid,p_id uuid,p_version integer,p_closeout_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $keep$
DECLARE prior public.closeout_receipts;updated public.closeout_receipts;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 THEN RAISE EXCEPTION 'Active location access required.' USING errcode='42501'; END IF;
 PERFORM public.app_access_assert(p_location_id,'closeout','staff');
 IF p_closeout_key IS NULL THEN RAISE EXCEPTION 'Open the draft closeout first.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('closeout-submit:'||auth.uid()::text||p_closeout_key::text,0));
 SELECT * INTO prior FROM public.closeout_receipts WHERE id=p_id AND location_id=p_location_id FOR UPDATE;
 IF prior.id IS NULL OR prior.user_id IS DISTINCT FROM auth.uid() OR prior.deleted_at IS NOT NULL
  OR prior.closeout_key IS DISTINCT FROM p_closeout_key OR prior.manager_shift_id IS NOT NULL
 THEN RAISE EXCEPTION 'Only your receipt attached to this draft closeout can be kept for later.' USING errcode='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.daily_closeouts WHERE id=p_closeout_key AND (status='submitted' OR user_id IS DISTINCT FROM auth.uid() OR location_id IS DISTINCT FROM p_location_id))
 THEN RAISE EXCEPTION 'Submitted receipt corrections require the existing correction workflow.' USING errcode='42501'; END IF;
 IF prior.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Receipt changed. Refresh before trying again.'; END IF;
 UPDATE public.closeout_receipts SET closeout_key=NULL,added_at=NULL,added_by=NULL,legacy_linked=false,
  version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO updated;
 INSERT INTO public.closeout_receipt_audit(receipt_id,actor_id,before_record,after_record)
 VALUES(p_id,auth.uid(),to_jsonb(prior),to_jsonb(updated)||jsonb_build_object('event','Kept in private wallet; detached from draft closeout'));
 RETURN to_jsonb(updated);
END $keep$;
REVOKE ALL ON FUNCTION public.quick_closeout_context(uuid,date),public.quick_closeout_keep_receipt(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quick_closeout_context(uuid,date),public.quick_closeout_keep_receipt(uuid,uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS quick_closeout_sql_installed,false AS production_behavior_verified;
