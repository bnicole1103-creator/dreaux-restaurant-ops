BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('reservation-batch-guestbook-v1',0));

CREATE TABLE IF NOT EXISTS public.reservation_guests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
 normalized_name text NOT NULL,
 phone text,
 phone_key text,
 email text,
 email_key text,
 is_vip boolean NOT NULL DEFAULT false,
 is_birthday boolean NOT NULL DEFAULT false,
 first_reservation_date date,
 last_reservation_date date,
 last_occasion text,
 last_notes text,
 source_details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS reservation_guests_location_name_idx ON public.reservation_guests(location_id,normalized_name);
CREATE INDEX IF NOT EXISTS reservation_guests_location_phone_idx ON public.reservation_guests(location_id,phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_guests_location_email_idx ON public.reservation_guests(location_id,email_key) WHERE email_key IS NOT NULL;
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_guests ADD COLUMN IF NOT EXISTS source_details jsonb NOT NULL DEFAULT '{}'::jsonb;
REVOKE ALL ON public.reservation_guests FROM PUBLIC,anon,authenticated;

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS guestbook_guest_id uuid REFERENCES public.reservation_guests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reservations_guestbook_guest_idx ON public.reservations(guestbook_guest_id,reservation_date DESC);

CREATE OR REPLACE FUNCTION public.reservation_guest_capture(p_location_id uuid,p_organization_id uuid,p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_id uuid;v_name text;v_normalized text;v_phone text;v_phone_key text;v_email text;v_email_key text;v_day date;
BEGIN
 v_name:=left(btrim(coalesce(p_values->>'guest_name','')),200);
 IF v_name='' THEN RAISE EXCEPTION 'Guest name is required.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l WHERE l.id=p_location_id AND l.organization_id=p_organization_id) THEN RAISE EXCEPTION 'Guest location does not match.';END IF;
 v_normalized:=public.reservation_normalize(v_name);
 v_phone:=nullif(left(btrim(coalesce(p_values->>'phone','')),100),'');
 v_phone_key:=nullif(right(regexp_replace(coalesce(v_phone,''),'\D','','g'),10),'');
 v_email:=nullif(left(lower(btrim(coalesce(p_values->>'email',''))),320),'');
 v_email_key:=v_email;
 v_day:=nullif(p_values->>'reservation_date','')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('reservation-guest:'||p_location_id::text,0));
 SELECT g.id INTO v_id FROM public.reservation_guests g
 WHERE g.location_id=p_location_id AND (
  (v_email_key IS NOT NULL AND g.email_key=v_email_key) OR
  (v_phone_key IS NOT NULL AND g.phone_key=v_phone_key) OR
  (g.normalized_name=v_normalized AND (
    (v_email_key IS NULL AND v_phone_key IS NULL) OR
    (g.email_key IS NULL AND g.phone_key IS NULL)
  ))
 )
 ORDER BY (g.email_key=v_email_key) DESC NULLS LAST,(g.phone_key=v_phone_key) DESC NULLS LAST,g.updated_at DESC
 LIMIT 1 FOR UPDATE;
 IF v_id IS NULL THEN
  INSERT INTO public.reservation_guests(organization_id,location_id,display_name,normalized_name,phone,phone_key,email,email_key,is_vip,is_birthday,first_reservation_date,last_reservation_date,last_occasion,last_notes,source_details)
  VALUES(p_organization_id,p_location_id,v_name,v_normalized,v_phone,v_phone_key,v_email,v_email_key,coalesce((p_values->>'is_vip')::boolean,false),coalesce((p_values->>'is_birthday')::boolean,false),v_day,v_day,nullif(p_values->>'occasion',''),nullif(p_values->>'notes',''),CASE WHEN jsonb_typeof(p_values->'guest_data')='object' THEN p_values->'guest_data' ELSE '{}'::jsonb END)
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.reservation_guests SET
   display_name=CASE WHEN length(v_name)>0 THEN v_name ELSE display_name END,
   normalized_name=v_normalized,
   phone=coalesce(v_phone,phone),phone_key=coalesce(v_phone_key,phone_key),
   email=coalesce(v_email,email),email_key=coalesce(v_email_key,email_key),
   is_vip=is_vip OR coalesce((p_values->>'is_vip')::boolean,false),
   is_birthday=is_birthday OR coalesce((p_values->>'is_birthday')::boolean,false),
   first_reservation_date=CASE WHEN v_day IS NULL THEN first_reservation_date ELSE least(coalesce(first_reservation_date,v_day),v_day) END,
   last_reservation_date=CASE WHEN v_day IS NULL THEN last_reservation_date ELSE greatest(coalesce(last_reservation_date,v_day),v_day) END,
   last_occasion=coalesce(nullif(p_values->>'occasion',''),last_occasion),
   last_notes=coalesce(nullif(p_values->>'notes',''),last_notes),
   source_details=source_details||CASE WHEN jsonb_typeof(p_values->'guest_data')='object' THEN p_values->'guest_data' ELSE '{}'::jsonb END,updated_at=clock_timestamp()
  WHERE id=v_id;
 END IF;
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_guest_capture(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_guest_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 NEW.guestbook_guest_id:=public.reservation_guest_capture(NEW.location_id,NEW.organization_id,to_jsonb(NEW));
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.reservation_guest_sync() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reservation_guestbook_sync ON public.reservations;
CREATE TRIGGER reservation_guestbook_sync BEFORE INSERT OR UPDATE OF guest_name,phone,email,is_vip,is_birthday,reservation_date,occasion,notes
ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.reservation_guest_sync();

DO $backfill$
DECLARE x public.reservations%rowtype;
BEGIN
 FOR x IN SELECT * FROM public.reservations WHERE guestbook_guest_id IS NULL ORDER BY location_id,reservation_date,id LOOP
  UPDATE public.reservations SET guestbook_guest_id=public.reservation_guest_capture(x.location_id,x.organization_id,to_jsonb(x)) WHERE id=x.id;
 END LOOP;
END;$backfill$;

CREATE OR REPLACE FUNCTION public.reservation_merge(p_location_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j jsonb;r public.reservations%rowtype;v_time time;v_date date;n integer:=0;skipped integer:=0;matched integer:=0;pid uuid;gid uuid;guest_ids uuid[]:='{}';
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Location access required.' USING errcode='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Import 1 to 10,000 reservations at a time.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('reservation-merge:'||p_location_id::text,0));
 FOR j IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR nullif(btrim(j->>'guest_name'),'') IS NULL OR length(j->>'guest_name')>200 THEN RAISE EXCEPTION 'Each reservation needs a guest name (up to 200 characters).';END IF;
  IF (j->>'location_id')::uuid IS DISTINCT FROM p_location_id OR NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_location_id AND organization_id=(j->>'organization_id')::uuid) THEN RAISE EXCEPTION 'Reservation location does not match.';END IF;
  v_date:=nullif(j->>'reservation_date','')::date;IF v_date IS NULL THEN RAISE EXCEPTION 'Each reservation needs a date.';END IF;
  BEGIN v_time:=nullif(btrim(j->>'reservation_time'),'')::time;EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid reservation time for %. Use 6:30 PM or 18:30.',j->>'guest_name';END;
  j:=jsonb_set(j,'{reservation_time}',coalesce(to_jsonb(v_time::text),'null'::jsonb));r:=jsonb_populate_record(null::public.reservations,j);
  IF r.party_size IS NULL OR r.party_size NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Party size must be a whole number from 1 to 500.';END IF;
  IF r.imported_source NOT IN('csv','manual') OR r.imported_source IS NULL THEN RAISE EXCEPTION 'Invalid reservation source.';END IF;
  IF r.table_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.floor_tables WHERE id=r.table_id AND location_id=p_location_id) THEN RAISE EXCEPTION 'Choose a table at this location.';END IF;
  gid:=public.reservation_guest_capture(p_location_id,r.organization_id,j);
  IF NOT gid=ANY(guest_ids) THEN guest_ids:=array_append(guest_ids,gid);END IF;
  SELECT x.id INTO pid FROM public.reservations x WHERE x.location_id=p_location_id AND (
   (nullif(btrim(r.external_reservation_id),'') IS NOT NULL AND btrim(x.external_reservation_id)=btrim(r.external_reservation_id)) OR
   (x.reservation_date=v_date AND public.reservation_time_key(x.reservation_time::text)=coalesce(v_time::text,'') AND public.reservation_normalize(x.guest_name)=public.reservation_normalize(r.guest_name) AND x.party_size=r.party_size
    AND NOT(nullif(btrim(x.external_reservation_id),'') IS NOT NULL AND nullif(btrim(r.external_reservation_id),'') IS NOT NULL AND btrim(x.external_reservation_id)<>btrim(r.external_reservation_id))
    AND NOT(nullif(btrim(x.email),'') IS NOT NULL AND nullif(btrim(r.email),'') IS NOT NULL AND lower(btrim(x.email))<>lower(btrim(r.email)))
    AND NOT(nullif(regexp_replace(coalesce(x.phone,''),'\D','','g'),'') IS NOT NULL AND nullif(regexp_replace(coalesce(r.phone,''),'\D','','g'),'') IS NOT NULL AND right(regexp_replace(x.phone,'\D','','g'),10)<>right(regexp_replace(r.phone,'\D','','g'),10)))
  ) LIMIT 1;
  IF pid IS NOT NULL THEN
   UPDATE public.reservations SET guestbook_guest_id=gid,phone=coalesce(phone,nullif(btrim(r.phone),'')),email=coalesce(email,nullif(btrim(r.email),'')),is_vip=coalesce(is_vip,false) OR coalesce(r.is_vip,false),is_birthday=coalesce(is_birthday,false) OR coalesce(r.is_birthday,false) WHERE id=pid;
   skipped:=skipped+1;CONTINUE;
  END IF;
  INSERT INTO public.reservations(organization_id,location_id,reservation_date,reservation_time,guest_name,party_size,phone,email,table_id,table_name,status,occasion,is_birthday,is_vip,dining_area,notes,imported_source,external_reservation_id,guestbook_guest_id)
  VALUES(r.organization_id,p_location_id,v_date,r.reservation_time,btrim(r.guest_name),r.party_size,nullif(btrim(r.phone),''),nullif(btrim(r.email),''),r.table_id,r.table_name,coalesce(nullif(r.status,''),'booked'),r.occasion,coalesce(r.is_birthday,false),coalesce(r.is_vip,false),r.dining_area,r.notes,r.imported_source,nullif(btrim(r.external_reservation_id),''),gid);
  n:=n+1;IF r.table_id IS NOT NULL THEN matched:=matched+1;END IF;
 END LOOP;
 RETURN jsonb_build_object('added',n,'duplicates',skipped,'matched',matched,'guests',coalesce(array_length(guest_ids,1),0));
