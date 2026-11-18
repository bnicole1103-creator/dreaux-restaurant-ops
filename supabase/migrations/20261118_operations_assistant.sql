BEGIN;
CREATE SCHEMA IF NOT EXISTS operations_ai_private;
REVOKE ALL ON SCHEMA operations_ai_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS operations_ai_private.requests(user_id uuid NOT NULL,location_id uuid NOT NULL,kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX IF NOT EXISTS operations_ai_requests_user_time ON operations_ai_private.requests(user_id,created_at DESC);
ALTER TABLE operations_ai_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON operations_ai_private.requests FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.operations_assistant_claim(p_location uuid,p_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE page text;section text;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE THEN RAISE EXCEPTION 'Active location membership required.' USING errcode='42501';END IF;
 CASE p_kind
 WHEN 'reservation' THEN page:='floor';section:='reservations';
 WHEN 'closeout' THEN page:='closeout';section:='staff';
 WHEN 'report' THEN page:='reports';section:='builder';IF public.mod_is_manager(p_location) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 WHEN 'training' THEN page:='training';section:='service';
 WHEN 'sales' THEN page:='home';section:='*';
 ELSE RAISE EXCEPTION 'Unknown assistant workflow.';
 END CASE;
 PERFORM public.app_access_assert(p_location,page,section);
 PERFORM pg_advisory_xact_lock(hashtextextended('operations-ai:'||auth.uid()::text,0));
 IF (SELECT count(*) FROM operations_ai_private.requests WHERE user_id=auth.uid() AND created_at>clock_timestamp()-interval '1 minute')>=5 OR (SELECT count(*) FROM operations_ai_private.requests WHERE user_id=auth.uid() AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'AI review limit reached. Try again later.';END IF;
 DELETE FROM operations_ai_private.requests WHERE user_id=auth.uid() AND created_at<clock_timestamp()-interval '7 days';
 INSERT INTO operations_ai_private.requests(user_id,location_id,kind) VALUES(auth.uid(),p_location,p_kind);RETURN true;
END;$$;
REVOKE ALL ON FUNCTION public.operations_assistant_claim(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_assistant_claim(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
