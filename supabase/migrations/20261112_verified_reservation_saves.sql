BEGIN;
CREATE SCHEMA IF NOT EXISTS reservation_flow_private;
REVOKE ALL ON SCHEMA reservation_flow_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS reservation_flow_private.requests(
 location_id uuid NOT NULL,request_id uuid NOT NULL,input jsonb NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,request_id)
);
REVOKE ALL ON reservation_flow_private.requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_save_verified(
 p_location_id uuid,p_request_id uuid,p_values jsonb,
 p_fingerprint text,p_assignments jsonb,p_duration integer,
 p_source text DEFAULT NULL,p_inquiry_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE data jsonb;after_data jsonb;args jsonb;prior jsonb;answer jsonb;
 rid uuid;day date;starts numeric;plan jsonb;row jsonb;booking jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Reservation access required.' USING errcode='42501';END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
 OR octet_length(p_values::text)>20000
 OR nullif(btrim(p_values->>'guest_name'),'') IS NULL
 OR nullif(btrim(p_values->>'phone'),'') IS NULL
 OR nullif(p_values->>'reservation_time','') IS NULL
 OR nullif(p_values->>'reservation_date','') IS NULL
 OR (p_values->>'party_size')::integer IS NULL
 OR (p_values->>'party_size')::integer NOT BETWEEN 1 AND 500
 OR p_duration IS NULL OR p_duration NOT BETWEEN 15 AND 480
 THEN RAISE EXCEPTION 'Enter guest name, phone, date, time and 1–500 guests.';END IF;
 IF (p_source IS NULL) IS DISTINCT FROM (p_inquiry_id IS NULL)
 OR (p_source IS NOT NULL AND p_source NOT IN ('Host','Guest form'))
 THEN RAISE EXCEPTION 'Invalid inquiry source.';END IF;
 args:=jsonb_build_object('values',p_values,'duration',p_duration,
 'source',p_source,'inquiry',p_inquiry_id);
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('verified-booking:'||p_location_id::text||':'||p_request_id::text,0));
 SELECT result INTO prior FROM reservation_flow_private.requests
 WHERE location_id=p_location_id AND request_id=p_request_id AND input=args;
 IF FOUND THEN RETURN prior;END IF;
 IF EXISTS(SELECT 1 FROM reservation_flow_private.requests
 WHERE location_id=p_location_id AND request_id=p_request_id)
 THEN RAISE EXCEPTION 'This request already saved different details. Reload before saving.';END IF;
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,
 public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 IF to_regclass('capacity_private.blocks') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.blocks IN SHARE ROW EXCLUSIVE MODE';END IF;
 IF to_regclass('capacity_private.weekdays') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE';END IF;
 day:=(p_values->>'reservation_date')::date;
 data:=public.reservation_capacity_load(p_location_id,day);
 IF data->>'fingerprint' IS DISTINCT FROM p_fingerprint
 THEN RAISE EXCEPTION 'Availability changed. Review the new table suggestion and save again.' USING errcode='40001';END IF;
 IF coalesce((data->>'configured')::boolean,false) IS NOT TRUE
 OR coalesce((data->'config'->>'closed')::boolean,false)
 THEN RAISE EXCEPTION 'Save open service settings for this date first.';END IF;
 SELECT (s->>'value')::numeric INTO starts
 FROM jsonb_array_elements(data->'slots') s
 WHERE to_char(to_timestamp((s->>'value')::numeric*60) AT TIME ZONE 'America/Chicago','HH24:MI')
 =to_char((p_values->>'reservation_time')::time,'HH24:MI') LIMIT 1;
 IF starts IS NULL OR starts<(data->>'now')::numeric
 OR starts+p_duration+(data->'config'->>'buffer')::integer>(data->>'close')::numeric
 THEN RAISE EXCEPTION 'Choose an available future arrival inside the service window.';END IF;
 IF p_source IS NOT NULL THEN
  answer:=public.inquiry_to_reservation(p_location_id,p_source,p_inquiry_id,p_values);
  IF coalesce((answer->>'already_linked')::boolean,false) THEN
   INSERT INTO reservation_flow_private.requests(location_id,request_id,input,result)
   VALUES(p_location_id,p_request_id,args,answer);RETURN answer;
  END IF;
  rid:=(answer->>'reservation_id')::uuid;
 ELSE
  booking:=p_values||jsonb_build_object('organization_id',data->>'organization',
   'location_id',p_location_id,'status','booked','table_ids','[]'::jsonb,
   'table_id',NULL,'table_name',NULL,'imported_source','manual',
   'external_reservation_id','verified:'||p_request_id::text);
  PERFORM public.reservation_submit(p_location_id,jsonb_build_array(booking));
  SELECT id INTO rid FROM public.reservations WHERE location_id=p_location_id
   AND external_reservation_id='verified:'||p_request_id::text;
  IF rid IS NULL THEN RAISE EXCEPTION 'A duplicate booking may already exist. Find it before retrying.';END IF;
  answer:=jsonb_build_object('reservation_id',rid,'reservation_date',day,'already_linked',false);
 END IF;
 IF rid IS NULL THEN RAISE EXCEPTION 'Booking could not be verified.';END IF;
 INSERT INTO capacity_private.lengths VALUES(rid,p_duration)
 ON CONFLICT(reservation_id) DO UPDATE SET minutes=excluded.minutes;
 after_data:=public.reservation_capacity_load(p_location_id,day);
 SELECT b INTO row FROM jsonb_array_elements(after_data->'bookings') b WHERE b->>'id'=rid::text;
 IF row IS NULL OR (row->>'start')::numeric IS DISTINCT FROM starts
 OR (row->>'end')::numeric IS DISTINCT FROM starts+p_duration
 THEN RAISE EXCEPTION 'Saved booking does not match the reviewed service window.';END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'object' OR NOT(p_assignments?'candidate')
 OR p_assignments?rid::text THEN RAISE EXCEPTION 'Invalid reviewed table plan.';END IF;
 plan:=(p_assignments-'candidate')||jsonb_build_object(rid::text,p_assignments->'candidate');
 FOR row IN SELECT value FROM jsonb_array_elements(after_data->'bookings') LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(after_data->'blocks','[]'::jsonb)) b
   WHERE (row->>'start')::numeric<extract(epoch FROM (b->>'ends_at')::timestamptz)/60
   AND extract(epoch FROM (b->>'starts_at')::timestamptz)/60
    <(row->>'end')::numeric+(after_data->'config'->>'buffer')::integer
   AND (b->>'scope'='day' OR EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(b->'tableIds') t
    WHERE (plan->(row->>'id')) ? t.value)))
  THEN RAISE EXCEPTION 'A reviewed table is blocked during this booking. Review availability again.';END IF;
 END LOOP;
 -- Existing capacity validation checks every party, approved joins and overlaps.
 -- Everything, including inquiry conversion, rolls back if validation fails.
 PERFORM public.reservation_capacity_apply(p_location_id,day,after_data->>'fingerprint',plan,NULL);
 answer:=answer||jsonb_build_object('capacity_verified',true,'message_sent',false);
 INSERT INTO reservation_flow_private.requests(location_id,request_id,input,result)
 VALUES(p_location_id,p_request_id,args,answer);
 RETURN answer;
END;
$function$;
REVOKE ALL ON FUNCTION public.reservation_save_verified(uuid,uuid,jsonb,text,jsonb,integer,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_save_verified(uuid,uuid,jsonb,text,jsonb,integer,text,text)
 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
