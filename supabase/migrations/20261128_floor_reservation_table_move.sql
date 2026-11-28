BEGIN;

CREATE OR REPLACE FUNCTION reservation_flow_private.save_reservation_tables(
 p_location_id uuid,p_id uuid,p_version integer,
 p_fingerprint text,p_table_ids uuid[],p_floor_move boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.reservations;data jsonb;target jsonb;ids jsonb;
 buffer_minutes integer;before_ids uuid[];destination_room text;
BEGIN
 IF auth.uid() IS NULL
 OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Reservation access required.' USING errcode='42501';END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.reservations,public.table_sessions,
 public.table_session_tables,public.floor_tables,public.rooms,
 capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 IF to_regclass('capacity_private.blocks') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.blocks IN SHARE ROW EXCLUSIVE MODE';
 END IF;
 IF to_regclass('capacity_private.weekdays') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE';
 END IF;
 SELECT * INTO r FROM public.reservations
 WHERE id=p_id AND location_id=p_location_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 IF r.edit_version IS DISTINCT FROM p_version THEN
  RAISE EXCEPTION 'Reservation changed. Reload the map before saving.';
 END IF;
 IF r.reservation_date<(now() AT TIME ZONE 'America/Chicago')::date
 OR lower(coalesce(r.status,'')) IN(
  'seated','completed','departed','cancelled','canceled','removed','no_show','no show'
 ) OR to_jsonb(r)->>'deleted_at' IS NOT NULL THEN
  RAISE EXCEPTION 'Assign tables to an active current or future reservation. Move seated guests through the seating controls.';
 END IF;
 data:=public.reservation_capacity_load(p_location_id,r.reservation_date);
 IF NOT p_floor_move AND data->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN
  RAISE EXCEPTION 'Bookings, blocks or settings changed. Reload the map before saving.';
 END IF;
 IF coalesce((data->>'configured')::boolean,false) IS NOT TRUE
 OR coalesce((data->'config'->>'closed')::boolean,false) THEN
  RAISE EXCEPTION 'Save open service settings before assigning tables.';
 END IF;
 SELECT b INTO target FROM jsonb_array_elements(data->'bookings') b
 WHERE b->>'id'=p_id::text;
 IF target IS NULL OR target->>'start' IS NULL OR target->>'end' IS NULL
 OR coalesce((target->>'party')::integer,0)<1 THEN
  RAISE EXCEPTION 'Add a valid reservation time and party size first.';
 END IF;
 IF coalesce(cardinality(p_table_ids),0) NOT BETWEEN 1 AND 100
 OR EXISTS(SELECT 1 FROM unnest(p_table_ids) x WHERE x IS NULL)
 OR (SELECT count(DISTINCT x) FROM unnest(p_table_ids) x)<>cardinality(p_table_ids)
 THEN RAISE EXCEPTION 'Choose 1–100 distinct tables.';END IF;
 ids:=to_jsonb(p_table_ids);
 buffer_minutes:=(data->'config'->>'buffer')::integer;
 IF (target->>'start')::numeric<(data->>'open')::numeric
 OR (NOT p_floor_move AND (target->>'end')::numeric+buffer_minutes>(data->>'close')::numeric)
 OR (p_floor_move AND (target->>'start')::numeric>=(data->>'close')::numeric)
 THEN
  IF p_floor_move THEN RAISE EXCEPTION 'The reservation arrival is outside service hours.';END IF;
  RAISE EXCEPTION 'Reservation and reset must fit inside service hours.';
 END IF;
 IF EXISTS(
  SELECT 1 FROM unnest(p_table_ids) id WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(data->'tables') t
   WHERE t->>'id'=id::text
   AND NOT(data->'config'->'blockedTables' ? id::text)
   AND (p_floor_move OR coalesce(target->>'room','')='' OR t->>'room'=target->>'room'
    OR lower(t->>'roomName')=lower(target->>'room'))
  )
 ) THEN RAISE EXCEPTION 'Choose available tables in the requested room.';END IF;
 IF p_floor_move THEN
  SELECT min(t->>'roomName') INTO destination_room
  FROM jsonb_array_elements(data->'tables') t WHERE ids ? (t->>'id')
  HAVING count(DISTINCT t->>'room')=1;
  IF destination_room IS NULL THEN RAISE EXCEPTION 'Select tables in one room.';END IF;
 END IF;
 IF cardinality(p_table_ids)>1 AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(data->'config'->'joinGroups') g
  WHERE (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(g.value))
   =(SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(ids))
 ) THEN RAISE EXCEPTION 'Choose an approved joined-table combination.';END IF;
 IF (SELECT coalesce(sum((t->>'seats')::integer),0)
  FROM jsonb_array_elements(data->'tables') t WHERE ids ? (t->>'id'))
  <(target->>'party')::integer
 THEN RAISE EXCEPTION 'Selected tables do not fit this party.';END IF;
 IF EXISTS(
  SELECT 1 FROM jsonb_array_elements(data->'bookings') b
  WHERE b->>'id'<>p_id::text
  AND (target->>'start')::numeric<(b->>'end')::numeric+buffer_minutes
  AND (b->>'start')::numeric<(target->>'end')::numeric+buffer_minutes
  AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(b->'tableIds') x
   WHERE ids ? x.value)
 ) THEN RAISE EXCEPTION 'A selected table has an overlapping reservation or seated party.';END IF;
 IF EXISTS(
  SELECT 1 FROM jsonb_array_elements(coalesce(data->'blocks','[]'::jsonb)) b
  WHERE (target->>'start')::numeric<extract(epoch FROM (b->>'ends_at')::timestamptz)/60
  AND extract(epoch FROM (b->>'starts_at')::timestamptz)/60
   <(target->>'end')::numeric+buffer_minutes
  AND (b->>'scope'='day' OR EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(b->'tableIds') x WHERE ids ? x.value
  ))
 ) THEN RAISE EXCEPTION 'A selected table is blocked during this reservation.';END IF;
 before_ids:=r.table_ids;
 UPDATE public.reservations SET table_ids=p_table_ids,
 table_id=p_table_ids[1],
 dining_area=CASE WHEN p_floor_move AND coalesce(dining_area,'')<>'' THEN destination_room ELSE dining_area END,
 edit_version=coalesce(edit_version,0)+1
 WHERE id=p_id AND location_id=p_location_id;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(p_location_id,r.reservation_date,auth.uid(),'assign reservation tables',
  jsonb_build_object('reservation_id',p_id,'before',before_ids,'after',ids));
END;
$$;
REVOKE ALL ON FUNCTION reservation_flow_private.save_reservation_tables(uuid,uuid,integer,text,uuid[],boolean)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_table_map_save(
 p_location_id uuid,p_id uuid,p_version integer,p_fingerprint text,p_table_ids uuid[]
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT reservation_flow_private.save_reservation_tables(p_location_id,p_id,p_version,p_fingerprint,p_table_ids,false);
$$;

CREATE OR REPLACE FUNCTION public.floor_reservation_move_tables(
 p_location_id uuid,p_id uuid,p_version integer,p_table_ids uuid[]
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT reservation_flow_private.save_reservation_tables(p_location_id,p_id,p_version,NULL,p_table_ids,true);
$$;
REVOKE ALL ON FUNCTION public.floor_reservation_move_tables(uuid,uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.floor_reservation_move_tables(uuid,uuid,integer,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
