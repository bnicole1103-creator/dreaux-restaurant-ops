BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.reservation_submit(uuid,jsonb)') IS NULL
 OR to_regclass('public.reservation_inquiries') IS NULL THEN
  RAISE EXCEPTION 'Install reservation phone/room submission and host inquiry prerequisites first. No changes applied.';
 END IF;
END;$$;
CREATE SCHEMA IF NOT EXISTS inquiry_booking_private;
REVOKE ALL ON SCHEMA inquiry_booking_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS inquiry_booking_private.links(
 location_id uuid NOT NULL REFERENCES public.locations(id),
 source text NOT NULL CHECK(source IN('Host','Guest form')),
 inquiry_id text NOT NULL,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 source_snapshot jsonb NOT NULL,
 PRIMARY KEY(location_id,source,inquiry_id)
);
ALTER TABLE inquiry_booking_private.links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inquiry_booking_private.links FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.inquiry_to_reservation(p_location_id uuid,p_source text,p_inquiry_id text,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;rid uuid;existing public.reservations%rowtype;payload jsonb;summary jsonb;ext text;room_name text;d date;t time;party integer;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.mod_is_manager(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'guests','inbox') IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE THEN
  RAISE EXCEPTION 'Active Management inquiry and reservation access required.' USING errcode='42501';
 END IF;
 IF p_source IS NULL OR p_source NOT IN('Host','Guest form') OR nullif(btrim(p_inquiry_id),'') IS NULL OR length(p_inquiry_id)>200 THEN RAISE EXCEPTION 'Choose a valid inquiry.';END IF;
 IF p_source='Host' AND NOT EXISTS(SELECT 1 FROM public.reservation_inquiries WHERE id::text=p_inquiry_id AND location_id=p_location_id) THEN RAISE EXCEPTION 'Inquiry unavailable at this location.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inquiry-booking:'||p_location_id::text||':'||p_source||':'||p_inquiry_id,0));
 SELECT reservation_id INTO rid FROM inquiry_booking_private.links WHERE location_id=p_location_id AND source=p_source AND inquiry_id=p_inquiry_id;
 IF rid IS NOT NULL THEN
  SELECT * INTO existing FROM public.reservations WHERE id=rid AND location_id=p_location_id;
  IF existing.id IS NULL OR to_jsonb(existing)->>'deleted_at' IS NOT NULL OR lower(coalesce(existing.status,'')) IN('cancelled','canceled','removed') THEN RAISE EXCEPTION 'The linked reservation was removed or cancelled. Review reservation history instead of creating a duplicate.';END IF;
  RETURN jsonb_build_object('reservation_id',existing.id,'reservation_date',existing.reservation_date,'already_linked',true);
 END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR pg_column_size(p_values)>25000 THEN RAISE EXCEPTION 'Invalid reservation details.';END IF;
 IF nullif(btrim(p_values->>'phone'),'') IS NULL THEN RAISE EXCEPTION 'Phone number is required.';END IF;
 IF length(coalesce(p_values->>'notes',''))>5000 OR length(coalesce(p_values->>'email',''))>320 THEN RAISE EXCEPTION 'Reservation text is too long.';END IF;
 d:=nullif(p_values->>'reservation_date','')::date;
 IF d IS NULL THEN RAISE EXCEPTION 'Choose the reservation date.';END IF;
 t:=nullif(p_values->>'reservation_time','')::time;
 party:=nullif(p_values->>'party_size','')::integer;
 IF party IS NOT NULL AND party NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Party size must be between 1 and 500.';END IF;
 IF nullif(p_values->>'room_id','') IS NOT NULL THEN
  SELECT name INTO room_name FROM public.rooms WHERE id=(p_values->>'room_id')::uuid AND location_id=p_location_id AND is_active;
  IF room_name IS NULL THEN RAISE EXCEPTION 'Choose an active room at this location.';END IF;
 END IF;
 SELECT organization_id INTO org FROM public.locations WHERE id=p_location_id;
 ext:='inquiry:'||p_source||':'||p_inquiry_id;
 payload:=jsonb_build_object('organization_id',org,'location_id',p_location_id,'guest_name',coalesce(nullif(btrim(p_values->>'guest_name'),''),'Guest — name pending'),'phone',btrim(p_values->>'phone'),'email',nullif(btrim(p_values->>'email'),''),'party_size',party,'reservation_date',d,'reservation_time',t,'dining_area',room_name,'notes',concat_ws(E'\n',nullif(p_values->>'notes',''),'Inquiry reference: '||p_source||' / '||p_inquiry_id),'imported_source','manual','status','booked','external_reservation_id',ext);
 summary:=public.reservation_submit(p_location_id,jsonb_build_array(payload));
 SELECT * INTO existing FROM public.reservations r WHERE r.location_id=p_location_id AND (
 r.external_reservation_id=ext OR
 (r.reservation_date=d AND public.reservation_time_key(r.reservation_time::text)=coalesce(t::text,'')
 AND public.reservation_normalize(r.guest_name)=public.reservation_normalize(payload->>'guest_name')
 AND r.party_size IS NOT DISTINCT FROM party
 AND NOT(nullif(btrim(r.external_reservation_id),'') IS NOT NULL AND r.external_reservation_id<>ext)
 AND NOT(nullif(btrim(r.email),'') IS NOT NULL AND nullif(btrim(payload->>'email'),'') IS NOT NULL AND lower(btrim(r.email))<>lower(btrim(payload->>'email')))
 AND NOT(nullif(regexp_replace(coalesce(r.phone,''),'\D','','g'),'') IS NOT NULL AND right(regexp_replace(r.phone,'\D','','g'),10)<>right(regexp_replace(payload->>'phone','\D','','g'),10)))
 ) ORDER BY (r.external_reservation_id=ext) DESC NULLS LAST,r.id LIMIT 1;
 IF existing.id IS NULL THEN RAISE EXCEPTION 'Reservation could not be linked. No conversion was saved.';END IF;
 IF to_jsonb(existing)->>'deleted_at' IS NOT NULL OR lower(coalesce(existing.status,'')) IN('cancelled','canceled','removed') THEN RAISE EXCEPTION 'A matching reservation was previously removed. Review reservation history first.';END IF;
 INSERT INTO inquiry_booking_private.links(location_id,source,inquiry_id,reservation_id,created_by,source_snapshot)
 VALUES(p_location_id,p_source,p_inquiry_id,existing.id,auth.uid(),p_values);
 RETURN jsonb_build_object('reservation_id',existing.id,'reservation_date',existing.reservation_date,'already_linked',false,'matched_existing',coalesce((summary->>'duplicates')::integer,0)>0);
END;$$;
REVOKE ALL ON FUNCTION public.inquiry_to_reservation(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_to_reservation(uuid,text,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.inquiry_reservation_links(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.mod_is_manager(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'guests','inbox') IS NOT TRUE THEN
  RAISE EXCEPTION 'Active Management inquiry access required.' USING errcode='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('source',l.source,'inquiry_id',l.inquiry_id,'reservation_id',r.id,'reservation_date',r.reservation_date))
 FROM inquiry_booking_private.links l JOIN public.reservations r ON r.id=l.reservation_id AND r.location_id=l.location_id
 WHERE l.location_id=p_location_id),'[]'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.inquiry_reservation_links(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_reservation_links(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
