BEGIN;
CREATE OR REPLACE FUNCTION public.floor_table_seat_count_change(
 p_location uuid,p_table uuid,p_expected integer,p_seats integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior integer;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location) IS NOT TRUE OR NOT (
 public.mod_is_manager(p_location) IS TRUE OR EXISTS(
 SELECT 1 FROM public.location_memberships WHERE location_id=p_location AND user_id=auth.uid()
 AND status='active' AND (can_edit_floor OR role='host')
 )) THEN RAISE EXCEPTION 'Floor editing access required.' USING errcode='42501';END IF;
 IF p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Enter 1–100 actual seats.';END IF;
 PERFORM set_config('lock_timeout','5s',true);
 SELECT seat_count INTO prior FROM public.floor_tables WHERE id=p_table AND location_id=p_location AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Table unavailable. Refresh the floor.';END IF;
 IF prior IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Seat count changed. Refresh before saving.' USING errcode='40001';END IF;
 IF prior=p_seats THEN RETURN jsonb_build_object('saved',true,'seats',p_seats);END IF;
 IF p_seats<prior THEN RAISE EXCEPTION 'This quick correction adds seats. Use Rooms & layout to review a reduction against existing bookings.';END IF;
 UPDATE public.floor_tables SET seat_count=p_seats WHERE id=p_table AND location_id=p_location;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
 VALUES(p_location,(now() AT TIME ZONE 'America/Chicago')::date,auth.uid(),'table seats corrected',jsonb_build_object('table_id',p_table,'previous',prior,'seats',p_seats));
 RETURN jsonb_build_object('saved',true,'seats',p_seats);
END;$$;
REVOKE ALL ON FUNCTION public.floor_table_seat_count_change(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.floor_table_seat_count_change(uuid,uuid,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
