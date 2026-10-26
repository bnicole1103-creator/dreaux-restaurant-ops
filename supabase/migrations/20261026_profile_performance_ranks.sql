BEGIN;
-- Explicit purchase classification keeps business expenses outside POS penalties.
CREATE SCHEMA IF NOT EXISTS wallet_types_private;
REVOKE ALL ON SCHEMA wallet_types_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS wallet_types_private.expenses(
 receipt_id uuid PRIMARY KEY REFERENCES public.purchase_receipts(id),
 classified_by uuid NOT NULL,
 classified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE wallet_types_private.expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_types_private.expenses FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.receipt_mark_expense(p_location_id uuid,p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $expense$
DECLARE r public.purchase_receipts;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Active location access required.' USING errcode='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||p_id::text,0));
 SELECT * INTO r FROM public.purchase_receipts WHERE id=p_id AND location_id=p_location_id FOR UPDATE;
 IF r.id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR r.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'Only your own purchase can be classified.' USING errcode='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.closeout_receipts WHERE source_purchase_id=p_id AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'This photo already has a void or comp entry. Use its correction workflow before reclassifying.';
 END IF;
 IF r.data->>'category' IN ('Void receipt','Comp receipt') THEN
  RAISE EXCEPTION 'Choose Purchase / Expense first.';
 END IF;
 INSERT INTO wallet_types_private.expenses(receipt_id,classified_by) VALUES(p_id,auth.uid()) ON CONFLICT DO NOTHING;
END $expense$;
REVOKE ALL ON FUNCTION public.receipt_mark_expense(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_mark_expense(uuid,uuid) TO authenticated;

-- Keep manager checks for void/comp photos; exclude only explicit expenses.
DO $expense_guards$
DECLARE fname text;body text;definition text;pattern text;matches integer;
BEGIN
 FOREACH fname IN ARRAY ARRAY['public.receipt_hub_finalize()','public.receipt_review_before_submit()'] LOOP
  SELECT prosrc INTO body FROM pg_proc WHERE oid=fname::regprocedure;
  IF position('wallet-expense-exclusion-v1' IN body)=0 THEN
   IF (fname='public.receipt_hub_finalize()' AND position('quick-closeout-staff-explicit-attachments-v1' IN body)=0)
    OR (fname='public.receipt_review_before_submit()' AND position('quick-closeout-staff-attached-review-v1' IN body)=0) THEN
    RAISE EXCEPTION 'Install the reconciled quick-closeout SQL before this wallet update.';
   END IF;
   pattern:='from[[:space:]]+public\.purchase_receipts[[:space:]]+p[[:space:]]+where';
   SELECT count(*) INTO matches FROM regexp_matches(body,pattern,'gi');
   IF matches<>1 THEN RAISE EXCEPTION 'Expense review rule changed: %. No update applied.',fname;END IF;
   definition:=pg_get_functiondef(fname::regprocedure);
   EXECUTE regexp_replace(definition,pattern,
    'from public.purchase_receipts p where /* wallet-expense-exclusion-v1 */ NOT EXISTS(SELECT 1 FROM wallet_types_private.expenses expense WHERE expense.receipt_id=p.id) AND','i');
  END IF;
 END LOOP;
END $expense_guards$;

CREATE OR REPLACE FUNCTION wallet_types_private.guard_pos_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $link$
BEGIN
 IF new.source_purchase_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('receipt-wallet:'||new.source_purchase_id::text,0));
  IF EXISTS(SELECT 1 FROM wallet_types_private.expenses WHERE receipt_id=new.source_purchase_id) THEN
   RAISE EXCEPTION 'Purchase / Expense receipts stay in the expense wallet and cannot be attached as POS voids or comps.';
  END IF;
 END IF;
 RETURN new;
END $link$;
REVOKE ALL ON FUNCTION wallet_types_private.guard_pos_link() FROM PUBLIC,anon,authenticated;
DO $link_trigger$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.closeout_receipts'::regclass AND tgname='a_wallet_expense_pos_guard') THEN
  CREATE TRIGGER a_wallet_expense_pos_guard BEFORE INSERT OR UPDATE OF source_purchase_id ON public.closeout_receipts FOR EACH ROW EXECUTE FUNCTION wallet_types_private.guard_pos_link();
 ELSIF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.closeout_receipts'::regclass AND tgname='a_wallet_expense_pos_guard' AND tgfoid='wallet_types_private.guard_pos_link()'::regprocedure AND tgenabled IN ('O','A') AND tgtype=23) THEN
  RAISE EXCEPTION 'Expense link trigger differs from the expected configuration.';
 END IF;
END $link_trigger$;

