BEGIN;
ALTER TABLE reservation_consent_private.links
 ADD COLUMN IF NOT EXISTS sent_at timestamptz,
 ADD COLUMN IF NOT EXISTS sent_by uuid;

CREATE OR REPLACE FUNCTION public.reservation_staff_link_mark_sent(p_location uuid,p_id uuid,p_token text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved_at timestamptz;
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Open the current confirmation link to record it as sent.';
 END IF;
 PERFORM 1 FROM public.reservations r
 WHERE r.location_id=p_location AND r.id=p_id
 AND to_jsonb(r)->>'deleted_at' IS NULL
 AND lower(coalesce(r.status,'')) IN ('booked','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active reservation unavailable.'; END IF;
 UPDATE reservation_consent_private.links l
 SET sent_at=coalesce(l.sent_at,clock_timestamp()),sent_by=coalesce(l.sent_by,auth.uid())
 WHERE l.reservation_id=p_id AND l.revoked_at IS NULL AND l.expires_at>now()
 AND l.snapshot=public.reservation_consent_snapshot(p_id)
 AND l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 RETURNING l.sent_at INTO saved_at;
 IF saved_at IS NULL THEN RAISE EXCEPTION 'This link expired or was replaced. Open the current link.'; END IF;
 RETURN saved_at;
END;
$$;
REVOKE ALL ON FUNCTION public.reservation_staff_link_mark_sent(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_staff_link_mark_sent(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reservation_confirmation_summaries(p_location uuid,p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.reservation_staff_confirmation_access(p_location);
 IF p_ids IS NULL OR cardinality(p_ids)>250 THEN RAISE EXCEPTION 'Choose at most 250 reservations.';END IF;
 RETURN coalesce((SELECT jsonb_object_agg(r.id,jsonb_build_object(
 'link_sent_at',l.sent_at,
 'booking_confirmed',coalesce(l.booking_confirmed,false),'responded_at',l.responded_at,'expires_at',l.expires_at,
 'valid',coalesce(l.revoked_at IS NULL AND l.expires_at>now() AND l.snapshot=public.reservation_consent_snapshot(r.id),false),
 'confirmation_current',coalesce(l.revoked_at IS NULL AND l.responded_at IS NOT NULL AND l.booking_confirmed
   AND a.booking_snapshot=reservation_consent_private.house_snapshot(to_jsonb(r)),false)
 )) FROM public.reservations r
 LEFT JOIN LATERAL (SELECT * FROM reservation_consent_private.links WHERE reservation_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) l ON true
 LEFT JOIN reservation_consent_private.house_acceptances a ON a.link_id=l.id
 WHERE r.location_id=p_location AND r.id=ANY(p_ids)),'{}'::jsonb);
END;$$;
NOTIFY pgrst,'reload schema';
COMMIT;
