BEGIN;

CREATE OR REPLACE FUNCTION public.reservation_clear_past(
  p_location_id uuid,
  p_id uuid,
  p_version integer,
  p_outcome text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  reservation public.reservations%ROWTYPE;
  central_now timestamp := clock_timestamp() AT TIME ZONE 'America/Chicago';
  current_status text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'no_show') THEN
    RAISE EXCEPTION 'Choose Showed up or No-show.';
  END IF;

  PERFORM reservation_flow_private.lock_edits(p_location_id);
  SELECT * INTO reservation FROM public.reservations
  WHERE id=p_id AND location_id=p_location_id FOR UPDATE;

  IF NOT FOUND OR reservation.edit_version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'This reservation changed. Refresh before clearing it.' USING ERRCODE='40001';
  END IF;

  current_status := lower(trim(coalesce(reservation.status, '')));
  IF current_status NOT IN ('booked', 'confirmed', 'arrived', 'partially_arrived')
    OR (p_outcome='no_show' AND current_status IN ('arrived', 'partially_arrived'))
    OR EXISTS (
      SELECT 1 FROM public.floor_seating_history_v1 history
      JOIN public.table_sessions session ON session.id=history.session_id
      WHERE history.location_id=p_location_id AND history.reservation_id=p_id AND session.closed_at IS NULL
    )
  THEN
    RAISE EXCEPTION 'This outcome is unavailable for the current reservation status.';
  END IF;

  IF reservation.reservation_date IS NULL
    OR reservation.reservation_date > central_now::date
    OR (reservation.reservation_date=central_now::date
      AND (reservation.reservation_time IS NULL OR reservation.reservation_time::time>=central_now::time))
  THEN
    RAISE EXCEPTION 'The scheduled reservation time has not passed.';
  END IF;

  UPDATE public.reservations SET status=p_outcome WHERE id=p_id AND location_id=p_location_id;
  INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
  VALUES(p_location_id,reservation.reservation_date,auth.uid(),'reservation_cleared',
    jsonb_build_object('reservation_id',p_id,'previous_status',current_status,'outcome',p_outcome));
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_clear_past(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_clear_past(uuid,uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
