BEGIN;

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS cancellation_cleared_at timestamptz;
ALTER TABLE reservation_consent_private.links ADD COLUMN IF NOT EXISTS guest_canceled_at timestamptz;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_view(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_token ~ '^[0-9a-f]{64}$' AND EXISTS (
  SELECT 1 FROM reservation_consent_private.links l
  JOIN public.reservations r ON r.id=l.reservation_id
  WHERE l.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   AND l.guest_canceled_at IS NOT NULL AND l.revoked_at IS NULL
   AND l.expires_at>clock_timestamp() AND lower(btrim(r.status)) IN ('cancelled','canceled')
 ) THEN
  RETURN jsonb_build_object('canceled',true);
 END IF;

 RETURN public.reservation_guest_link_load(p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_guest_link_cancel(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 rid uuid;
 booking public.reservations%ROWTYPE;
 link reservation_consent_private.links%ROWTYPE;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'This reservation link is unavailable or expired.';
 END IF;
 SELECT reservation_id INTO rid FROM reservation_consent_private.links
 WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');

 -- Match confirmation order so confirmation and cancellation cannot race.
 SELECT * INTO booking FROM public.reservations WHERE id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This reservation link is unavailable or expired.'; END IF;
 SELECT * INTO link FROM reservation_consent_private.links
 WHERE reservation_id=rid AND token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 IF NOT FOUND OR link.revoked_at IS NOT NULL OR link.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'This reservation link is unavailable or expired.';
 END IF;

 IF link.guest_canceled_at IS NOT NULL AND lower(btrim(booking.status)) IN ('cancelled','canceled') THEN
  RETURN jsonb_build_object('canceled',true);
 END IF;

 IF lower(btrim(coalesce(booking.status,''))) NOT IN ('booked','confirmed')
  OR booking.reservation_date IS NULL OR booking.reservation_time IS NULL
  OR (booking.reservation_date+booking.reservation_time::time) AT TIME ZONE 'America/Chicago' <= clock_timestamp()
  OR link.snapshot IS DISTINCT FROM public.reservation_consent_snapshot(rid)
  OR EXISTS (
   SELECT 1 FROM public.floor_seating_history_v1 h
   JOIN public.table_sessions s ON s.id=h.session_id
   WHERE h.location_id=booking.location_id AND h.reservation_id=rid AND s.closed_at IS NULL
  )
 THEN
  RAISE EXCEPTION 'This booking cannot be canceled with this link. Please contact JusTini’s.';
 END IF;

 UPDATE public.reservations SET status='cancelled',cancellation_cleared_at=NULL,
  edit_version=coalesce(edit_version,0)+1 WHERE id=rid;
 -- Keep the old snapshot so this token cannot confirm a canceled reservation.
 UPDATE reservation_consent_private.links SET guest_canceled_at=clock_timestamp() WHERE id=link.id;
 RETURN jsonb_build_object('canceled',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_clear_cancellation(
 p_location_id uuid,p_id uuid,p_version integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM reservation_flow_private.lock_edits(p_location_id);
 UPDATE public.reservations SET cancellation_cleared_at=clock_timestamp(),
  edit_version=coalesce(edit_version,0)+1
 WHERE location_id=p_location_id AND id=p_id AND edit_version=p_version
  AND lower(btrim(status)) IN ('cancelled','canceled') AND cancellation_cleared_at IS NULL;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This reservation changed. Refresh the list and try again.' USING ERRCODE='40001';
 END IF;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 SELECT location_id,reservation_date,auth.uid(),'reservation_cancellation_cleared',
  jsonb_build_object('reservation_id',id)
 FROM public.reservations WHERE id=p_id AND reservation_date IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_guest_link_view(text),public.reservation_guest_link_cancel(text),
 public.reservation_clear_cancellation(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_guest_link_view(text),public.reservation_guest_link_cancel(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_clear_cancellation(uuid,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reservation_management_search_v2(
 p_location uuid,p_day date,p_query text,p_offset integer,p_include_history boolean
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
 digits:=CASE WHEN q ~ '^[+(). 0-9-]+$' THEN regexp_replace(q,'[^0-9]','','g') ELSE '' END;
 IF length(digits)=11 AND left(digits,1)='1' THEN digits:=right(digits,10);END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.reservation_date,x.reservation_time,x.id),'[]'::jsonb)
 INTO rows FROM (
  SELECT r.id,r.guest_name,r.reservation_date,r.reservation_time,r.party_size,
   r.phone,r.email,r.notes,r.status,r.edit_version,r.cancellation_cleared_at,
   coalesce(to_jsonb(r)->>'occasion','') occasion,
   coalesce((to_jsonb(r)->>'is_birthday')::boolean,false) birthday,
   coalesce((to_jsonb(r)->>'is_vip')::boolean,false) vip
  FROM public.reservations r
  WHERE r.location_id=p_location AND to_jsonb(r)->>'deleted_at' IS NULL
   AND (coalesce(p_include_history,false) OR lower(btrim(coalesce(r.status,''))) NOT IN ('seated','cancelled','canceled','completed','no_show','removed','expired')
    OR (lower(btrim(r.status)) IN ('cancelled','canceled') AND r.cancellation_cleared_at IS NULL))
   AND (p_day IS NULL OR r.reservation_date=p_day)
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
REVOKE ALL ON FUNCTION public.reservation_management_search_v2(uuid,date,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_management_search_v2(uuid,date,text,integer,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
