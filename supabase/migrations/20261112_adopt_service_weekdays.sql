BEGIN;
SET LOCAL lock_timeout='5s';
DO $check$
BEGIN
 IF to_regclass('capacity_private.weekdays') IS NULL
 OR to_regprocedure('capacity_private.effective_config(uuid,date)') IS NULL
 OR to_regprocedure('public.reservation_capacity_settings_save(uuid,date,jsonb,text,text)') IS NULL THEN
  RAISE EXCEPTION 'Recurring settings backend is missing. Install the Weekly Reservation Settings SQL first. No changes applied.';
 END IF;
 IF position('effective_config' IN pg_get_functiondef('public.reservation_capacity_load(uuid,date)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'Capacity loader is not using recurring settings. Share the current reservation_capacity_load function definition for merging. No changes applied.';
 END IF;
END;
$check$;
LOCK TABLE capacity_private.days,capacity_private.weekdays
 IN SHARE ROW EXCLUSIVE MODE;
-- One-time adoption: only weekdays without an existing recurring setup.
-- Existing date-specific settings remain exceptions and are never removed.
WITH latest AS (
 SELECT DISTINCT ON (location_id,extract(dow FROM day)::integer)
  location_id,extract(dow FROM day)::integer AS weekday,
  day,config,updated_by
 FROM capacity_private.days
 ORDER BY location_id,extract(dow FROM day)::integer,updated_at DESC,day DESC
), added AS (
 INSERT INTO capacity_private.weekdays(location_id,weekday,config,updated_by)
 SELECT location_id,weekday,config,updated_by FROM latest
 ON CONFLICT(location_id,weekday) DO NOTHING
 RETURNING location_id,weekday,config,updated_by
)
INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
SELECT a.location_id,l.day,a.updated_by,'adopt saved weekday settings',
 jsonb_build_object('source_day',l.day,'weekday',a.weekday,'config',a.config)
FROM added a JOIN latest l USING(location_id,weekday);
NOTIFY pgrst,'reload schema';
COMMIT;
