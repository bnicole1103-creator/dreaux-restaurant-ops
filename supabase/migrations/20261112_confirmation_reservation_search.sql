BEGIN;
CREATE OR REPLACE FUNCTION public.reservation_confirmation_search(
 p_location uuid,p_day date DEFAULT NULL,p_query text DEFAULT '',p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q text:=btrim(coalesce(p_query,''));digits text;rows jsonb;
BEGIN
 PERFORM public.reservation_confirmation_access(p_location);
 IF length(q)>120 OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN
  RAISE EXCEPTION 'Use a search of up to 120 characters and a valid results page.';
 END IF;
 digits:=CASE WHEN q ~ '^[+(). 0-9-]+$' THEN regexp_replace(q,'[^0-9]','','g') ELSE '' END;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.reservation_date,x.reservation_time,x.id),'[]'::jsonb)
 INTO rows FROM (
  SELECT r.id,r.guest_name,r.reservation_date,r.reservation_time,r.party_size,r.phone
  FROM public.reservations r
  WHERE r.location_id=p_location
   AND lower(coalesce(r.status,'')) IN ('booked','confirmed')
   AND to_jsonb(r)->>'deleted_at' IS NULL
   AND (p_day IS NULL OR r.reservation_date=p_day)
   AND (q='' OR strpos(lower(coalesce(r.guest_name,'')),lower(q))>0
    OR (digits<>'' AND strpos(regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'),digits)>0))
  ORDER BY r.reservation_date,r.reservation_time,r.id
  LIMIT 51 OFFSET p_offset
 ) x;
 RETURN jsonb_build_object('reservations',coalesce((SELECT jsonb_agg(v ORDER BY ord)
  FROM jsonb_array_elements(rows) WITH ORDINALITY t(v,ord) WHERE ord<=50),'[]'::jsonb),
  'has_more',jsonb_array_length(rows)>50,'offset',p_offset);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_confirmation_search(uuid,date,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_confirmation_search(uuid,date,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
