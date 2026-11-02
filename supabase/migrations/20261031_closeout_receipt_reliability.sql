BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-closeout-receipt-reliability-v1',0));

-- Restore the missing low-level helper from the installed, validated core.
-- Never forward to closeout_receipt_save: its wrappers can call this helper.
DO $repair$
DECLARE core regprocedure; definition text; body text; marker text;
BEGIN
 IF to_regprocedure('public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text)') IS NULL THEN
  core:=to_regprocedure('public.closeout_receipt_save_before_assignment(uuid,uuid,integer,jsonb,text)');
  IF core IS NULL THEN RAISE EXCEPTION 'Receipt core missing. Export receipt function definitions; no changes applied.'; END IF;
  SELECT prosrc INTO body FROM pg_proc WHERE oid=core;
  -- Reject a wrapper, including the opposite historical migration order.
  IF body ~* 'closeout_receipt_save[[:alnum:]_]*[[:space:]]*\('
   OR position('public.closeout_is_member' IN body)=0
   OR position('prior.version' IN body)=0
   OR position('p_version' IN body)=0
   OR position('public.closeout_receipt_audit' IN body)=0
   OR position('storage.objects' IN body)=0
   OR position('public.daily_closeouts' IN body)=0
   OR position('r.user_id' IN body)=0
   OR position('p_location_id' IN body)=0 THEN
   RAISE EXCEPTION 'Receipt core is not the expected validated implementation. Export definitions; no changes applied.';
  END IF;
  definition:=pg_get_functiondef(core);
  definition:=replace(definition,'FUNCTION public.closeout_receipt_save_before_assignment(', 'FUNCTION public.closeout_receipt_save_before_wallet_flow(');
  IF position('FUNCTION public.closeout_receipt_save_before_wallet_flow(' IN definition)=0 THEN
   RAISE EXCEPTION 'Receipt core header changed. No changes applied.';
  END IF;
  EXECUTE definition;
 END IF;
 REVOKE ALL ON FUNCTION public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text) FROM public,anon,authenticated;

 -- The earlier field-visibility policy must not erase required server attribution.
 IF to_regprocedure('board_private.form_policy()') IS NOT NULL THEN
  definition:=pg_get_functiondef('board_private.form_policy()'::regprocedure);
  marker:='-- required-server-drink-attribution-v1';
  IF position(marker IN definition)=0 THEN
   IF position('if hidden ? ''staff_15'' then new.drinks_made_by:=null;end if;' IN definition)=0 THEN
    RAISE EXCEPTION 'Closeout form policy changed. Export board_private.form_policy; no changes applied.';
   END IF;
   definition:=replace(definition,
    'if hidden ? ''staff_15'' then new.drinks_made_by:=null;end if;',
    marker||E'\n if new.job_role=''server'' then new.omitted_questions:=new.omitted_questions-''staff_15''; elsif hidden ? ''staff_15'' then new.drinks_made_by:=null;end if;');
   EXECUTE definition;
  END IF;
 END IF;

 -- Tagged recipients may edit links on that receipt, never the sender's wallet.
 IF to_regprocedure('public.receipt_item_links(uuid,uuid,text,jsonb,integer)') IS NOT NULL THEN
  definition:=pg_get_functiondef('public.receipt_item_links(uuid,uuid,text,jsonb,integer)'::regprocedure);
  marker:='-- receipt-recipient-item-links-v1';
  IF position(marker IN definition)=0 THEN
   IF position('elsif p_type=''purchase'' then' IN definition)=0 OR position('c.assigned_user_id' IN definition)>0 THEN
    RAISE EXCEPTION 'Receipt item-link permissions changed. Export receipt_item_links; no changes applied.';
   END IF;
   definition:=replace(definition,'elsif p_type=''purchase'' then',
    marker||E'\n  if c.assigned_user_id=auth.uid() then allowed:=true;editable:=true;end if;\n elsif p_type=''purchase'' then');
   EXECUTE definition;
  END IF;
 END IF;
END;$repair$;
NOTIFY pgrst,'reload schema';
COMMIT;

SELECT
 to_regprocedure('public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text)') IS NOT NULL AS wallet_save_helper_present,
 false AS production_behavior_verified;
