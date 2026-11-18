BEGIN;
SET LOCAL lock_timeout='5s';
-- Read/generate capabilities are scoped to active staff. Sending through a provider and
-- editing policies retain their existing, separate permission checks.
CREATE OR REPLACE FUNCTION public.reservation_staff_confirmation_access(p_location uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE
 OR public.app_access_allowed(p_location,'floor','reservations') IS NOT TRUE THEN
  RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_staff_confirmation_access(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_confirmation_summaries(p_location uuid,p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF p_ids IS NULL OR cardinality(p_ids)>250 THEN RAISE EXCEPTION 'Choose at most 250 reservations.';END IF;
 RETURN coalesce((SELECT jsonb_object_agg(r.id,jsonb_build_object(
 'booking_confirmed',coalesce(l.booking_confirmed,false),'responded_at',l.responded_at,'expires_at',l.expires_at,
 'valid',coalesce(l.revoked_at IS NULL AND l.expires_at>now() AND l.snapshot=public.reservation_consent_snapshot(r.id),false),
 'confirmation_current',coalesce(l.revoked_at IS NULL AND l.responded_at IS NOT NULL AND l.booking_confirmed
   AND a.booking_snapshot=reservation_consent_private.house_snapshot(to_jsonb(r)),false)
 )) FROM public.reservations r
 LEFT JOIN LATERAL (SELECT * FROM reservation_consent_private.links WHERE reservation_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) l ON true
 LEFT JOIN reservation_consent_private.house_acceptances a ON a.link_id=l.id
 WHERE r.location_id=p_location AND r.id=ANY(p_ids)),'{}'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_confirmation_summaries(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_confirmation_summaries(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.reservation_staff_link_create(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations%rowtype;t text;expiry timestamptz;pid uuid;lid uuid;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 PERFORM public.reservation_staff_confirmation_access(r.location_id);
 IF NOT EXISTS(SELECT 1 FROM reservation_consent_private.settings) THEN RAISE EXCEPTION 'Set the approved public support contact first.';END IF;
 expiry:=least(now()+interval '7 days',(r.reservation_date+r.reservation_time::time) AT TIME ZONE 'America/Chicago');
 IF r.reservation_date IS NULL OR r.reservation_time IS NULL OR r.party_size IS NULL OR r.party_size<1
 OR expiry<=now() OR lower(coalesce(r.status,'')) NOT IN('booked','confirmed')
 OR to_jsonb(r)->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'Complete the active future booking before requesting confirmation.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('house-policy:'||r.location_id::text,0));
 SELECT policy_id INTO pid FROM reservation_consent_private.house_policy_current WHERE location_id=r.location_id;
 IF pid IS NULL THEN RAISE EXCEPTION 'Publish the house rules before generating a guest link.';END IF;
 t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 UPDATE reservation_consent_private.links SET revoked_at=now() WHERE reservation_id=p_id AND revoked_at IS NULL;
 INSERT INTO reservation_consent_private.links(token_hash,reservation_id,snapshot,created_by,expires_at,consent_version)
 VALUES(encode(sha256(convert_to(t,'UTF8')),'hex'),p_id,public.reservation_consent_snapshot(p_id),auth.uid(),expiry,'2026-11-06-reservation-sms-v2') RETURNING id INTO lid;
 INSERT INTO reservation_consent_private.link_house_policy(link_id,policy_id) VALUES(lid,pid);
 RETURN jsonb_build_object('token',t,'expires_at',expiry);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_staff_link_create(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_staff_link_create(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
