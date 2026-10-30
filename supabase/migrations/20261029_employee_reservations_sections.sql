BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('employee-reservations-sections-v1',0));

-- Keep all existing checks for unrelated pages. Only these shared tools are universal.
DO $patch$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.app_access_allowed(uuid,text,text)'::regprocedure) INTO definition;
 IF definition NOT LIKE '%employee-shared-tools-v1%' THEN
  IF definition NOT ILIKE '%LANGUAGE plpgsql%' OR definition !~* '\mBEGIN\M' THEN
   RAISE EXCEPTION 'Access function changed; export its definition for a safe merge.';
  END IF;
  definition:=regexp_replace(definition,'\mBEGIN\M',
   'BEGIN /* employee-shared-tools-v1 */
    IF (p_page=''floor'' AND p_section IN (''*'',''reservations'',''sections''))
       OR (p_page=''home'' AND p_section IN (''*'',''sections'')) THEN
      RETURN auth.uid() IS NOT NULL AND public.closeout_is_member(p_location_id) IS TRUE;
    END IF;', 'i');
  EXECUTE definition;
 END IF;
END;
$patch$;

CREATE OR REPLACE FUNCTION public.floor_schedule_can_manage(p_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT auth.uid() IS NOT NULL AND public.closeout_is_member(p_location_id) IS TRUE; $$;
REVOKE ALL ON FUNCTION public.floor_schedule_can_manage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.floor_schedule_can_manage(uuid) TO authenticated;

-- Retain current section validation, time windows, version checks and publication logic.
-- Change only the access predicates in these section-specific entry points.
DO $sections$
DECLARE f record; definition text;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('floor_assign_section_person','floor_assign_section','floor_section_save_window',
  'floor_section_presets','floor_section_preset_save')
 LOOP
  SELECT pg_get_functiondef(f.oid) INTO definition;
  definition:=replace(definition,'public.mod_is_manager(p_location_id)','public.floor_schedule_can_manage(p_location_id)');
  definition:=replace(definition,'public.closeout_is_gm(p_location_id)','public.floor_schedule_can_manage(p_location_id)');
  EXECUTE definition;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='floor_section_save_window') THEN
  RAISE EXCEPTION 'Section window workflow missing; no update applied.';
 END IF;
END;
$sections$;

-- Dedicated add endpoint: no broad reservation-table write grant or role elevation.
CREATE OR REPLACE FUNCTION public.employee_reservation_add(p_location_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $add$
DECLARE item jsonb; org uuid; selected_ids uuid[];
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Active location membership required.' USING errcode='42501';
 END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<>1 THEN
  RAISE EXCEPTION 'Add one reservation at a time.';
 END IF;
 item:=p_rows->0;
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid reservation.'; END IF;
 SELECT organization_id INTO org FROM public.locations WHERE id=p_location_id;
 SELECT array_agg(value::uuid) INTO selected_ids
 FROM jsonb_array_elements_text(coalesce(item->'table_ids','[]'::jsonb));
 IF item->>'table_id' IS NOT NULL THEN selected_ids:=array_append(selected_ids,(item->>'table_id')::uuid); END IF;
 IF EXISTS(SELECT 1 FROM unnest(selected_ids) t(id) WHERE id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.floor_tables f WHERE f.id=t.id AND f.location_id=p_location_id AND f.is_active)) THEN
  RAISE EXCEPTION 'Choose active tables at this location.';
 END IF;
 IF nullif(btrim(item->>'guest_name'),'') IS NULL
 OR length(item->>'guest_name')>200 OR coalesce(item->>'party_size','') !~ '^[0-9]{1,3}$'
 OR (item->>'party_size')::integer NOT BETWEEN 1 AND 500
 OR (item->>'reservation_date')::date IS NULL OR (item->>'reservation_time')::time IS NULL
 OR (item->>'reservation_date')::date < (now() AT TIME ZONE 'America/Chicago')::date
 OR length(coalesce(item->>'notes',''))>4000 OR length(coalesce(item->>'phone',''))>100
 OR length(coalesce(item->>'email',''))>250 THEN RAISE EXCEPTION 'Review guest name, date, time, party size and contact details.'; END IF;
 item:=item||jsonb_build_object('location_id',p_location_id,'organization_id',org,
  'status','booked','imported_source','manual','external_reservation_id',NULL);
 RETURN public.reservation_merge(p_location_id,jsonb_build_array(item));
END;
$add$;
REVOKE ALL ON FUNCTION public.employee_reservation_add(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.employee_reservation_add(uuid,jsonb) TO authenticated;


create or replace function public.reservation_future_load(p_location_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'floor','reservations');
 if p_day is null or p_day<(now() at time zone 'America/Chicago')::date then raise exception 'Choose today or a future date.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'edit_version',edit_version,'guest_name',guest_name,'reservation_date',reservation_date,'reservation_time',reservation_time,'party_size',party_size,'phone',phone,'email',email,'notes',notes,'status',status) order by reservation_time,id) from public.reservations where location_id=p_location_id and reservation_date=p_day and coalesce(status,'booked') not in ('cancelled','canceled')),'[]'::jsonb);
end;$$;
create or replace function public.reservation_future_change(p_location_id uuid,p_id uuid,p_version integer,p_remove boolean,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.reservations;after_row public.reservations;day date;clock time;
begin
 if auth.uid() is null or public.closeout_is_member(p_location_id) is not true then raise exception 'Active location membership required.' using errcode='42501';end if;
 perform public.app_access_assert(p_location_id,'floor','reservations');
 select * into before_row from public.reservations where id=p_id and location_id=p_location_id for update;
 if not found then raise exception 'Reservation unavailable.';end if;
 if before_row.edit_version is distinct from p_version then raise exception 'This reservation changed. Refresh and reopen it.';end if;
 if before_row.reservation_date<(now() at time zone 'America/Chicago')::date or before_row.status in ('seated','completed','cancelled','canceled') then raise exception 'Only active reservations for today or future dates can be changed here.';end if;
 if p_remove is true then
  update public.reservations set status='cancelled' where id=p_id returning * into after_row;
 else
  day:=(p_data->>'reservation_date')::date;clock:=(p_data->>'reservation_time')::time;
  if day is null or day<(now() at time zone 'America/Chicago')::date or clock is null or length(btrim(coalesce(p_data->>'guest_name',''))) not between 1 and 200 or coalesce(p_data->>'party_size','') !~ '^[0-9]{1,3}$' or (p_data->>'party_size')::integer not between 1 and 500 or length(coalesce(p_data->>'notes',''))>4000 or length(coalesce(p_data->>'phone',''))>100 or length(coalesce(p_data->>'email',''))>250 then raise exception 'Review guest name, date, time, party size and contact details.';end if;
  update public.reservations set guest_name=btrim(p_data->>'guest_name'),reservation_date=day,reservation_time=clock,party_size=(p_data->>'party_size')::integer,phone=nullif(btrim(p_data->>'phone'),''),email=nullif(btrim(p_data->>'email'),''),notes=nullif(btrim(p_data->>'notes'),'') where id=p_id returning * into after_row;
 end if;
 insert into public.reservation_edit_audit(location_id,reservation_id,changed_by,before_record,after_record) values(p_location_id,p_id,auth.uid(),to_jsonb(before_row),to_jsonb(after_row));
 return to_jsonb(after_row);
end;$$;
revoke all on function public.reservation_future_load(uuid,date),public.reservation_future_change(uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_future_load(uuid,date),public.reservation_future_change(uuid,uuid,integer,boolean,jsonb) to authenticated;
notify pgrst,'reload schema';

COMMIT;
SELECT true AS employee_reservation_section_sql_installed, false AS production_behavior_verified;