END;$$;

CREATE OR REPLACE FUNCTION public.reservation_guestbook_read(p_location_id uuid,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE needle text:=public.reservation_normalize(p_search);digits text:=regexp_replace(coalesce(p_search,''),'\D','','g');
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Location access required.' USING errcode='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',g.id,'name',g.display_name,'phone',g.phone,'email',g.email,'vip',g.is_vip,'birthday',g.is_birthday,'details',g.source_details,
  'first_date',g.first_reservation_date,'last_date',g.last_reservation_date,'last_occasion',g.last_occasion,'last_notes',g.last_notes,
  'reservation_count',(SELECT count(*) FROM public.reservations r WHERE r.guestbook_guest_id=g.id),
  'history',coalesce((SELECT jsonb_agg(h ORDER BY h.reservation_date DESC,h.reservation_time DESC) FROM (SELECT r.id,r.reservation_date,r.reservation_time,r.party_size,r.status,r.occasion,r.notes,r.table_name FROM public.reservations r WHERE r.guestbook_guest_id=g.id ORDER BY r.reservation_date DESC,r.reservation_time DESC LIMIT 20) h),'[]'::jsonb)
 ) ORDER BY g.last_reservation_date DESC NULLS LAST,g.display_name) FROM (
  SELECT * FROM public.reservation_guests x WHERE x.location_id=p_location_id AND (
   needle='' OR x.normalized_name LIKE '%'||needle||'%' OR coalesce(x.email_key,'') LIKE '%'||needle||'%' OR (digits<>'' AND coalesce(x.phone_key,'') LIKE '%'||digits||'%')
  ) ORDER BY x.last_reservation_date DESC NULLS LAST,x.display_name LIMIT 250
 ) g),'[]'::jsonb);
END;$$;

REVOKE ALL ON FUNCTION public.reservation_merge(uuid,jsonb),public.reservation_guestbook_read(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_merge(uuid,jsonb),public.reservation_guestbook_read(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS reservation_batch_guestbook_installed,false AS production_behavior_verified;
