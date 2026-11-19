BEGIN;
CREATE TABLE IF NOT EXISTS inquiry_booking_private.arrival_offers (
 token_hash text PRIMARY KEY,
 location_id uuid NOT NULL REFERENCES public.locations(id),
 source text NOT NULL CHECK (source IN ('Host','Guest form')),
 inquiry_id text NOT NULL,
 service_day date NOT NULL,
 party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 500),
 arrivals timestamptz[] NOT NULL CHECK (cardinality(arrivals) BETWEEN 1 AND 3),
 capacity_snapshot text NOT NULL,
 created_by uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 selected_at timestamptz,
 selected_arrival timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS arrival_offer_current ON inquiry_booking_private.arrival_offers
 (location_id,source,inquiry_id) WHERE revoked_at IS NULL;
ALTER TABLE inquiry_booking_private.arrival_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inquiry_booking_private.arrival_offers FROM PUBLIC, anon, authenticated;

-- Treat a changed snapshot as stale. The guest never receives floor or booking data.
CREATE OR REPLACE FUNCTION inquiry_booking_private.arrival_snapshot(l uuid,d date) RETURNS text
LANGUAGE sql STABLE SET search_path='' SET TimeZone='UTC' AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(capacity_private.block_config(l,day::date) ORDER BY day)
   FROM generate_series((d-1)::timestamp,(d+1)::timestamp,interval '1 day') day),
  (SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('duration',len.minutes) ORDER BY r.id)
   FROM public.reservations r LEFT JOIN capacity_private.lengths len ON len.reservation_id=r.id
   WHERE r.location_id=l AND r.reservation_date BETWEEN d-1 AND d+1
   AND lower(coalesce(r.status,'')) NOT IN ('cancelled','canceled','removed','completed','departed','no_show','no show')
   AND to_jsonb(r)->>'deleted_at' IS NULL),
  (SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('tables',
     (SELECT jsonb_agg(t.table_id ORDER BY t.table_id) FROM public.table_session_tables t WHERE t.table_session_id=s.id)) ORDER BY s.id)
   FROM public.table_sessions s JOIN public.shifts sh ON sh.id=s.shift_id
   WHERE sh.location_id=l AND s.closed_at IS NULL AND d=(now() AT TIME ZONE 'America/Chicago')::date),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.floor_tables t WHERE t.location_id=l),
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.rooms r WHERE r.location_id=l),
  capacity_private.block_rows(l,(d::timestamp AT TIME ZONE 'America/Chicago'),((d+2)::timestamp AT TIME ZONE 'America/Chicago'))
 )::text);