CREATE OR REPLACE FUNCTION public.profile_performance_ranks(
 p_location_id uuid,p_user_id uuid,p_start date,p_end date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $rank$
DECLARE
 cohort_role text;
 member record;
 profile jsonb;
 records jsonb:='[]'::jsonb;
 sales_score numeric;
 performance_score numeric;
 sales_count integer;
 paired_count integer;
 review_count integer;
 quiz_count integer;
 task_count numeric;
 reviews numeric;
 quiz_accuracy numeric;
 task_accuracy numeric;
 sales_reason text;
 performance_reason text;
 result jsonb;
 today date:=((now() AT TIME ZONE 'America/Chicago')-interval '4 hours')::date;
BEGIN
 IF auth.uid() IS NULL
 OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Management access required.' USING errcode='42501';
 END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>366 THEN
  RAISE EXCEPTION 'Choose a date range of at most one year.';
 END IF;
 -- Retain the existing profile permission checks.
 PERFORM public.team_profile_details(p_location_id,p_user_id,p_start,p_end);
 SELECT role::text INTO cohort_role FROM public.location_memberships
 WHERE location_id=p_location_id AND user_id=p_user_id AND status='active';
 IF cohort_role IS NULL THEN
  RAISE EXCEPTION 'Only active location members can be ranked.';
 END IF;
 IF (SELECT count(*) FROM public.location_memberships WHERE location_id=p_location_id
     AND status='active' AND role::text=cohort_role)>250 THEN
  RAISE EXCEPTION 'This role has too many accounts for this rank report.';
 END IF;
 FOR member IN SELECT DISTINCT user_id FROM public.location_memberships
  WHERE location_id=p_location_id AND status='active' AND role::text=cohort_role
 LOOP
  profile:=public.team_profile_details(p_location_id,member.user_id,p_start,p_end);
  IF coalesce((profile->>'manager_view')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'Management profile data was not returned; rankings are unavailable.';
  END IF;
  SELECT count(*),count(*) FILTER(WHERE (x->>'target')::numeric>0 AND x->>'sales' IS NOT NULL
     AND (x->>'sales')::numeric::text NOT IN ('NaN','Infinity','-Infinity')
     AND (x->>'target')::numeric::text NOT IN ('NaN','Infinity','-Infinity')),
   round(100*sum((x->>'sales')::numeric) FILTER(WHERE (x->>'target')::numeric>0)
    /nullif(sum((x->>'target')::numeric) FILTER(WHERE (x->>'target')::numeric>0),0),2)
  INTO sales_count,paired_count,sales_score
  FROM jsonb_array_elements(coalesce(profile->'closeouts','[]'::jsonb)) x;
  sales_reason:='';
  IF sales_count<3 THEN sales_reason:='Needs at least three submitted closeouts.';
  ELSIF paired_count<>sales_count THEN sales_reason:='Some closeouts have missing sales or usable targets.';
  END IF;
  IF sales_reason<>'' THEN sales_score:=NULL;END IF;
  SELECT count(*),avg((x->>'rating')::numeric)/10 INTO review_count,reviews
  FROM jsonb_array_elements(coalesce(profile->'ratings','[]'::jsonb)) x
  WHERE (x->>'rating')::numeric BETWEEN 1 AND 10;
  SELECT count(*),sum((x->>'score')::numeric)/nullif(sum((x->>'total')::numeric),0)
  INTO quiz_count,quiz_accuracy
  FROM jsonb_array_elements(coalesce(profile->'quizzes','[]'::jsonb)) x
  WHERE (x->>'total')::numeric>0 AND (x->>'score')::numeric BETWEEN 0 AND (x->>'total')::numeric
   AND (x->>'total')::numeric::text NOT IN ('NaN','Infinity','-Infinity');
  SELECT coalesce(sum((x->>'total')::numeric),0),
   sum((x->>'completed')::numeric)/nullif(sum((x->>'total')::numeric),0)
  INTO task_count,task_accuracy
  FROM jsonb_array_elements(coalesce(profile->'tasks','[]'::jsonb)) x
  WHERE (x->>'active')::boolean IS TRUE AND (x->>'date')::date<today
   AND (x->>'total')::numeric>0 AND (x->>'completed')::numeric BETWEEN 0 AND (x->>'total')::numeric
   AND (x->>'total')::numeric::text NOT IN ('NaN','Infinity','-Infinity');
  performance_reason:=concat_ws(' ',
   CASE WHEN review_count<3 THEN 'Needs three valid manager reviews.' END,
   CASE WHEN quiz_count<3 THEN 'Needs three scored quiz attempts.' END,
   CASE WHEN task_count<10 THEN 'Needs ten active task items from prior service days.' END);
  performance_score:=CASE WHEN performance_reason='' THEN round(50*reviews+25*quiz_accuracy+25*task_accuracy,2) ELSE NULL END;
  records:=records||jsonb_build_array(jsonb_build_object('user_id',member.user_id,
   'sales',sales_score,'performance',performance_score,
   'sales_reason',sales_reason,'performance_reason',performance_reason));
 END LOOP;
 WITH rows AS (SELECT * FROM jsonb_to_recordset(records) AS r(user_id uuid,sales numeric,performance numeric,sales_reason text,performance_reason text)),
 chosen AS (SELECT * FROM rows WHERE user_id=p_user_id)
 SELECT jsonb_build_object('role',cohort_role,'cohort',(SELECT count(*) FROM rows),
  'sales',jsonb_build_object('score',c.sales,'reason',c.sales_reason,
   'eligible',(SELECT count(*) FROM rows WHERE sales IS NOT NULL),
   'rank',CASE WHEN c.sales IS NOT NULL THEN 1+(SELECT count(*) FROM rows WHERE sales>c.sales) END),
  'performance',jsonb_build_object('score',c.performance,'reason',c.performance_reason,
   'eligible',(SELECT count(*) FROM rows WHERE performance IS NOT NULL),
   'rank',CASE WHEN c.performance IS NOT NULL THEN 1+(SELECT count(*) FROM rows WHERE performance>c.performance) END))
 INTO result FROM chosen c;
 RETURN result;
END $rank$;
REVOKE ALL ON FUNCTION public.profile_performance_ranks(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.profile_performance_ranks(uuid,uuid,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

SELECT
 to_regprocedure('public.receipt_mark_expense(uuid,uuid)') IS NOT NULL AS expense_type_installed,
 to_regprocedure('public.profile_performance_ranks(uuid,uuid,date,date)') IS NOT NULL AS profile_ranks_installed,
 false AS production_behavior_verified;
