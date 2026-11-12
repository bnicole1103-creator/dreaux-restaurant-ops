BEGIN;
CREATE TABLE IF NOT EXISTS reservation_consent_private.house_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),location_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 20000),
 published_by uuid NOT NULL,published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS reservation_consent_private.house_policy_current(
 location_id uuid PRIMARY KEY,policy_id uuid NOT NULL
 REFERENCES reservation_consent_private.house_policies(id)
);
CREATE TABLE IF NOT EXISTS reservation_consent_private.link_house_policy(
 link_id uuid PRIMARY KEY REFERENCES reservation_consent_private.links(id),
 policy_id uuid NOT NULL REFERENCES reservation_consent_private.house_policies(id)
);
CREATE TABLE IF NOT EXISTS reservation_consent_private.house_acceptances(
 link_id uuid PRIMARY KEY REFERENCES reservation_consent_private.links(id),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 policy_id uuid NOT NULL REFERENCES reservation_consent_private.house_policies(id),
 booking_snapshot text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 method text NOT NULL DEFAULT 'private_reservation_link',
 acceptance_text text NOT NULL DEFAULT 'I have read and agree to the house rules and reservation policies displayed above.'
);
ALTER TABLE reservation_consent_private.house_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_consent_private.house_policy_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_consent_private.link_house_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_consent_private.house_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_consent_private.house_policies,
 reservation_consent_private.house_policy_current,
 reservation_consent_private.link_house_policy,
 reservation_consent_private.house_acceptances FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION reservation_consent_private.house_snapshot(p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
 p_row->>'guest_name',p_row->>'location_id',p_row->>'reservation_date',
 p_row->>'reservation_time',p_row->>'party_size',p_row->>'phone',p_row->>'email',
 p_row->>'dining_area',p_row->>'deleted_at')::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION reservation_consent_private.house_snapshot(jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_house_policy_get(p_location uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.reservation_confirmation_access(p_location);
 SELECT jsonb_build_object('id',p.id,'title',p.title,'body',p.body,
 'published_at',p.published_at) INTO result
 FROM reservation_consent_private.house_policy_current c
 JOIN reservation_consent_private.house_policies p ON p.id=c.policy_id
 WHERE c.location_id=p_location;
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_house_policy_publish(
 p_location uuid,p_expected uuid,p_title text,p_body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_id uuid;new_id uuid;
BEGIN
 PERFORM public.reservation_confirmation_access(p_location);
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('house-policy:'||p_location::text,0));
 SELECT policy_id INTO current_id FROM reservation_consent_private.house_policy_current
 WHERE location_id=p_location;
 IF current_id IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'House rules changed. Load the published version before saving.';
 END IF;
 IF coalesce(length(btrim(p_title)),0) NOT BETWEEN 1 AND 120
 OR coalesce(length(btrim(p_body)),0) NOT BETWEEN 10 AND 20000 THEN
  RAISE EXCEPTION 'Enter a title and the actual complete house rules.';
 END IF;
 INSERT INTO reservation_consent_private.house_policies(location_id,title,body,published_by)
 VALUES(p_location,btrim(p_title),btrim(p_body),auth.uid()) RETURNING id INTO new_id;
 INSERT INTO reservation_consent_private.house_policy_current(location_id,policy_id)
 VALUES(p_location,new_id) ON CONFLICT(location_id) DO UPDATE SET policy_id=excluded.policy_id;
 RETURN public.reservation_house_policy_get(p_location);
END;$$;

DO $$ BEGIN
 IF to_regprocedure('public.reservation_guest_link_create_before_house_policy(uuid)') IS NULL THEN
  ALTER FUNCTION public.reservation_guest_link_create(uuid)
  RENAME TO reservation_guest_link_create_before_house_policy;
 END IF;
 IF to_regprocedure('public.reservation_guest_link_load_before_house_policy(text)') IS NULL THEN
  ALTER FUNCTION public.reservation_guest_link_load(text)
  RENAME TO reservation_guest_link_load_before_house_policy;
 END IF;
 IF to_regprocedure('public.reservation_guest_link_respond_v2_before_house_policy(text,boolean,boolean,boolean,text)') IS NULL THEN
  ALTER FUNCTION public.reservation_guest_link_respond_v2(text,boolean,boolean,boolean,text)
  RENAME TO reservation_guest_link_respond_v2_before_house_policy;
 END IF;
 IF to_regprocedure('public.reservation_guest_link_status_before_house_policy(uuid)') IS NULL THEN
  ALTER FUNCTION public.reservation_guest_link_status(uuid)
  RENAME TO reservation_guest_link_status_before_house_policy;
 END IF;
 IF to_regprocedure('public.reservation_confirmation_claim_before_house_policy(uuid,text,jsonb,text)') IS NULL THEN
  ALTER FUNCTION public.reservation_confirmation_claim(uuid,text,jsonb,text)
  RENAME TO reservation_confirmation_claim_before_house_policy;
 END IF;
END;$$;
REVOKE ALL ON FUNCTION
 public.reservation_guest_link_create_before_house_policy(uuid),
 public.reservation_guest_link_load_before_house_policy(text),
 public.reservation_guest_link_respond_v2_before_house_policy(text,boolean,boolean,boolean,text),
 public.reservation_guest_link_status_before_house_policy(uuid),
 public.reservation_confirmation_claim_before_house_policy(uuid,text,jsonb,text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_create(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid;pid uuid;result jsonb;lid uuid;
BEGIN
 SELECT location_id INTO loc FROM public.reservations WHERE id=p_id FOR UPDATE;
 IF loc IS NULL THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 PERFORM public.reservation_confirmation_access(loc);
 PERFORM pg_advisory_xact_lock(hashtextextended('house-policy:'||loc::text,0));
 SELECT policy_id INTO pid FROM reservation_consent_private.house_policy_current WHERE location_id=loc;
 IF pid IS NULL THEN RAISE EXCEPTION 'Publish the actual house rules before generating a guest confirmation link.';END IF;
 result:=public.reservation_guest_link_create_before_house_policy(p_id);
 SELECT id INTO lid FROM reservation_consent_private.links
 WHERE token_hash=encode(sha256(convert_to(result->>'token','UTF8')),'hex');
 INSERT INTO reservation_consent_private.link_house_policy(link_id,policy_id) VALUES(lid,pid);
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_load(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;rules jsonb;accepted jsonb;
BEGIN
 result:=public.reservation_guest_link_load_before_house_policy(p_token);
 SELECT jsonb_build_object('id',p.id,'title',p.title,'body',p.body,
 'published_at',p.published_at),
 CASE WHEN a.link_id IS NOT NULL AND a.booking_snapshot=reservation_consent_private.house_snapshot(to_jsonb(r))
 THEN jsonb_build_object('accepted_at',a.accepted_at,'policy_id',a.policy_id) ELSE NULL END
 INTO rules,accepted
 FROM reservation_consent_private.links l
 JOIN public.reservations r ON r.id=l.reservation_id
 JOIN reservation_consent_private.link_house_policy x ON x.link_id=l.id
 JOIN reservation_consent_private.house_policies p ON p.id=x.policy_id
 LEFT JOIN reservation_consent_private.house_acceptances a ON a.link_id=l.id
 WHERE l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 RETURN result||jsonb_build_object('house_rules',rules,'house_acceptance',accepted,
 'policy_accepted',accepted IS NOT NULL,'confirmation_state',
 CASE WHEN accepted IS NOT NULL AND (result->>'booking_confirmed')::boolean
 THEN 'confirmed' ELSE 'awaiting_guest_confirmation' END);
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_respond_v2(
 p_token text,p_booking boolean,p_sms boolean,p_email boolean,p_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Refresh the guest confirmation page to review and accept the house rules.';END;$$;

CREATE OR REPLACE FUNCTION reservation_consent_private.enforce_guest_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE accepted boolean;changed boolean:=false;
BEGIN
 IF lower(coalesce(NEW.status,''))<>'confirmed' THEN RETURN NEW;END IF;
 SELECT EXISTS(SELECT 1 FROM reservation_consent_private.house_acceptances a
 WHERE a.reservation_id=NEW.id AND a.booking_snapshot=reservation_consent_private.house_snapshot(to_jsonb(NEW))) INTO accepted;
 IF TG_OP='UPDATE' THEN
  changed:=reservation_consent_private.house_snapshot(to_jsonb(OLD)) IS DISTINCT FROM
   reservation_consent_private.house_snapshot(to_jsonb(NEW));
  IF lower(coalesce(OLD.status,''))='confirmed' AND NOT changed THEN
   RETURN NEW; -- Existing confirmations are not retrospectively rewritten.
  END IF;
  IF lower(coalesce(OLD.status,''))='confirmed' AND changed AND NOT accepted THEN
   NEW.status:='booked';RETURN NEW;
  END IF;
 END IF;
 IF NOT accepted THEN RAISE EXCEPTION 'The guest must accept the house rules and confirm their reservation first.';END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION reservation_consent_private.enforce_guest_policy()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reservation_required_guest_policy ON public.reservations;
CREATE TRIGGER reservation_required_guest_policy
 BEFORE INSERT OR UPDATE ON public.reservations
 FOR EACH ROW EXECUTE FUNCTION reservation_consent_private.enforce_guest_policy();

CREATE OR REPLACE FUNCTION public.reservation_guest_link_respond_v3(
 p_token text,p_booking boolean,p_accept_rules boolean,
 p_policy_id uuid,p_sms boolean,p_email boolean,p_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rid uuid;r public.reservations%rowtype;l reservation_consent_private.links%rowtype;
 pid uuid;info jsonb;result jsonb;a reservation_consent_private.house_acceptances%rowtype;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Link unavailable or expired.';END IF;
 SELECT reservation_id INTO rid FROM reservation_consent_private.links
 WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT * INTO r FROM public.reservations WHERE id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link unavailable or expired.';END IF;
 SELECT * INTO l FROM reservation_consent_private.links WHERE reservation_id=rid
 AND token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 info:=public.reservation_guest_link_load(p_token);
 SELECT policy_id INTO pid FROM reservation_consent_private.link_house_policy WHERE link_id=l.id;
 IF pid IS NULL THEN RAISE EXCEPTION 'Ask the restaurant for a new link containing the house rules.';END IF;
 IF p_policy_id IS DISTINCT FROM pid OR p_version IS DISTINCT FROM '2026-11-06-reservation-sms-v2'
 THEN RAISE EXCEPTION 'The displayed policies or consent wording changed. Refresh before confirming.';END IF;
 IF p_booking IS DISTINCT FROM true OR p_accept_rules IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Review the details and accept the house rules to confirm. Text and email permission remain optional.';END IF;
 SELECT * INTO a FROM reservation_consent_private.house_acceptances WHERE link_id=l.id;
 IF a.link_id IS NOT NULL THEN
  IF coalesce(p_sms,false) IS DISTINCT FROM l.sms_opt_in OR coalesce(p_email,false) IS DISTINCT FROM l.email_opt_in
  THEN RAISE EXCEPTION 'Your confirmation was already saved. Contact the restaurant to change messaging choices.';END IF;
  RETURN info;
 END IF;
 IF l.responded_at IS NOT NULL THEN RAISE EXCEPTION 'Ask the restaurant for a fresh confirmation link.';END IF;
 INSERT INTO reservation_consent_private.house_acceptances(link_id,reservation_id,policy_id,booking_snapshot)
 VALUES(l.id,r.id,pid,reservation_consent_private.house_snapshot(to_jsonb(r)));
 result:=public.reservation_guest_link_respond_v2_before_house_policy(p_token,true,coalesce(p_sms,false),coalesce(p_email,false),p_version);
 IF to_jsonb(r)?'edit_version' THEN
  EXECUTE 'UPDATE public.reservations SET status=''confirmed'',edit_version=coalesce(edit_version,0)+1 WHERE id=$1' USING r.id;
 ELSE UPDATE public.reservations SET status='confirmed' WHERE id=r.id;END IF;
 UPDATE reservation_consent_private.links SET snapshot=public.reservation_consent_snapshot(r.id) WHERE id=l.id;
 RETURN public.reservation_guest_link_load(p_token);
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_status(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;accepted jsonb;
BEGIN
 result:=public.reservation_guest_link_status_before_house_policy(p_id);
 SELECT jsonb_build_object('accepted_at',a.accepted_at,'policy_id',p.id,
 'title',p.title,'body',p.body,'published_at',p.published_at,
 'method',a.method,'acceptance_text',a.acceptance_text) INTO accepted
 FROM reservation_consent_private.links l JOIN public.reservations r ON r.id=l.reservation_id
 JOIN reservation_consent_private.house_acceptances a ON a.link_id=l.id
 JOIN reservation_consent_private.house_policies p ON p.id=a.policy_id
 WHERE l.reservation_id=p_id AND a.booking_snapshot=reservation_consent_private.house_snapshot(to_jsonb(r))
 AND l.id=(SELECT id FROM reservation_consent_private.links WHERE reservation_id=p_id ORDER BY created_at DESC LIMIT 1);
 RETURN coalesce(result,'{}'::jsonb)||jsonb_build_object('policy_accepted',accepted IS NOT NULL,'house_acceptance',accepted);
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_confirmation_claim(
 p_id uuid,p_channel text,p_expected jsonb,p_consent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb;
BEGIN
 state:=public.reservation_guest_link_status(p_id);
 IF (state->>'policy_accepted')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'The guest must accept the house rules before a final confirmation message can be sent.';END IF;
 RETURN public.reservation_confirmation_claim_before_house_policy(p_id,p_channel,p_expected,p_consent);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_house_policy_get(uuid),
 public.reservation_house_policy_publish(uuid,uuid,text,text),
 public.reservation_guest_link_create(uuid),public.reservation_guest_link_status(uuid),
 public.reservation_confirmation_claim(uuid,text,jsonb,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_house_policy_get(uuid),
 public.reservation_house_policy_publish(uuid,uuid,text,text),
 public.reservation_guest_link_create(uuid),public.reservation_guest_link_status(uuid),
 public.reservation_confirmation_claim(uuid,text,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reservation_guest_link_load(text),
 public.reservation_guest_link_respond_v2(text,boolean,boolean,boolean,text),
 public.reservation_guest_link_respond_v3(text,boolean,boolean,uuid,boolean,boolean,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_guest_link_load(text),
 public.reservation_guest_link_respond_v2(text,boolean,boolean,boolean,text),
 public.reservation_guest_link_respond_v3(text,boolean,boolean,uuid,boolean,boolean,text)
 TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
