BEGIN;
SET LOCAL lock_timeout='5s';
-- Reuse existing authenticated edit locks; no public elevation or trigger disabling.
CREATE OR REPLACE FUNCTION reservation_flow_private.rehome_one(p_location uuid,p_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations;data jsonb;target jsonb;g jsonb;chosen uuid[]:='{}';previous_ids uuid[];buffer_minutes integer;
BEGIN
 PERFORM reservation_flow_private.lock_edits(p_location);
 SELECT * INTO r FROM public.reservations WHERE id=p_id AND location_id=p_location FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 IF lower(coalesce(r.status,'')) NOT IN('booked','confirmed','arrived','partially_arrived') THEN RETURN to_jsonb(r);END IF;
 previous_ids:=CASE WHEN coalesce(cardinality(r.table_ids),0)>0 THEN r.table_ids WHEN r.table_id IS NOT NULL THEN ARRAY[r.table_id] ELSE '{}'::uuid[] END;
 data:=public.reservation_capacity_load(p_location,r.reservation_date);
 SELECT value INTO target FROM jsonb_array_elements(data->'bookings') WHERE value->>'id'=p_id::text;
 buffer_minutes:=coalesce((data->'config'->>'buffer')::integer,15);
 IF target IS NOT NULL AND target->>'start' IS NOT NULL AND target->>'end' IS NOT NULL AND coalesce((data->>'configured')::boolean,false) AND NOT coalesce((data->'config'->>'closed')::boolean,false) THEN
  FOR g IN
   WITH choices AS (
    SELECT to_jsonb(previous_ids) ids,0 priority WHERE cardinality(previous_ids)>0
    UNION ALL SELECT jsonb_build_array(t->>'id'),1 FROM jsonb_array_elements(data->'tables') t
    UNION ALL SELECT value,1 FROM jsonb_array_elements(coalesce(data->'config'->'joinGroups','[]'))
   ) SELECT ids FROM choices ORDER BY priority,
    (SELECT coalesce(sum((t->>'seats')::integer),0) FROM jsonb_array_elements(data->'tables') t WHERE ids ? (t->>'id')),ids::text
  LOOP
   IF jsonb_array_length(g)=0 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(g))<>jsonb_array_length(g) THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(g) x WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(data->'tables') t WHERE t->>'id'=x.value
    AND NOT(coalesce(data->'config'->'blockedTables','[]') ? x.value)
    AND (coalesce(target->>'room','')='' OR target->>'room'=t->>'room' OR lower(target->>'room')=lower(t->>'roomName'))
   )) THEN CONTINUE;END IF;
   IF (SELECT coalesce(sum((t->>'seats')::integer),0) FROM jsonb_array_elements(data->'tables') t WHERE g ? (t->>'id'))<r.party_size THEN CONTINUE;END IF;
   -- Live parties and other assigned reservations remain fixed.
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'bookings') b WHERE b->>'id'<>p_id::text
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(b->'tableIds','[]')) x WHERE g ? x.value)
    AND (b->>'start' IS NULL OR b->>'end' IS NULL OR ((target->>'start')::numeric<(b->>'end')::numeric+buffer_minutes AND (b->>'start')::numeric<(target->>'end')::numeric+buffer_minutes))) THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(data->'blocks','[]')) b
    WHERE (target->>'start')::numeric<extract(epoch FROM (b->>'ends_at')::timestamptz)/60
    AND extract(epoch FROM (b->>'starts_at')::timestamptz)/60<(target->>'end')::numeric+buffer_minutes
    AND (b->>'scope'='day' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(b->'tableIds','[]')) x WHERE g ? x.value))) THEN CONTINUE;END IF;
   SELECT array_agg(value::uuid ORDER BY value) INTO chosen FROM jsonb_array_elements_text(g);EXIT;
  END LOOP;
 END IF;
 chosen:=coalesce(chosen,'{}'::uuid[]);
 IF previous_ids IS DISTINCT FROM chosen THEN
  UPDATE public.reservations SET table_id=chosen[1],table_ids=chosen,edit_version=coalesce(edit_version,0)+1 WHERE id=p_id AND location_id=p_location RETURNING * INTO r;
 END IF;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(p_location,r.reservation_date,auth.uid(),CASE WHEN cardinality(chosen)>0 THEN 'automatic table reassignment' ELSE 'reservation retained; tables pending' END,jsonb_build_object('reservation_id',p_id,'reason',p_reason,'before',previous_ids,'after',chosen));
 RETURN to_jsonb(r)||jsonb_build_object('tables_pending',cardinality(chosen)=0);
