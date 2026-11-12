BEGIN;
CREATE OR REPLACE FUNCTION public.reservation_connection_health(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sync jsonb;
BEGIN
 PERFORM public.reservation_confirmation_access(p_location_id);
 IF to_regclass('public.operations_inquiry_sync') IS NULL THEN
  RETURN jsonb_build_object('checked_at',clock_timestamp(),'installed',false,
   'configured',false,'last_success',NULL,'has_error',false,
   'detail','Inquiry notification sync is not installed.');
 END IF;
 BEGIN
  EXECUTE 'SELECT jsonb_build_object(''last_success'',last_success,
   ''has_error'',nullif(btrim(last_error),'''') IS NOT NULL)
   FROM public.operations_inquiry_sync WHERE location_id=$1'
  INTO sync USING p_location_id;
 EXCEPTION WHEN undefined_column THEN
  RETURN jsonb_build_object('checked_at',clock_timestamp(),'installed',true,
   'configured',false,'last_success',NULL,'has_error',true,
   'detail','The installed sync table needs a compatible health check.');
 END;
 RETURN jsonb_build_object('checked_at',clock_timestamp(),'installed',true,
  'configured',sync IS NOT NULL,'last_success',sync->'last_success',
  'has_error',coalesce((sync->>'has_error')::boolean,false),
  'detail',CASE WHEN sync IS NULL THEN 'No inquiry sync is configured for this location.'
   WHEN (sync->>'has_error')::boolean THEN 'The last inquiry sync reported an error. Check operations-dispatch logs.'
   WHEN sync->>'last_success' IS NULL THEN 'No successful inquiry sync has been recorded.'
   ELSE 'A successful inquiry sync was recorded. This is not a guarantee of notification or message delivery.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.reservation_connection_health(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_connection_health(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