$$;
REVOKE ALL ON FUNCTION inquiry_booking_private.arrival_snapshot(uuid,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.inquiry_arrival_offer_create(
 p_location uuid,p_source text,p_inquiry text,p_day date,p_party integer,p_minutes bigint[],p_fingerprint text,p_replace boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE capacity jsonb; snapshot text; arrivals timestamptz[]; token text;
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF public.app_access_allowed(p_location,'guests','inbox') IS NOT TRUE THEN
  RAISE EXCEPTION 'Inquiry access required.' USING ERRCODE='42501';
 END IF;
 IF p_source IS NULL OR p_source NOT IN ('Host','Guest form') OR coalesce(length(p_inquiry),0) NOT BETWEEN 1 AND 200
  OR p_day IS NULL OR p_day NOT BETWEEN (now() AT TIME ZONE 'America/Chicago')::date AND (now() AT TIME ZONE 'America/Chicago')::date+366
  OR p_party IS NULL OR p_party NOT BETWEEN 1 AND 500 OR coalesce(cardinality(p_minutes),0) NOT BETWEEN 1 AND 3
  OR EXISTS(SELECT 1 FROM unnest(p_minutes) m WHERE m IS NULL OR m NOT BETWEEN 0 AND 100000000)
  THEN RAISE EXCEPTION 'Choose an inquiry with a valid date, party size and available times.'; END IF;
 IF p_source='Host' AND NOT EXISTS(SELECT 1 FROM public.reservation_inquiries i WHERE i.id::text=p_inquiry AND i.location_id=p_location)
  THEN RAISE EXCEPTION 'Inquiry unavailable.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('arrival-offer:'||p_location::text||':'||p_source||':'||p_inquiry,0));
 IF EXISTS(SELECT 1 FROM inquiry_booking_private.links l WHERE l.location_id=p_location AND l.source=p_source AND l.inquiry_id=p_inquiry)
  THEN RAISE EXCEPTION 'This inquiry is already booked.'; END IF;
 IF p_replace IS NOT TRUE AND EXISTS(SELECT 1 FROM inquiry_booking_private.arrival_offers o WHERE o.location_id=p_location AND o.source=p_source AND o.inquiry_id=p_inquiry
  AND o.revoked_at IS NULL AND o.selected_arrival>now())
  THEN RAISE EXCEPTION 'The guest already selected an arrival time. Review their selection before offering another link.'; END IF;
 snapshot:=inquiry_booking_private.arrival_snapshot(p_location,p_day);
 capacity:=public.reservation_capacity_load(p_location,p_day);
 IF capacity->>'fingerprint' IS DISTINCT FROM p_fingerprint OR snapshot IS DISTINCT FROM inquiry_booking_private.arrival_snapshot(p_location,p_day)
  THEN RAISE EXCEPTION 'Availability changed. Generate the link again.'; END IF;
 IF (capacity->>'configured')::boolean IS NOT TRUE OR (capacity->'config'->>'closed')::boolean IS TRUE
 OR EXISTS (SELECT 1 FROM unnest(p_minutes) m WHERE
   m<=extract(epoch FROM clock_timestamp())/60 OR m>(capacity->>'close')::numeric-15
   OR (to_timestamp(m*60) AT TIME ZONE 'America/Chicago')::date<>p_day
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(capacity->'slots') s WHERE (s->>'value')::numeric=m))
 THEN RAISE EXCEPTION 'One or more arrival options are unavailable.'; END IF;
 SELECT array_agg(DISTINCT to_timestamp(m*60) ORDER BY to_timestamp(m*60)) INTO arrivals FROM unnest(p_minutes) m;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 UPDATE inquiry_booking_private.arrival_offers SET revoked_at=now()
 WHERE location_id=p_location AND source=p_source AND inquiry_id=p_inquiry AND revoked_at IS NULL;
 INSERT INTO inquiry_booking_private.arrival_offers
 (token_hash,location_id,source,inquiry_id,service_day,party_size,arrivals,capacity_snapshot,created_by,expires_at)
 VALUES(encode(sha256(convert_to(token,'UTF8')),'hex'),p_location,p_source,p_inquiry,p_day,p_party,arrivals,snapshot,auth.uid(),
        least(now()+interval '48 hours',arrivals[cardinality(arrivals)]));
 RETURN token;
END;
$$;

CREATE OR REPLACE FUNCTION public.inquiry_arrival_offer_guest(p_token text,p_arrival timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o inquiry_booking_private.arrival_offers; options timestamptz[]; booked boolean;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'This arrival link is unavailable.'; END IF;
 SELECT * INTO o FROM inquiry_booking_private.arrival_offers
 WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This arrival link is unavailable. Please reply to JusTini’s for a new link.'; END IF;
 SELECT EXISTS(SELECT 1 FROM inquiry_booking_private.links l WHERE l.location_id=o.location_id AND l.source=o.source AND l.inquiry_id=o.inquiry_id) INTO booked;
 IF o.selected_arrival IS NULL AND NOT booked THEN
  IF o.expires_at>now() AND o.capacity_snapshot=inquiry_booking_private.arrival_snapshot(o.location_id,o.service_day) THEN
   options:=ARRAY(SELECT a FROM unnest(o.arrivals) a WHERE a>clock_timestamp() ORDER BY a);
  END IF;
  IF p_arrival IS NOT NULL THEN
   IF (p_arrival=ANY(options)) IS NOT TRUE THEN
    RAISE EXCEPTION 'That time is no longer available. Please reply to JusTini’s for new options.';
   END IF;
   UPDATE inquiry_booking_private.arrival_offers SET selected_arrival=p_arrival,selected_at=now() WHERE token_hash=o.token_hash;
   o.selected_arrival:=p_arrival;
  END IF;
 END IF;
 RETURN jsonb_build_object('day',o.service_day,'party',o.party_size,'booked',booked,
  'selected',o.selected_arrival,'options',CASE WHEN o.selected_arrival IS NULL AND NOT booked THEN coalesce(options,'{}'::timestamptz[]) ELSE '{}'::timestamptz[] END);
END;
$$;

CREATE OR REPLACE FUNCTION public.inquiry_arrival_offer_selection(p_location uuid,p_source text,p_inquiry text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF public.app_access_allowed(p_location,'guests','inbox') IS NOT TRUE THEN
  RAISE EXCEPTION 'Inquiry access required.' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT jsonb_build_object('day',o.service_day,'arrival',o.selected_arrival)
 FROM inquiry_booking_private.arrival_offers o
 WHERE o.location_id=p_location AND o.source=p_source AND o.inquiry_id=p_inquiry AND o.revoked_at IS NULL AND o.selected_arrival IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.inquiry_arrival_offer_create(uuid,text,text,date,integer,bigint[],text,boolean),
 public.inquiry_arrival_offer_selection(uuid,text,text),public.inquiry_arrival_offer_guest(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_arrival_offer_create(uuid,text,text,date,integer,bigint[],text,boolean),
 public.inquiry_arrival_offer_selection(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_arrival_offer_guest(text,timestamptz) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
