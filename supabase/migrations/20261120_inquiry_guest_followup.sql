BEGIN;

CREATE TABLE IF NOT EXISTS inquiry_booking_private.guest_followups (
 location_id uuid NOT NULL REFERENCES public.locations(id),
 source text NOT NULL CHECK (source IN ('Host', 'Guest form')),
 inquiry_id text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 original_day date NOT NULL,
 original_time time,
 party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 500),
 guest_name text NOT NULL,
 phone text NOT NULL,
 email text NOT NULL,
 details jsonb NOT NULL,
 has_arrivals boolean NOT NULL,
 request_kind text CHECK (request_kind IN ('date', 'waitlist')),
 requested_day date,
 requested_time time,
 received_at timestamptz,
 PRIMARY KEY (location_id, source, inquiry_id)
);
ALTER TABLE inquiry_booking_private.guest_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inquiry_booking_private.guest_followups FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS guest_followups_received
 ON inquiry_booking_private.guest_followups (location_id, requested_day, received_at)
 WHERE received_at IS NOT NULL;

-- The original guest RPC also serves links shared before this migration.
CREATE OR REPLACE FUNCTION inquiry_booking_private.guard_arrival_followup()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.selected_arrival IS DISTINCT FROM OLD.selected_arrival
  AND EXISTS(SELECT 1 FROM inquiry_booking_private.guest_followups
   WHERE token_hash=NEW.token_hash AND received_at IS NOT NULL)
 THEN RAISE EXCEPTION 'A follow-up request was already received for this link.'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION inquiry_booking_private.guard_arrival_followup() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_arrival_followup ON inquiry_booking_private.arrival_offers;
CREATE TRIGGER guard_arrival_followup BEFORE UPDATE OF selected_arrival ON inquiry_booking_private.arrival_offers
 FOR EACH ROW EXECUTE FUNCTION inquiry_booking_private.guard_arrival_followup();

CREATE OR REPLACE FUNCTION public.inquiry_guest_followup_create(
 p_location uuid, p_source text, p_inquiry text, p_day date, p_party integer,
 p_minutes bigint[], p_fingerprint text, p_contact jsonb, p_replace boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 token text;
 slots integer := coalesce(cardinality(p_minutes), 0);
 today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF public.app_access_allowed(p_location,'guests','inbox') IS NOT TRUE THEN
  RAISE EXCEPTION 'Inquiry access required.' USING ERRCODE='42501';
 END IF;
 IF p_source IS NULL OR p_source NOT IN ('Host','Guest form')
  OR coalesce(length(btrim(p_inquiry)),0) NOT BETWEEN 1 AND 200
  OR p_day IS NULL OR p_day NOT BETWEEN today AND today+366
  OR p_party IS NULL OR p_party NOT BETWEEN 1 AND 500
  OR slots > 3 OR jsonb_typeof(p_contact) IS DISTINCT FROM 'object' OR pg_column_size(p_contact)>16000
  OR jsonb_typeof(p_contact->'details') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Choose a valid inquiry.'; END IF;
 IF p_source='Host' AND NOT EXISTS(SELECT 1 FROM public.reservation_inquiries i WHERE i.id::text=p_inquiry AND i.location_id=p_location)
 THEN RAISE EXCEPTION 'Inquiry unavailable.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inquiry-booking:'||p_location::text||':'||p_source||':'||p_inquiry,0));
 IF EXISTS(SELECT 1 FROM inquiry_booking_private.links WHERE location_id=p_location AND source=p_source AND inquiry_id=p_inquiry)
 THEN RAISE EXCEPTION 'This inquiry is already booked.'; END IF;
 IF slots>0 THEN
  token:=public.inquiry_arrival_offer_create(p_location,p_source,p_inquiry,p_day,p_party,p_minutes,p_fingerprint,p_replace);
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('arrival-offer:'||p_location::text||':'||p_source||':'||p_inquiry,0));
  IF p_replace IS NOT TRUE AND EXISTS(SELECT 1 FROM inquiry_booking_private.arrival_offers
   WHERE location_id=p_location AND source=p_source AND inquiry_id=p_inquiry AND revoked_at IS NULL AND selected_arrival>now())
  THEN RAISE EXCEPTION 'The guest already selected an arrival time. Review their selection first.'; END IF;
  UPDATE inquiry_booking_private.arrival_offers SET revoked_at=now()
   WHERE location_id=p_location AND source=p_source AND inquiry_id=p_inquiry AND revoked_at IS NULL;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 END IF;
 INSERT INTO inquiry_booking_private.guest_followups
 (location_id,source,inquiry_id,token_hash,expires_at,original_day,original_time,party_size,guest_name,phone,email,details,has_arrivals)
 VALUES(p_location,p_source,p_inquiry,encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '7 days',
 p_day,nullif(p_contact->>'time','')::time,p_party,left(coalesce(p_contact->>'name',''),200),
 left(coalesce(p_contact->>'phone',''),100),left(coalesce(p_contact->>'email',''),320),p_contact->'details',slots>0)
 ON CONFLICT (location_id,source,inquiry_id) DO UPDATE SET
 token_hash=excluded.token_hash, expires_at=excluded.expires_at, original_day=excluded.original_day,
 original_time=excluded.original_time, party_size=excluded.party_size, has_arrivals=excluded.has_arrivals,
 guest_name=CASE WHEN guest_followups.received_at IS NULL THEN excluded.guest_name ELSE guest_followups.guest_name END,
 phone=CASE WHEN guest_followups.received_at IS NULL THEN excluded.phone ELSE guest_followups.phone END,
 email=excluded.email, details=excluded.details;
 RETURN token;
