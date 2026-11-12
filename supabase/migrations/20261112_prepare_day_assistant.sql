BEGIN;
CREATE SCHEMA IF NOT EXISTS prepare_ai_private;
REVOKE ALL ON SCHEMA prepare_ai_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS prepare_ai_private.requests(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_id uuid NOT NULL,user_id uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS prepare_ai_request_limits ON prepare_ai_private.requests(user_id,requested_at DESC);
ALTER TABLE prepare_ai_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prepare_ai_private.requests FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.prepare_day_assistant_claim(p_location_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 PERFORM public.app_access_assert(p_location_id,'schedule','manage');
 PERFORM pg_advisory_xact_lock(hashtextextended('prepare-ai:'||auth.uid()::text,0));
 IF (SELECT count(*) FROM prepare_ai_private.requests WHERE user_id=auth.uid() AND requested_at>clock_timestamp()-interval '1 minute')>=5 OR (SELECT count(*) FROM prepare_ai_private.requests WHERE user_id=auth.uid() AND requested_at>clock_timestamp()-interval '1 hour')>=25 THEN RAISE EXCEPTION 'AI review limit reached. Try again later.';END IF;
 DELETE FROM prepare_ai_private.requests WHERE user_id=auth.uid() AND requested_at<clock_timestamp()-interval '7 days';
 INSERT INTO prepare_ai_private.requests(location_id,user_id) VALUES(p_location_id,auth.uid());RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.prepare_day_assistant_roster(p_location_id uuid,p_day date,p_rows jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE saved jsonb;draft_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 PERFORM public.app_access_assert(p_location_id,'schedule','manage');
 saved:=public.crew_schedule_tools_load(p_location_id,p_day);
 IF p_rows IS NOT NULL THEN draft_rows:=crew_ops_private.canonical(p_location_id,p_day,p_rows);END IF;
 RETURN saved||jsonb_build_object('draft_rows',draft_rows);
END $$;
REVOKE ALL ON FUNCTION public.prepare_day_assistant_claim(uuid),public.prepare_day_assistant_roster(uuid,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_day_assistant_claim(uuid),public.prepare_day_assistant_roster(uuid,date,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS prepare_day_assistant_sql_installed,false AS production_behavior_verified;
