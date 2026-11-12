BEGIN;
SET LOCAL lock_timeout='5s';
DO $check$
BEGIN
 IF to_regprocedure('public.reservation_confirmation_access(uuid)') IS NULL
 OR to_regprocedure('public.reservation_confirmation_preview(uuid,text)') IS NULL
 OR to_regprocedure('public.reservation_confirmation_claim(uuid,text,jsonb,text)') IS NULL
 THEN RAISE EXCEPTION 'Install the existing reservation confirmation backend first. No changes applied.';END IF;
END;
$check$;
CREATE SCHEMA IF NOT EXISTS reservation_consent_private;
REVOKE ALL ON SCHEMA reservation_consent_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS reservation_consent_private.settings(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 support_email text NOT NULL, support_phone text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservation_consent_private.links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 snapshot text NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,
 responded_at timestamptz,booking_confirmed boolean NOT NULL DEFAULT false,
 sms_opt_in boolean NOT NULL DEFAULT false,email_opt_in boolean NOT NULL DEFAULT false,
 consent_version text NOT NULL DEFAULT '2026-11-04-v1'
);
ALTER TABLE reservation_consent_private.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_consent_private.links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA reservation_consent_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS reservation_consent_private.evidence(
 link_id uuid PRIMARY KEY REFERENCES reservation_consent_private.links(id),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version text NOT NULL,method text NOT NULL,phone text,email text,
 sms_selected boolean NOT NULL,email_selected boolean NOT NULL,booking_selected boolean NOT NULL,
 sms_disclosure text NOT NULL,email_disclosure text NOT NULL,
 policy_url text NOT NULL,terms_url text NOT NULL,source_url text NOT NULL,
 support_email text NOT NULL,support_phone text NOT NULL
);
ALTER TABLE reservation_consent_private.evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_consent_private.evidence FROM PUBLIC,anon,authenticated;
-- Preserve existing support contacts; staff must configure missing contact details.
CREATE OR REPLACE FUNCTION public.reservation_policy_contact()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('email',support_email,'phone',support_phone,
 'version','2026-11-06-reservation-sms-v2','ready',nullif(btrim(support_email),'') IS NOT NULL AND nullif(btrim(support_phone),'') IS NOT NULL) FROM reservation_consent_private.settings WHERE singleton),
 '{"ready":false,"version":"2026-11-06-reservation-sms-v2"}'::jsonb);
