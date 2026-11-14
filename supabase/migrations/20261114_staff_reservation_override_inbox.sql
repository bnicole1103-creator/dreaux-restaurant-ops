BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS reservation_flow_private;
REVOKE ALL ON SCHEMA reservation_flow_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS reservation_flow_private.overbooking_requests(
 location_id uuid NOT NULL,request_id uuid NOT NULL,input jsonb NOT NULL,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 approved_by uuid NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 result jsonb NOT NULL,PRIMARY KEY(location_id,request_id)
);
ALTER TABLE reservation_flow_private.overbooking_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_flow_private.overbooking_requests FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.reservation_overbook_save(
 p_location_id uuid,p_request_id uuid,p_values jsonb,p_reason text,
 p_source text DEFAULT NULL,p_inquiry_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE args jsonb;prior reservation_flow_private.overbooking_requests;d date;t time;
 data jsonb;starts numeric;org uuid;rid uuid;answer jsonb;booking jsonb;room_name text;normal_exists boolean;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE

 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Active staff reservation access required.' USING errcode='42501';END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
 OR octet_length(p_values::text)>20000 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000
 OR length(btrim(coalesce(p_values->>'guest_name',''))) NOT BETWEEN 1 AND 200
 OR length(btrim(coalesce(p_values->>'phone',''))) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_values->>'email',''))>250
 OR length(coalesce(p_values->>'notes',''))>4500
 OR coalesce((p_values->>'party_size')::integer,0) NOT BETWEEN 1 AND 500
 THEN RAISE EXCEPTION 'Enter valid guest details and an override reason of 10–1,000 characters. Notes maximum: 4,500 characters.';END IF;
 IF (p_source IS NULL) IS DISTINCT FROM (p_inquiry_id IS NULL)
 OR (p_source IS NOT NULL AND p_source NOT IN('Host','Guest form'))
 THEN RAISE EXCEPTION 'Invalid inquiry source.';END IF;
 args:=jsonb_build_object('values',p_values,'reason',btrim(p_reason),'source',p_source,'inquiry',p_inquiry_id);
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('verified-booking:'||p_location_id::text||':'||p_request_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('overbook:'||p_location_id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM reservation_flow_private.overbooking_requests
 WHERE location_id=p_location_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM args THEN RAISE EXCEPTION 'This override request already saved different details. Reopen the form.';END IF;
  RETURN prior.result;
 END IF;
 IF to_regclass('reservation_flow_private.requests') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM reservation_flow_private.requests WHERE location_id=$1 AND request_id=$2)' INTO normal_exists USING p_location_id,p_request_id;
  IF normal_exists THEN RAISE EXCEPTION 'This request already saved a normal reservation. Review the day list before creating another.';END IF;
 END IF;
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,
 public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 IF to_regclass('capacity_private.weekdays') IS NOT NULL THEN EXECUTE 'LOCK TABLE capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE';END IF;
 IF to_regclass('capacity_private.blocks') IS NOT NULL THEN EXECUTE 'LOCK TABLE capacity_private.blocks IN SHARE ROW EXCLUSIVE MODE';END IF;
 d:=nullif(p_values->>'reservation_date','')::date;t:=nullif(p_values->>'reservation_time','')::time;
 IF d IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Choose date and time.';END IF;
 data:=public.reservation_capacity_load(p_location_id,d);
 IF coalesce((data->>'configured')::boolean,false) IS NOT TRUE OR coalesce((data->'config'->>'closed')::boolean,false)
 THEN RAISE EXCEPTION 'Save open service settings first. Capacity override does not reopen closed days.';END IF;
 SELECT (s->>'value')::numeric INTO starts FROM jsonb_array_elements(data->'slots') s
 WHERE to_char(to_timestamp((s->>'value')::numeric*60) AT TIME ZONE 'America/Chicago','HH24:MI')=to_char(t,'HH24:MI') LIMIT 1;
 IF starts IS NULL OR starts<(data->>'now')::numeric OR starts<(data->>'open')::numeric OR starts>(data->>'close')::numeric-15
 THEN RAISE EXCEPTION 'Choose a future arrival on the saved time grid, no later than 15 minutes before close.';END IF;
 IF nullif(p_values->>'room_id','') IS NOT NULL THEN
  SELECT name INTO room_name FROM public.rooms WHERE id=(p_values->>'room_id')::uuid AND location_id=p_location_id AND is_active;
  IF room_name IS NULL THEN RAISE EXCEPTION 'Choose an active room at this location.';END IF;
 ELSE room_name:=nullif(p_values->>'dining_area','');END IF;
 booking:=p_values||jsonb_build_object('notes',concat_ws(E'\n',nullif(p_values->>'notes',''),'⚠ OVERBOOKED — tables pending'),'table_id',NULL,'table_ids','[]'::jsonb,'status','booked','dining_area',room_name);
 IF p_source IS NOT NULL THEN
  answer:=public.inquiry_to_reservation(p_location_id,p_source,p_inquiry_id,booking);
  IF coalesce((answer->>'already_linked')::boolean,false) OR coalesce((answer->>'matched_existing')::boolean,false) THEN RETURN answer;END IF;
  rid:=(answer->>'reservation_id')::uuid;
 ELSE
  SELECT organization_id INTO org FROM public.locations WHERE id=p_location_id;
  booking:=booking||jsonb_build_object('organization_id',org,'location_id',p_location_id,'imported_source','manual','external_reservation_id','overbook:'||p_request_id::text);
  PERFORM public.reservation_submit(p_location_id,jsonb_build_array(booking));
  SELECT id INTO rid FROM public.reservations WHERE location_id=p_location_id AND external_reservation_id='overbook:'||p_request_id::text;
  IF rid IS NULL THEN RAISE EXCEPTION 'A matching booking may already exist. Review the day list before retrying.';END IF;
  answer:=jsonb_build_object('reservation_id',rid,'reservation_date',d,'already_linked',false);
 END IF;
 IF rid IS NULL THEN RAISE EXCEPTION 'Override booking could not be verified.';END IF;
 -- Never attach conflicting tables or mark this booking guest-confirmed.
 UPDATE public.reservations SET table_id=NULL,table_ids='{}'::uuid[] WHERE id=rid AND location_id=p_location_id;
 INSERT INTO capacity_private.lengths(reservation_id,minutes) VALUES(rid,(data->'config'->>'duration')::integer)
 ON CONFLICT(reservation_id) DO UPDATE SET minutes=excluded.minutes;
 answer:=answer||jsonb_build_object('overbooked',true,'capacity_verified',false,'message_sent',false);
 INSERT INTO reservation_flow_private.overbooking_requests(location_id,request_id,input,reservation_id,approved_by,reason,result)
 VALUES(p_location_id,p_request_id,args,rid,auth.uid(),btrim(p_reason),answer);
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(p_location_id,d,auth.uid(),'overbooking override',jsonb_build_object('reservation_id',rid,'reason',btrim(p_reason),'request_id',p_request_id));
 RETURN answer;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_overbook_save(uuid,uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_overbook_save(uuid,uuid,jsonb,text,text,text) TO authenticated;

-- Only active location staff gain inbox access; unrelated page permissions stay intact.
DO $access$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.app_access_allowed(uuid,text,text)'::regprocedure) INTO definition;
 IF position('staff-inquiry-inbox-v1' IN definition)=0 THEN
  IF definition NOT ILIKE '%LANGUAGE plpgsql%' OR definition !~* '\mBEGIN\M'
   OR position('p_location_id' IN definition)=0 OR position('p_page' IN definition)=0 OR position('p_section' IN definition)=0 THEN
   RAISE EXCEPTION 'Export app_access_allowed for merging. No changes applied.';
  END IF;
  definition:=regexp_replace(definition,'\mBEGIN\M',
  'BEGIN /* staff-inquiry-inbox-v1 */
   IF p_page=''guests'' AND p_section IN (''*'',''inbox'') THEN
    RETURN auth.uid() IS NOT NULL AND public.closeout_is_member(p_location_id) IS TRUE;
   END IF;', 'i');
  EXECUTE definition;
 END IF;
END;$access$;
CREATE OR REPLACE FUNCTION public.inquiry_studio_authorize(p_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $auth$
 SELECT auth.uid() IS NOT NULL
 AND public.closeout_is_member(p_location_id) IS TRUE
 AND public.app_access_allowed(p_location_id,'guests','inbox') IS TRUE
 AND EXISTS(SELECT 1 FROM public.locations WHERE id=p_location_id AND is_active
 AND lower(replace(name,'’',''''))='justini''s new orleans');
$auth$;
REVOKE ALL ON FUNCTION public.inquiry_studio_authorize(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inquiry_studio_authorize(uuid) TO authenticated;
-- Remove only known management predicates from inbox read/conversion entry points.
-- Conversion retains all validation, duplicate protection, location and reservation checks.
DO $inquiries$
DECLARE item record;definition text;
BEGIN
 FOR item IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('inquiry_combined_host_load','inquiry_reservation_links','inquiry_archive_list','inquiry_to_reservation') LOOP
  definition:=pg_get_functiondef(item.oid);
  IF position('p_location_id' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected inquiry function %. No changes applied.',item.proname; END IF;
  definition:=regexp_replace(definition,'public\.mod_is_manager\(p_location_id\)',
   '(auth.uid() IS NOT NULL AND public.closeout_is_member(p_location_id) IS TRUE)','gi');
  definition:=replace(definition,'Active Management inquiry and reservation access required.','Active staff inquiry and reservation access required.');
  definition:=replace(definition,'Active Management inquiry access required.','Active staff inquiry access required.');
  -- Keep an explicit access check even for functions with different prior role wording.
  IF definition ILIKE '%LANGUAGE plpgsql%' AND position('staff-inquiry-entry-v1' IN definition)=0 THEN
   definition:=regexp_replace(definition,'\mBEGIN\M',
    'BEGIN /* staff-inquiry-entry-v1 */ IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.app_access_allowed(p_location_id,''guests'',''inbox'') IS NOT TRUE THEN RAISE EXCEPTION ''Active staff inbox access required.'' USING errcode=''42501''; END IF;', 'i');
  ELSIF definition NOT ILIKE '%LANGUAGE plpgsql%' THEN RAISE EXCEPTION 'Export inquiry function % for merging. No changes applied.',item.proname; END IF;
  EXECUTE definition;
 END LOOP;
END;$inquiries$;


CREATE OR REPLACE FUNCTION public.reservation_management_list(
 p_location uuid,p_day date DEFAULT NULL,p_query text DEFAULT '',p_offset integer DEFAULT 0,p_status text DEFAULT 'active'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE q text:=btrim(coalesce(p_query,''));digits text;rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE
 OR public.app_access_allowed(p_location,'floor','reservations') IS NOT TRUE THEN
  RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';
 END IF;
 IF length(q)>120 OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN
  RAISE EXCEPTION 'Use a search up to 120 characters and a valid results page.';
 END IF;
 IF p_status IS NULL OR p_status NOT IN ('active','all','booked','confirmed','arrived','seated','completed','cancelled','no_show') THEN RAISE EXCEPTION 'Choose a valid reservation status.';END IF;
 digits:=CASE WHEN q ~ '^[+(). 0-9-]+$' THEN regexp_replace(q,'[^0-9]','','g') ELSE '' END;
 IF length(digits)=11 AND left(digits,1)='1' THEN digits:=right(digits,10);END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.reservation_date,x.reservation_time,x.id),'[]'::jsonb)
 INTO rows FROM (
  SELECT r.id,r.guest_name,r.reservation_date,r.reservation_time,r.party_size,
   r.phone,r.email,r.notes,r.status,r.edit_version,
   coalesce(to_jsonb(r)->>'occasion','') occasion,
   coalesce((to_jsonb(r)->>'is_birthday')::boolean,false) birthday,
   coalesce((to_jsonb(r)->>'is_vip')::boolean,false) vip
  FROM public.reservations r
  WHERE r.location_id=p_location AND to_jsonb(r)->>'deleted_at' IS NULL
   AND (p_day IS NULL OR r.reservation_date=p_day)
   AND (p_status='all'
    OR p_status='active' AND lower(btrim(coalesce(nullif(r.status,''),'booked'))) IN ('booked','confirmed')
    OR p_status='cancelled' AND lower(btrim(r.status)) IN ('cancelled','canceled')
    OR p_status='no_show' AND regexp_replace(lower(btrim(r.status)),'[ -]+','_','g')='no_show'
    OR p_status='arrived' AND lower(btrim(r.status)) IN ('arrived','partially_arrived')
    OR p_status NOT IN ('active','all','cancelled','no_show','arrived') AND lower(btrim(coalesce(nullif(r.status,''),'booked')))=p_status
   )
   AND (q='' OR (digits<>'' AND strpos(regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'),digits)>0)
    OR NOT EXISTS(SELECT 1 FROM unnest(regexp_split_to_array(lower(q),'[[:space:]]+')) term
     WHERE strpos(lower(concat_ws(' ',r.guest_name,r.email,r.phone,r.reservation_date::text,
      regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'),r.notes,to_jsonb(r)->>'occasion',
      to_jsonb(r)->>'tags',to_jsonb(r)->>'guest_tags',
      CASE WHEN (to_jsonb(r)->>'is_birthday')::boolean THEN 'birthday 🎂' END,
      CASE WHEN (to_jsonb(r)->>'is_vip')::boolean THEN 'vip ⭐' END)),term)=0))
  ORDER BY r.reservation_date,r.reservation_time,r.id LIMIT 51 OFFSET p_offset
 ) x;
 RETURN jsonb_build_object('reservations',coalesce((SELECT jsonb_agg(v ORDER BY ord)
  FROM jsonb_array_elements(rows) WITH ORDINALITY t(v,ord) WHERE ord<=50),'[]'::jsonb),
  'has_more',jsonb_array_length(rows)>50);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_management_list(uuid,date,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_management_list(uuid,date,text,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';


NOTIFY pgrst,'reload schema';
COMMIT;