END;$$;
REVOKE ALL ON FUNCTION reservation_flow_private.rehome_one(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION reservation_flow_private.validate_edit(p_location uuid,p_id uuid,p_before jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations;cfg jsonb;opens timestamptz;closes timestamptz;arrival timestamptz;arrival_changed boolean;inventory_changed boolean;
BEGIN
 PERFORM reservation_flow_private.lock_edits(p_location);
 SELECT * INTO r FROM public.reservations WHERE id=p_id AND location_id=p_location FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 inventory_changed:=jsonb_build_array(r.reservation_date,r.reservation_time,r.party_size,r.table_id,r.table_ids) IS DISTINCT FROM jsonb_build_array(p_before->'reservation_date',p_before->'reservation_time',p_before->'party_size',p_before->'table_id',p_before->'table_ids');
 IF NOT inventory_changed THEN RETURN to_jsonb(r);END IF;
 IF coalesce(r.party_size,0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Enter 1–500 guests.';END IF;
 arrival_changed:=jsonb_build_array(r.reservation_date,r.reservation_time) IS DISTINCT FROM jsonb_build_array(p_before->'reservation_date',p_before->'reservation_time');
 -- A party-size or table-only edit keeps the original arrival, even after that arrival passes.
 IF arrival_changed THEN
  IF r.reservation_date IS NULL OR r.reservation_time IS NULL THEN RAISE EXCEPTION 'Choose date and time.';END IF;
  cfg:=capacity_private.effective_config(p_location,r.reservation_date);
  IF cfg IS NULL OR coalesce((cfg->>'closed')::boolean,false) THEN RAISE EXCEPTION 'Choose an open service date.';END IF;
  opens:=(r.reservation_date+(cfg->>'open')::time) AT TIME ZONE 'America/Chicago';
  closes:=((r.reservation_date+CASE WHEN (cfg->>'close')::time<=(cfg->>'open')::time THEN 1 ELSE 0 END)+(cfg->>'close')::time) AT TIME ZONE 'America/Chicago';
  arrival:=(r.reservation_date+r.reservation_time::time) AT TIME ZONE 'America/Chicago';
  IF arrival<opens AND (cfg->>'close')::time<=(cfg->>'open')::time THEN arrival:=arrival+interval '1 day';END IF;
  IF arrival<now() OR arrival<opens OR arrival>closes-interval '15 minutes' THEN RAISE EXCEPTION 'Choose a future arrival within service hours, no later than 15 minutes before close.';END IF;
 END IF;
 RETURN reservation_flow_private.rehome_one(p_location,p_id,'Reservation party size, arrival or table selection edited');
END;$$;
REVOKE ALL ON FUNCTION reservation_flow_private.validate_edit(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve the currently installed seating implementation and its validation/rotation/idempotency.
DO $$BEGIN
 IF to_regprocedure('reservation_flow_private.seat_before_rehome(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer)') IS NULL THEN
  ALTER FUNCTION public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) RENAME TO seat_before_rehome;
  ALTER FUNCTION public.seat_before_rehome(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) SET SCHEMA reservation_flow_private;
 END IF;
END;$$;
REVOKE ALL ON FUNCTION reservation_flow_private.seat_before_rehome(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.floor_seat_and_rotate_v1(
 p_location_id uuid,p_shift_id uuid,p_table_ids uuid[],p_server_id uuid,p_guest_name text,p_guest_phone text,p_guest_email text,p_party_size integer,p_request_id uuid,p_source text,p_reservation_id uuid DEFAULT NULL,p_walkin_id uuid DEFAULT NULL,p_walkin_version integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE day date;data jsonb;affected uuid[]:='{}';r record;sid uuid;before_ids uuid[];
BEGIN
 IF auth.uid() IS NULL OR public.walkin_can_manage(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Seating access required.' USING errcode='42501';END IF;
 PERFORM reservation_flow_private.lock_edits(p_location_id);
 IF EXISTS(SELECT 1 FROM public.floor_seating_history_v1 WHERE request_id=p_request_id) THEN
  RETURN reservation_flow_private.seat_before_rehome(p_location_id,p_shift_id,p_table_ids,p_server_id,p_guest_name,p_guest_phone,p_guest_email,p_party_size,p_request_id,p_source,p_reservation_id,p_walkin_id,p_walkin_version);
 END IF;
 SELECT shift_date INTO day FROM public.shifts WHERE id=p_shift_id AND location_id=p_location_id AND status='open' FOR UPDATE;
 IF day IS NULL THEN RAISE EXCEPTION 'Open the shift before seating guests.';END IF;
 data:=public.reservation_capacity_load(p_location_id,day);
 FOR r IN SELECT x.* FROM public.reservations x
  WHERE x.location_id=p_location_id AND x.id IS DISTINCT FROM p_reservation_id
  AND x.reservation_date BETWEEN day-1 AND day+1 AND lower(coalesce(x.status,'')) IN('booked','confirmed','arrived','partially_arrived')
  AND to_jsonb(x)->>'deleted_at' IS NULL
  AND (x.table_id=ANY(p_table_ids) OR x.table_ids&&p_table_ids)
  AND ((x.reservation_date+x.reservation_time::time) AT TIME ZONE 'America/Chicago')>=now()
  AND ((x.reservation_date+x.reservation_time::time) AT TIME ZONE 'America/Chicago')<to_timestamp((data->>'close')::numeric*60)
  AND NOT EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.reservation_id=x.id AND s.closed_at IS NULL)
  ORDER BY x.reservation_date,x.reservation_time,x.id FOR UPDATE
 LOOP
  before_ids:=CASE WHEN coalesce(cardinality(r.table_ids),0)>0 THEN r.table_ids WHEN r.table_id IS NOT NULL THEN ARRAY[r.table_id] ELSE '{}'::uuid[] END;
  affected:=array_append(affected,r.id);
  UPDATE public.reservations SET table_id=NULL,table_ids='{}',edit_version=coalesce(edit_version,0)+1 WHERE id=r.id;
  INSERT INTO capacity_private.audit(location_id,day,actor,action,details) VALUES(p_location_id,r.reservation_date,auth.uid(),'future table assignment released for seating',jsonb_build_object('reservation_id',r.id,'before',before_ids,'request_id',p_request_id));
 END LOOP;
 sid:=reservation_flow_private.seat_before_rehome(p_location_id,p_shift_id,p_table_ids,p_server_id,p_guest_name,p_guest_phone,p_guest_email,p_party_size,p_request_id,p_source,p_reservation_id,p_walkin_id,p_walkin_version);
 FOR r IN SELECT unnest(affected) id LOOP PERFORM reservation_flow_private.rehome_one(p_location_id,r.id,'Selected tables are now seated; move future reservation');END LOOP;
 RETURN sid;
END;$$;
REVOKE ALL ON FUNCTION public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.floor_seat_and_rotate_v1(uuid,uuid,uuid[],uuid,text,text,text,integer,uuid,text,uuid,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
