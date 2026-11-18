BEGIN;
CREATE TABLE IF NOT EXISTS reservation_flow_private.planning_requests (
 location_id uuid NOT NULL, request_id uuid NOT NULL, kind text NOT NULL,
 input jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,request_id,kind)
);
REVOKE ALL ON reservation_flow_private.planning_requests FROM PUBLIC,anon,authenticated;

-- Called only inside the locked, authenticated public operations below.
CREATE OR REPLACE FUNCTION reservation_flow_private.release_future_tables(
 p_location uuid,p_data jsonb,p_plan jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE row jsonb; ids jsonb; changes jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid replacement table plan.';
 END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_data->'bookings') LOOP
  ids:=p_plan->(row->>'id');
  IF ids IS NULL OR jsonb_array_length(row->'tableIds')=0 THEN CONTINUE;END IF;
  IF jsonb_typeof(ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid replacement table list.';END IF;
  IF (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(ids)) IS NOT DISTINCT FROM
   (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(row->'tableIds')) THEN CONTINUE;END IF;
  IF coalesce((row->>'live')::boolean,false) OR row->>'start' IS NULL OR (row->>'start')::numeric<(p_data->>'now')::numeric THEN
   RAISE EXCEPTION 'Seated parties and past arrivals cannot be moved by automatic planning.';
  END IF;
  changes:=changes||jsonb_build_array(jsonb_build_object('id',row->>'id','name',row->>'name','from',row->'tableIds','to',ids));
  UPDATE public.reservations SET table_id=NULL,table_ids='{}'::uuid[]
   WHERE id::text=row->>'id' AND location_id=p_location;
 END LOOP;
 RETURN changes;
END $$;
REVOKE ALL ON FUNCTION reservation_flow_private.release_future_tables(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_save_replanned(
 p_location_id uuid,p_request_id uuid,p_values jsonb,p_fingerprint text,
 p_assignments jsonb,p_duration integer,p_source text DEFAULT NULL,p_inquiry_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE data jsonb; changes jsonb; answer jsonb; args jsonb; prior record;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Reservation access required.' USING errcode='42501';END IF;
 args:=jsonb_build_object('values',p_values,'duration',p_duration,'source',p_source,'inquiry',p_inquiry_id);
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('verified-booking:'||p_location_id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM reservation_flow_private.requests WHERE location_id=p_location_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM args THEN RAISE EXCEPTION 'This request already saved different details.';END IF;
  RETURN prior.result;
 END IF;
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,
 public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 data:=public.reservation_capacity_load(p_location_id,(p_values->>'reservation_date')::date);
 IF data->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN
  RAISE EXCEPTION 'Availability changed. Review the latest table plan and save again.' USING errcode='40001';
 END IF;
 BEGIN
  changes:=reservation_flow_private.release_future_tables(p_location_id,data,p_assignments);
  data:=public.reservation_capacity_load(p_location_id,(p_values->>'reservation_date')::date);
  -- Existing save verifies membership, blocks, joins, sizes, every overlap and request retries.
  answer:=public.reservation_save_verified(p_location_id,p_request_id,p_values,data->>'fingerprint',p_assignments,p_duration,p_source,p_inquiry_id);
  IF coalesce((answer->>'already_linked')::boolean,false) THEN
   -- Roll back tentative moves when the inquiry already has its booking.
   RAISE EXCEPTION 'Inquiry already linked' USING errcode='P0LNK';
  END IF;
 EXCEPTION WHEN SQLSTATE 'P0LNK' THEN
  changes:='[]'::jsonb;
  data:=public.reservation_capacity_load(p_location_id,(p_values->>'reservation_date')::date);
  answer:=public.reservation_save_verified(p_location_id,p_request_id,p_values,data->>'fingerprint',p_assignments,p_duration,p_source,p_inquiry_id);
 END;
 answer:=answer||jsonb_build_object('table_changes',changes);
 UPDATE reservation_flow_private.requests r SET result=answer
  WHERE r.location_id=p_location_id AND r.request_id=p_request_id;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(p_location_id,(p_values->>'reservation_date')::date,auth.uid(),'automatic_replan',jsonb_build_object('changes',changes,'request_id',p_request_id));
 RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.floor_seat_replanned(
 p_payload jsonb,p_day date,p_fingerprint text,p_assignments jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid:=(p_payload->>'p_location_id')::uuid;
 request uuid:=(p_payload->>'p_request_id')::uuid; data jsonb; after_data jsonb;
 ids uuid[]; row jsonb; changes jsonb:='[]'; result jsonb; prior record; sid uuid; plan jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(loc) IS NOT TRUE
 OR public.walkin_can_manage(loc) IS NOT TRUE
 OR public.app_access_allowed(loc,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Seating and reservation access required.' USING errcode='42501';END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('floor-seat-request:'||request::text,0));
 SELECT * INTO prior FROM reservation_flow_private.planning_requests
 WHERE location_id=loc AND request_id=request AND kind='seat';
 IF FOUND THEN
  IF prior.input IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'This seating request changed. Reopen the seating form.';END IF;
  RETURN prior.result;
 END IF;
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,
 public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 data:=public.reservation_capacity_load(loc,p_day);
 IF data->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN
  RAISE EXCEPTION 'The floor changed. Review tables and seat again.' USING errcode='40001';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(data->'blocks','[]'::jsonb)) b
  WHERE (data->>'now')::numeric<extract(epoch FROM (b->>'ends_at')::timestamptz)/60
  AND extract(epoch FROM (b->>'starts_at')::timestamptz)/60<(data->>'now')::numeric+(data->'config'->>'duration')::integer+(data->'config'->>'buffer')::integer
  AND (b->>'scope'='day' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'p_table_ids') t WHERE (b->'tableIds') ? t.value)))
 THEN RAISE EXCEPTION 'A selected table is blocked during this seating window.';END IF;
 ids:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'p_table_ids'));
 IF NOT EXISTS(SELECT 1 FROM public.shifts WHERE id::text=p_payload->>'p_shift_id' AND location_id=loc AND shift_date=p_day AND status='open')
 THEN RAISE EXCEPTION 'Open the selected service day before seating.';END IF;
 IF p_assignments IS NOT NULL THEN
  changes:=reservation_flow_private.release_future_tables(loc,data,p_assignments);
 END IF;
 -- Upcoming bookings sharing these physical tables are released before seating.
 -- When a complete fit is unavailable, the booking remains saved with tables pending.
 FOR row IN SELECT value FROM jsonb_array_elements(data->'bookings') LOOP
  IF coalesce((row->>'live')::boolean,false) OR row->>'start' IS NULL
   OR (row->>'start')::numeric<(data->>'now')::numeric
   OR row->>'id'=coalesce(p_payload->>'p_reservation_id','')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(row->'tableIds') t WHERE t.value=ANY(ids::text[]))
  THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(changes) c WHERE c->>'id'=row->>'id') THEN
   changes:=changes||jsonb_build_array(jsonb_build_object('id',row->>'id','name',row->>'name','from',row->'tableIds','to','[]'::jsonb));
  END IF;
  UPDATE public.reservations SET table_id=NULL,table_ids='{}'::uuid[] WHERE id::text=row->>'id' AND location_id=loc;
 END LOOP;
 sid:=public.floor_seat_and_rotate_v1(loc,(p_payload->>'p_shift_id')::uuid,ids,
  (p_payload->>'p_server_id')::uuid,p_payload->>'p_guest_name',p_payload->>'p_guest_phone',
  p_payload->>'p_guest_email',(p_payload->>'p_party_size')::integer,request,
  p_payload->>'p_source',(p_payload->>'p_reservation_id')::uuid,
  (p_payload->>'p_walkin_id')::uuid,(p_payload->>'p_walkin_version')::integer);
 IF p_assignments IS NOT NULL THEN
  after_data:=public.reservation_capacity_load(loc,p_day);
  plan:=(p_assignments-'seating-candidate'-coalesce(p_payload->>'p_reservation_id',''))||jsonb_build_object('live:'||sid::text,to_jsonb(ids));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(after_data->'bookings') r CROSS JOIN jsonb_array_elements(coalesce(after_data->'blocks','[]'::jsonb)) b
   WHERE (r->>'start')::numeric<extract(epoch FROM (b->>'ends_at')::timestamptz)/60
   AND extract(epoch FROM (b->>'starts_at')::timestamptz)/60<(r->>'end')::numeric+(after_data->'config'->>'buffer')::integer
   AND (b->>'scope'='day' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(b->'tableIds') t WHERE (plan->(r->>'id')) ? t.value)))
  THEN RAISE EXCEPTION 'A replacement table is blocked. Review the plan again.';END IF;
  PERFORM public.reservation_capacity_apply(loc,p_day,after_data->>'fingerprint',plan,NULL);
 END IF;
 result:=jsonb_build_object('session_id',sid,'table_changes',changes,'tables_pending',p_assignments IS NULL AND jsonb_array_length(changes)>0);
 INSERT INTO reservation_flow_private.planning_requests(location_id,request_id,kind,input,result)
 VALUES(loc,request,'seat',p_payload,result);
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(loc,p_day,auth.uid(),'seating_replan',result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reservation_save_replanned(uuid,uuid,jsonb,text,jsonb,integer,text,text),public.floor_seat_replanned(jsonb,date,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_save_replanned(uuid,uuid,jsonb,text,jsonb,integer,text,text),public.floor_seat_replanned(jsonb,date,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