END;
$$;

CREATE OR REPLACE FUNCTION public.inquiry_guest_followup(
 p_token text, p_action text DEFAULT NULL, p_day date DEFAULT NULL, p_time time DEFAULT NULL,
 p_name text DEFAULT NULL, p_phone text DEFAULT NULL, p_arrival timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 item inquiry_booking_private.guest_followups;
 opening jsonb;
 today date := (now() AT TIME ZONE 'America/Chicago')::date;
 booked boolean;
 digest text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'This link is unavailable.'; END IF;
 digest:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT * INTO item FROM inquiry_booking_private.guest_followups WHERE token_hash=digest;
 IF NOT FOUND THEN
  IF p_action IS NOT NULL AND p_action<>'arrival' THEN RAISE EXCEPTION 'This link is unavailable.'; END IF;
  RETURN public.inquiry_arrival_offer_guest(p_token,p_arrival);
 END IF;
 IF item.expires_at<=now() THEN RAISE EXCEPTION 'This link has expired.'; END IF;
 IF p_action IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('inquiry-booking:'||item.location_id::text||':'||item.source||':'||item.inquiry_id,0));
  SELECT * INTO item FROM inquiry_booking_private.guest_followups WHERE token_hash=digest AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This link is unavailable.'; END IF;
 END IF;
 SELECT EXISTS(SELECT 1 FROM inquiry_booking_private.links WHERE location_id=item.location_id AND source=item.source AND inquiry_id=item.inquiry_id) INTO booked;
 IF NOT booked AND item.request_kind IS NULL AND item.has_arrivals THEN
  opening:=public.inquiry_arrival_offer_guest(p_token,CASE WHEN p_action='arrival' THEN p_arrival END);
 END IF;
 IF NOT booked AND item.request_kind IS NULL AND opening->>'selected' IS NULL AND p_action IN ('waitlist','date') THEN
  IF p_day IS NULL OR p_day NOT BETWEEN today AND today+366 OR p_time IS NULL
   OR (p_day+p_time) AT TIME ZONE 'America/Chicago' <= clock_timestamp()
   OR (p_action='date' AND p_day=item.original_day)
   OR coalesce(length(btrim(p_name)),0) NOT BETWEEN 1 AND 200
   OR coalesce(length(p_phone),0)>100
   OR length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')) NOT BETWEEN 10 AND 15
  THEN RAISE EXCEPTION 'Enter a future date and time, your name, and a valid phone number.'; END IF;
  UPDATE inquiry_booking_private.guest_followups SET request_kind=p_action,requested_day=p_day,requested_time=p_time,
   guest_name=btrim(p_name),phone=btrim(p_phone),received_at=now()
   WHERE token_hash=digest RETURNING * INTO item;
 END IF;
 RETURN jsonb_build_object('day',item.original_day,'time',item.original_time,'party',item.party_size,'booked',booked,
  'selected',opening->>'selected','options',coalesce(opening->'options','[]'::jsonb),'can_request',true,
  'request_kind',item.request_kind,'requested_day',item.requested_day,'requested_time',item.requested_time,
  'min_day',today,'max_day',today+366);
END;
$$;

CREATE OR REPLACE FUNCTION public.inquiry_guest_followup_list(p_location uuid,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF public.app_access_allowed(p_location,'guests','inbox') IS NOT TRUE THEN
  RAISE EXCEPTION 'Inquiry access required.' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.received_at)
  FROM (
   SELECT w.source,w.inquiry_id AS id,w.guest_name AS name,w.phone,w.email,w.party_size AS guests,
    w.requested_day AS date,w.requested_time AS time,w.request_kind,w.details,w.received_at,l.reservation_id
   FROM inquiry_booking_private.guest_followups w
   LEFT JOIN inquiry_booking_private.links l USING (location_id,source,inquiry_id)
   WHERE w.location_id=p_location AND w.requested_day=p_day AND w.received_at IS NOT NULL
   ORDER BY w.received_at,w.inquiry_id
  ) f
 ),'[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.inquiry_guest_followup_create(uuid,text,text,date,integer,bigint[],text,jsonb,boolean),
 public.inquiry_guest_followup_list(uuid,date),public.inquiry_guest_followup(text,text,date,time,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_guest_followup_create(uuid,text,text,date,integer,bigint[],text,jsonb,boolean),
 public.inquiry_guest_followup_list(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inquiry_guest_followup(text,text,date,time,text,text,timestamptz) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