$$;
CREATE OR REPLACE FUNCTION public.reservation_policy_contact_save(p_location uuid,p_email text,p_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.reservation_confirmation_access(p_location);
 IF length(p_email)>320 OR p_email IS NULL OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR nullif(btrim(p_phone),'') IS NULL OR length(p_phone)>100 THEN RAISE EXCEPTION 'Enter the approved public support email and phone.';END IF;
 INSERT INTO reservation_consent_private.settings VALUES(true,btrim(p_email),btrim(p_phone),now())
 ON CONFLICT(singleton) DO UPDATE SET support_email=excluded.support_email,support_phone=excluded.support_phone,updated_at=now();
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_consent_snapshot(p_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(r.guest_name,r.location_id,r.reservation_date,r.reservation_time,
 r.party_size,r.phone,r.email,r.status,r.dining_area,to_jsonb(r)->>'deleted_at')::text,'UTF8')),'hex')
 FROM public.reservations r WHERE r.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.reservation_guest_link_create(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations%rowtype;t text;expiry timestamptz;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 PERFORM public.reservation_confirmation_access(r.location_id);
 IF NOT EXISTS(SELECT 1 FROM reservation_consent_private.settings) THEN RAISE EXCEPTION 'Set the approved public support contact first.';END IF;
 expiry:=least(now()+interval '7 days',(r.reservation_date+r.reservation_time::time) AT TIME ZONE 'America/Chicago');
 IF r.reservation_date IS NULL OR r.reservation_time IS NULL OR r.party_size IS NULL OR r.party_size<1
 OR expiry<=now() OR lower(coalesce(r.status,'')) NOT IN('booked','confirmed')
 OR to_jsonb(r)->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'Complete the active future booking before requesting confirmation.';END IF;
 t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 UPDATE reservation_consent_private.links SET revoked_at=now() WHERE reservation_id=p_id AND revoked_at IS NULL;
 INSERT INTO reservation_consent_private.links(token_hash,reservation_id,snapshot,created_by,expires_at,consent_version)
 VALUES(encode(sha256(convert_to(t,'UTF8')),'hex'),p_id,public.reservation_consent_snapshot(p_id),auth.uid(),expiry,'2026-11-06-reservation-sms-v2');
 RETURN jsonb_build_object('token',t,'expires_at',expiry);
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_guest_link_load(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l reservation_consent_private.links%rowtype;r public.reservations%rowtype;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Link unavailable or expired. Ask the restaurant for a new link.';END IF;
 SELECT * INTO l FROM reservation_consent_private.links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at<=now()
 OR l.snapshot IS DISTINCT FROM public.reservation_consent_snapshot(l.reservation_id)
 THEN RAISE EXCEPTION 'Link unavailable or expired. Ask the restaurant for a new link.';END IF;
 SELECT * INTO r FROM public.reservations WHERE id=l.reservation_id;
 RETURN jsonb_build_object('date',r.reservation_date,'time',r.reservation_time,'guests',r.party_size,
 'room',r.dining_area,'phone_hint',right(regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'),4),
 'has_email',nullif(btrim(r.email),'') IS NOT NULL,'has_phone',nullif(btrim(r.phone),'') IS NOT NULL,
 'saved_version',l.consent_version,'responded_at',l.responded_at,'booking_confirmed',l.booking_confirmed,'sms_opt_in',l.sms_opt_in,'email_opt_in',l.email_opt_in);
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_guest_link_respond_v2(p_token text,p_booking boolean,p_sms boolean,p_email boolean,p_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l reservation_consent_private.links%rowtype;r public.reservations%rowtype;info jsonb;contact reservation_consent_private.settings%rowtype;rid uuid;
BEGIN
 IF p_version IS DISTINCT FROM '2026-11-06-reservation-sms-v2' THEN RAISE EXCEPTION 'The consent wording changed. Refresh this page before submitting.';END IF;
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Link unavailable or expired.';END IF;
 SELECT reservation_id INTO rid FROM reservation_consent_private.links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT * INTO r FROM public.reservations WHERE id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link unavailable or expired.';END IF;
 SELECT * INTO l FROM reservation_consent_private.links WHERE reservation_id=rid AND token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 info:=public.reservation_guest_link_load(p_token);
 IF l.responded_at IS NOT NULL THEN RETURN info;END IF;
 SELECT * INTO contact FROM reservation_consent_private.settings WHERE singleton;
 IF NOT FOUND THEN RAISE EXCEPTION 'Messaging enrollment is unavailable. Contact the restaurant.';END IF;
 IF p_sms IS TRUE AND (info->>'has_phone')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Contact the restaurant to add your phone.';END IF;
 IF p_email IS TRUE AND (info->>'has_email')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Contact the restaurant to add your email.';END IF;
 INSERT INTO reservation_consent_private.evidence(link_id,reservation_id,version,method,phone,email,sms_selected,email_selected,booking_selected,sms_disclosure,email_disclosure,policy_url,terms_url,source_url,support_email,support_phone)
 VALUES(l.id,r.id,'2026-11-06-reservation-sms-v2','reservation_link_web_form',r.phone,r.email,coalesce(p_sms,false),coalesce(p_email,false),coalesce(p_booking,false),'I agree to receive automated reservation confirmation text messages from JusTini’s New Orleans at the phone number on this booking. Up to one initial confirmation per reservation. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is optional and is not a condition of purchase or booking. No marketing messages are included.','I agree to receive a reservation confirmation by email at the address on this booking. No marketing emails are included. I can withdraw permission by contacting JusTini’s.','https://justinis-nola.vercel.app/privacy','https://justinis-nola.vercel.app/messaging-terms','https://justinis-nola.vercel.app/reservation-confirmation',contact.support_email,contact.support_phone);
 UPDATE reservation_consent_private.links SET responded_at=clock_timestamp(),booking_confirmed=coalesce(p_booking,false),sms_opt_in=coalesce(p_sms,false),email_opt_in=coalesce(p_email,false),consent_version='2026-11-06-reservation-sms-v2' WHERE id=l.id;
 RETURN public.reservation_guest_link_load(p_token);
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_guest_link_respond(p_token text,p_booking boolean,p_sms boolean,p_email boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Refresh the guest confirmation page to review the current consent wording.';END;$$;
CREATE OR REPLACE FUNCTION public.reservation_guest_link_status(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid;result jsonb;
BEGIN
 SELECT location_id INTO loc FROM public.reservations WHERE id=p_id;
 IF loc IS NULL THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 PERFORM public.reservation_confirmation_access(loc);
 SELECT jsonb_build_object('expires_at',expires_at,'responded_at',responded_at,
 'booking_confirmed',booking_confirmed,'sms_opt_in',sms_opt_in,'email_opt_in',email_opt_in,
 'valid',revoked_at IS NULL AND expires_at>now() AND snapshot=public.reservation_consent_snapshot(p_id),
 'evidence',(SELECT jsonb_build_object('recorded_at',e.recorded_at,'version',e.version,'method',e.method,'sms_selected',e.sms_selected,'email_selected',e.email_selected,'sms_disclosure',e.sms_disclosure,'policy_url',e.policy_url,'terms_url',e.terms_url) FROM reservation_consent_private.evidence e WHERE e.link_id=links.id))
 INTO result FROM reservation_consent_private.links WHERE reservation_id=p_id ORDER BY created_at DESC LIMIT 1;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_guest_link_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_guest_link_status(uuid) TO authenticated;
-- Include privacy terms and the opt-in acknowledgement in new messages.
DO $$ BEGIN
 IF to_regprocedure('public.reservation_confirmation_preview_original(uuid,text)') IS NULL THEN
  ALTER FUNCTION public.reservation_confirmation_preview(uuid,text) RENAME TO reservation_confirmation_preview_original;
 END IF;
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_confirmation_preview(p_id uuid,p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.reservation_confirmation_preview_original(p_id,p_channel);
 IF result->'history'='null'::jsonb THEN
  result:=jsonb_set(result,'{body}',to_jsonb((result->>'body')||
   CASE WHEN p_channel='sms' THEN ' You opted in to this text confirmation. Up to one initial confirmation per reservation. Message and data rates may apply. Reply HELP for help.' ELSE '' END||
   ' Privacy: https://justinis-nola.vercel.app/privacy Terms: https://justinis-nola.vercel.app/messaging-terms'));
 END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_confirmation_preview_original(uuid,text),public.reservation_confirmation_preview(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_confirmation_preview(uuid,text) TO authenticated;
-- Keep the earlier sender's interface while requiring recorded guest consent.
DO $$ BEGIN
 IF to_regprocedure('public.reservation_confirmation_claim_original(uuid,text,jsonb,text)') IS NULL THEN
  ALTER FUNCTION public.reservation_confirmation_claim(uuid,text,jsonb,text) RENAME TO reservation_confirmation_claim_original;
 END IF;
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_confirmation_claim(p_id uuid,p_channel text,p_expected jsonb,p_consent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations%rowtype;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 PERFORM public.reservation_confirmation_access(r.location_id);
 IF NOT EXISTS(SELECT 1 FROM reservation_consent_private.links l JOIN reservation_consent_private.evidence e ON e.link_id=l.id AND e.version='2026-11-06-reservation-sms-v2' WHERE l.reservation_id=p_id
 AND l.revoked_at IS NULL AND l.expires_at>now() AND l.responded_at IS NOT NULL AND l.booking_confirmed AND e.booking_selected
 AND l.snapshot=public.reservation_consent_snapshot(p_id)
 AND ((p_channel='sms' AND l.sms_opt_in AND e.sms_selected) OR (p_channel='email' AND l.email_opt_in AND e.email_selected)))
 THEN RAISE EXCEPTION 'Guest confirmation and recorded opt-in are required for this channel. Generate and share the guest confirmation link first.';END IF;
 RETURN public.reservation_confirmation_claim_original(p_id,p_channel,p_expected,p_consent);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_policy_contact(),public.reservation_policy_contact_save(uuid,text,text),
 public.reservation_consent_snapshot(uuid),public.reservation_guest_link_create(uuid),public.reservation_guest_link_load(text),
 public.reservation_guest_link_respond(text,boolean,boolean,boolean),public.reservation_confirmation_claim(uuid,text,jsonb,text),
 public.reservation_confirmation_claim_original(uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_policy_contact(),public.reservation_guest_link_load(text),
 public.reservation_guest_link_respond(text,boolean,boolean,boolean) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_policy_contact_save(uuid,text,text),public.reservation_guest_link_create(uuid),
 public.reservation_confirmation_claim(uuid,text,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reservation_guest_link_respond(text,boolean,boolean,boolean),public.reservation_guest_link_respond_v2(text,boolean,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_guest_link_respond_v2(text,boolean,boolean,boolean,text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
