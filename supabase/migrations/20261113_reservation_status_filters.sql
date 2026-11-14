BEGIN;
CREATE OR REPLACE FUNCTION public.reservation_management_list(
 p_location uuid,p_day date DEFAULT NULL,p_query text DEFAULT '',p_offset integer DEFAULT 0,p_status text DEFAULT 'active'
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
 IF p_status IS NULL OR p_status NOT IN ('active','all','booked','confirmed','arrived','seated','completed','cancelled','no_show') THEN RAISE EXCEPTION 'Choose a valid reservation status.';END IF;
 digits:=CASE WHEN q ~ '^[+(). 0-9-]+$' THEN regexp_replace(q,'[^0-9]','','g') ELSE '' END;
 IF length(digits)=11 AND left(digits,1)='1' THEN digits:=right(digits,10);END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.reservation_date,x.reservation_time,x.id),'[]'::jsonb)
 INTO rows FROM (
  SELECT r.id,r.guest_name,r.reservation_date,r.reservation_time,r.party_size,
   r.phone,r.email,r.notes,r.status,r.edit_version,
   coalesce(to_jsonb(r)->>'occasion','') occasion,
   coalesce((to_jsonb(r)->>'is_birthday')::boolean,false) birthday,
   coalesce((to_jsonb(r)->>'is_vip')::boolean,false) vip
  FROM public.reservations r
  WHERE r.location_id=p_location AND to_jsonb(r)->>'deleted_at' IS NULL
   AND (p_day IS NULL OR r.reservation_date=p_day)
   AND (p_status='all'
    OR p_status='active' AND lower(btrim(coalesce(nullif(r.status,''),'booked'))) IN ('booked','confirmed')
    OR p_status='cancelled' AND lower(btrim(r.status)) IN ('cancelled','canceled')
    OR p_status='no_show' AND regexp_replace(lower(btrim(r.status)),'[ -]+','_','g')='no_show'
    OR p_status='arrived' AND lower(btrim(r.status)) IN ('arrived','partially_arrived')
    OR p_status NOT IN ('active','all','cancelled','no_show','arrived') AND lower(btrim(coalesce(nullif(r.status,''),'booked')))=p_status
   )
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
REVOKE ALL ON FUNCTION public.reservation_management_list(uuid,date,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_management_list(uuid,date,text,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
