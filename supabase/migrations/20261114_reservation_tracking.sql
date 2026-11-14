BEGIN;
CREATE SCHEMA IF NOT EXISTS reservation_tracking_private;
REVOKE ALL ON SCHEMA reservation_tracking_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS reservation_tracking_private.origins(reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE CASCADE,actor uuid,created_at timestamptz NOT NULL);
ALTER TABLE reservation_tracking_private.origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_tracking_private.origins FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION reservation_tracking_private.capture_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO reservation_tracking_private.origins VALUES(NEW.id,auth.uid(),clock_timestamp()) ON CONFLICT DO NOTHING;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION reservation_tracking_private.capture_origin() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reservation_tracking_origin ON public.reservations;
CREATE TRIGGER reservation_tracking_origin AFTER INSERT ON public.reservations FOR EACH ROW EXECUTE FUNCTION reservation_tracking_private.capture_origin();
CREATE OR REPLACE FUNCTION public.reservation_tracking_details(p_location uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;origin jsonb;link jsonb;deliveries jsonb:='[]';chunk jsonb;tbl text;actor_name text;valid boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE OR public.app_access_allowed(p_location,'floor','reservations') IS NOT TRUE THEN RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';END IF;
 SELECT to_jsonb(x) INTO r FROM public.reservations x WHERE id=p_id AND location_id=p_location;
 IF r IS NULL THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 SELECT jsonb_build_object('actor',actor,'created_at',created_at) INTO origin FROM reservation_tracking_private.origins WHERE reservation_id=p_id;
 IF origin IS NULL AND to_regclass('capacity_private.entry_history') IS NOT NULL THEN
  EXECUTE 'SELECT jsonb_build_object(''actor'',changed_by,''name'',actor_name,''created_at'',changed_at) FROM capacity_private.entry_history WHERE location_id=$1 AND entry_id=$2 AND entry_kind=''reservation'' AND action=''Created'' ORDER BY id LIMIT 1' INTO origin USING p_location,p_id;
 END IF;
 IF origin->>'actor' IS NOT NULL THEN SELECT coalesce(nullif(to_jsonb(p)->>'preferred_name',''),nullif(to_jsonb(p)->>'full_name','')) INTO actor_name FROM public.profiles p WHERE id=(origin->>'actor')::uuid;END IF;
 IF to_regclass('reservation_consent_private.links') IS NOT NULL THEN
  EXECUTE 'SELECT to_jsonb(l)-''token_hash''-''snapshot'' FROM reservation_consent_private.links l WHERE reservation_id=$1 ORDER BY created_at DESC,id LIMIT 1' INTO link USING p_id;
  IF link IS NOT NULL THEN
   EXECUTE 'SELECT revoked_at IS NULL AND expires_at>now() AND snapshot=public.reservation_consent_snapshot($1) FROM reservation_consent_private.links WHERE id=$2' INTO valid USING p_id,(link->>'id')::uuid;
  END IF;
 END IF;
 FOREACH tbl IN ARRAY ARRAY['link_emails','link_sms'] LOOP
  IF to_regclass('reservation_consent_private.'||tbl) IS NOT NULL THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(x),''[]''::jsonb) FROM (SELECT jsonb_build_object(''channel'',%L,''status'',status,''at'',created_at,''current_link'',link_id=$2) x FROM reservation_consent_private.%I WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 20) q',CASE WHEN tbl='link_emails' THEN 'Email' ELSE 'SMS' END,tbl) INTO chunk USING p_id,(link->>'id')::uuid;
   deliveries:=deliveries||chunk;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('reservation_id',p_id,'name',r->>'guest_name','party',r->'party_size','date',r->>'reservation_date','time',r->>'reservation_time','phone',r->>'phone','email',r->>'email','created_at',coalesce(r->>'created_at',origin->>'created_at'),'created_by',coalesce(actor_name,nullif(origin->>'name',''),'Not recorded'),'link_created_at',link->>'created_at','link_valid',coalesce(valid,false),'responded_at',link->>'responded_at','guest_confirmed',coalesce(valid AND (link->>'booking_confirmed')::boolean,false),'deliveries',deliveries,'delivery_history_available',to_regclass('reservation_consent_private.link_emails') IS NOT NULL OR to_regclass('reservation_consent_private.link_sms') IS NOT NULL);
END;$$;
CREATE OR REPLACE FUNCTION public.reservation_tracking_list(p_location uuid,p_day date,p_query text DEFAULT '',p_filter text DEFAULT 'all',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE OR public.app_access_allowed(p_location,'floor','reservations') IS NOT TRUE THEN RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';END IF;
 IF length(coalesce(p_query,''))>120 OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_filter IS NULL OR p_filter NOT IN('all','confirmed','not_confirmed','sent','not_sent') THEN RAISE EXCEPTION 'Invalid search or filter.';END IF;
 WITH candidates AS MATERIALIZED (
 SELECT r.id,r.reservation_date,r.reservation_time,public.reservation_tracking_details(p_location,r.id) info FROM public.reservations r
 WHERE r.location_id=p_location AND (p_day IS NULL OR r.reservation_date=p_day) AND lower(coalesce(r.status,'booked')) IN('booked','confirmed','arrived','partially_arrived') AND to_jsonb(r)->>'deleted_at' IS NULL
 AND (btrim(coalesce(p_query,''))='' OR strpos(lower(concat_ws(' ',r.guest_name,r.phone,r.email)),lower(btrim(p_query)))>0 OR (regexp_replace(p_query,'[^0-9]','','g')<>'' AND strpos(regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'),regexp_replace(p_query,'[^0-9]','','g'))>0))
 ), filtered AS (
 SELECT * FROM candidates WHERE p_filter='all' OR p_filter='confirmed' AND (info->>'guest_confirmed')::boolean OR p_filter='not_confirmed' AND NOT(info->>'guest_confirmed')::boolean
 OR p_filter='sent' AND EXISTS(SELECT 1 FROM jsonb_array_elements(info->'deliveries') d WHERE d->>'status' IN('accepted','sent','delivered'))
 OR p_filter='not_sent' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(info->'deliveries') d WHERE d->>'status' IN('accepted','sent','delivered'))
 ORDER BY reservation_date,reservation_time,id LIMIT 51 OFFSET p_offset
 ) SELECT coalesce(jsonb_agg(info ORDER BY reservation_date,reservation_time,id),'[]') INTO rows FROM filtered;
 RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(v ORDER BY ord) FROM jsonb_array_elements(rows) WITH ORDINALITY t(v,ord) WHERE ord<=50),'[]'),'has_more',jsonb_array_length(rows)>50);
END;$$;
REVOKE ALL ON FUNCTION public.reservation_tracking_details(uuid,uuid),public.reservation_tracking_list(uuid,date,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_tracking_details(uuid,uuid),public.reservation_tracking_list(uuid,date,text,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
