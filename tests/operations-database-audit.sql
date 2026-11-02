-- Run in Supabase SQL Editor. READ ONLY. No account, receipt or score changes.
BEGIN TRANSACTION READ ONLY;

SELECT current_timestamp AS captured_at, false AS production_behavior_verified;

SELECT signature, to_regprocedure(signature) IS NOT NULL AS installed
FROM unnest(ARRAY[
 'public.closeout_receipt_save(uuid,uuid,integer,jsonb,text)',
 'public.closeout_receipt_save_before_wallet_flow(uuid,uuid,integer,jsonb,text)',
 'public.closeout_receipt_save_before_assignment(uuid,uuid,integer,jsonb,text)',
 'public.closeout_receipts_load(uuid,date,date,uuid,uuid)',
 'public.closeout_receipts_load_before_wallet_flow(uuid,date,date,uuid,uuid)',
 'public.receipt_recipient_details_save(uuid,uuid,integer,jsonb,text)',
 'public.closeout_drink_people(uuid)',
 'public.closeout_require_drink_maker()',
 'public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean)',
 'public.quiz_staff_day_v2(uuid,date)',
 'public.quiz_staff_submit(uuid,integer,jsonb)',
 'public.quiz_reward_value(integer,integer)',
 'public.points_source_entries(uuid)',
 'public.management_can_edit_user(uuid,uuid)',
 'public.publish_weekly_points_leaderboard(uuid,date,date,uuid,jsonb)',
 'public.restaurant_daily_challenge_load(uuid)',
 'public.restaurant_daily_challenge_publish(uuid,uuid,text,timestamp with time zone,timestamp with time zone,text)'
]) AS signature;

-- Definitions identify wrapper drift or missing helper references without guessing.
SELECT n.nspname AS schema_name,p.proname AS function_name,
 pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_functiondef(p.oid) AS current_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','board_private','leaderboard_private','rebuild_private')
 AND p.proname IN ('closeout_receipt_save','closeout_receipt_save_before_wallet_flow',
 'closeout_receipt_save_before_assignment','closeout_receipt_save_before_compatibility',
 'closeout_receipt_save_before_responsibility','closeout_receipts_load',
 'closeout_receipts_load_before_wallet_flow','closeout_manager_correct',
 'closeout_require_drink_maker','form_policy','receipt_item_links',
 'points_source_entries','management_can_edit_user','quiz_submit_before_v2',
 'quiz_staff_submit','mod_is_manager','closeout_is_gm')
ORDER BY n.nspname,p.proname;

SELECT t.tgname,pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t WHERE NOT t.tgisinternal
 AND t.tgrelid IN ('public.daily_closeouts'::regclass,'public.closeout_receipts'::regclass,
 'public.daily_quizzes'::regclass,'public.daily_quiz_attempts'::regclass)
ORDER BY t.tgrelid::regclass::text,t.tgname;

SELECT l.id AS location_id,
 count(*) FILTER(WHERE r.status='approved') AS approved_requests,
 count(*) FILTER(WHERE r.status='approved' AND u.email_confirmed_at IS NULL) AS email_not_confirmed,
 count(*) FILTER(WHERE r.status='approved' AND NOT EXISTS(
  SELECT 1 FROM public.location_memberships m WHERE m.location_id=r.location_id
  AND m.user_id=r.user_id AND m.status='active')) AS missing_active_location_membership,
 count(*) FILTER(WHERE r.status='approved' AND NOT EXISTS(
  SELECT 1 FROM public.organization_memberships o WHERE o.organization_id=l.organization_id
  AND o.user_id=r.user_id AND o.status='active')) AS missing_active_organization_membership
FROM public.staff_signup_requests r JOIN public.locations l ON l.id=r.location_id
LEFT JOIN auth.users u ON u.id=r.user_id GROUP BY l.id;

-- A summary of roles/statuses; no email addresses or authentication data.
SELECT location_id,role,status,count(*) AS accounts
FROM public.location_memberships GROUP BY location_id,role,status ORDER BY location_id,role,status;
ROLLBACK;
