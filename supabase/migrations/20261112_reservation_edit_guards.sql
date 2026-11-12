BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS reservation_flow_private;
REVOKE ALL ON SCHEMA reservation_flow_private FROM PUBLIC,anon,authenticated;

-- Preserve the installed implementations and their authorization checks.
DO $install$
BEGIN
 IF to_regprocedure('reservation_flow_private.future_change_before_guard(uuid,uuid,integer,boolean,jsonb)') IS NULL THEN
  IF to_regprocedure('public.reservation_future_change(uuid,uuid,integer,boolean,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'Install future-reservation editing first.';
  END IF;
  ALTER FUNCTION public.reservation_future_change(uuid,uuid,integer,boolean,jsonb)
   RENAME TO future_change_before_guard;
  ALTER FUNCTION public.future_change_before_guard(uuid,uuid,integer,boolean,jsonb)
   SET SCHEMA reservation_flow_private;
 END IF;
 IF to_regprocedure('reservation_flow_private.edit_tables_before_guard(uuid,uuid,integer,integer,uuid[],uuid,text)') IS NULL THEN
  IF to_regprocedure('public.reservation_edit_tables(uuid,uuid,integer,integer,uuid[],uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'Reservation table editor signature differs. No changes applied.';
  END IF;
  ALTER FUNCTION public.reservation_edit_tables(uuid,uuid,integer,integer,uuid[],uuid,text)
   RENAME TO edit_tables_before_guard;
  ALTER FUNCTION public.edit_tables_before_guard(uuid,uuid,integer,integer,uuid[],uuid,text)
   SET SCHEMA reservation_flow_private;
 END IF;
END;
$install$;
REVOKE ALL ON FUNCTION reservation_flow_private.future_change_before_guard(uuid,uuid,integer,boolean,jsonb),
 reservation_flow_private.edit_tables_before_guard(uuid,uuid,integer,integer,uuid[],uuid,text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION reservation_flow_private.lock_edits(p_location uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE
 OR public.app_access_allowed(p_location,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Reservation access required.' USING errcode='42501';END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,
 public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 IF to_regclass('capacity_private.blocks') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.blocks IN SHARE ROW EXCLUSIVE MODE';END IF;
 IF to_regclass('capacity_private.weekdays') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE';END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reservation_flow_private.validate_edit(
 p_location uuid,p_id uuid,p_before jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations;data jsonb;ids uuid[];
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=p_id AND location_id=p_location;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation unavailable.';END IF;
 -- Contact, notes and server-only changes do not alter seat inventory.
 IF jsonb_build_array(r.reservation_date,r.reservation_time,r.party_size,r.table_id,r.table_ids)
 IS NOT DISTINCT FROM jsonb_build_array(p_before->'reservation_date',p_before->'reservation_time',
  p_before->'party_size',p_before->'table_id',p_before->'table_ids')
 THEN RETURN to_jsonb(r);END IF;
 ids:=CASE WHEN coalesce(cardinality(r.table_ids),0)>0 THEN r.table_ids
  WHEN r.table_id IS NOT NULL THEN ARRAY[r.table_id] ELSE '{}'::uuid[] END;
 IF cardinality(ids)=0 THEN
  RAISE EXCEPTION 'Assign suitable tables before changing this booking’s time or party size. The original reservation was kept.';
 END IF;
 data:=public.reservation_capacity_load(p_location,r.reservation_date);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(data->'bookings','[]'::jsonb)) b
  WHERE b->>'id'<>p_id::text AND (
   coalesce(jsonb_array_length(b->'tableIds'),0)=0
   OR b->>'start' IS NULL OR b->>'end' IS NULL))
 THEN RAISE EXCEPTION 'Resolve unassigned or incomplete bookings on this date before changing capacity. The original reservation was kept.';END IF;
 -- Reuses approved combinations, seats, room, overlaps, service hours,
 -- reset buffers, blocks and active-status checks under the same locks.
 PERFORM public.reservation_table_map_save(
  p_location,p_id,r.edit_version,data->>'fingerprint',ids
 );
 SELECT * INTO r FROM public.reservations WHERE id=p_id AND location_id=p_location;
 RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION reservation_flow_private.lock_edits(uuid),
 reservation_flow_private.validate_edit(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reservation_future_change(
 p_location_id uuid,p_id uuid,p_version integer,p_remove boolean,p_data jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row jsonb;result jsonb;
BEGIN
 IF p_remove IS NULL THEN RAISE EXCEPTION 'Choose edit or cancel.';END IF;
 PERFORM reservation_flow_private.lock_edits(p_location_id);
 SELECT to_jsonb(r) INTO before_row FROM public.reservations r
 WHERE id=p_id AND location_id=p_location_id FOR UPDATE;
 result:=reservation_flow_private.future_change_before_guard(
  p_location_id,p_id,p_version,p_remove,p_data
 );
 IF p_remove THEN RETURN result;END IF;
 RETURN reservation_flow_private.validate_edit(p_location_id,p_id,before_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_edit_tables(
 p_location_id uuid,p_reservation_id uuid,p_version integer,p_party_size integer,
 p_table_ids uuid[],p_server_id uuid,p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row jsonb;
BEGIN
 PERFORM reservation_flow_private.lock_edits(p_location_id);
 SELECT to_jsonb(r) INTO before_row FROM public.reservations r
 WHERE id=p_reservation_id AND location_id=p_location_id FOR UPDATE;
 PERFORM reservation_flow_private.edit_tables_before_guard(
  p_location_id,p_reservation_id,p_version,p_party_size,p_table_ids,p_server_id,p_notes
 );
 RETURN reservation_flow_private.validate_edit(p_location_id,p_reservation_id,before_row);
END;
$$;
REVOKE ALL ON FUNCTION public.reservation_future_change(uuid,uuid,integer,boolean,jsonb),
 public.reservation_edit_tables(uuid,uuid,integer,integer,uuid[],uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_future_change(uuid,uuid,integer,boolean,jsonb),
 public.reservation_edit_tables(uuid,uuid,integer,integer,uuid[],uuid,text)
 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
