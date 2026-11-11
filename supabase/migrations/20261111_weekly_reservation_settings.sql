BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE IF NOT EXISTS capacity_private.weekdays(
 location_id uuid NOT NULL REFERENCES public.locations(id),
 weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 config jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(location_id,weekday)
);
ALTER TABLE capacity_private.weekdays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON capacity_private.weekdays FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION capacity_private.effective_config(
 p_location_id uuid,p_day date
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT coalesce(
  (SELECT config FROM capacity_private.days
   WHERE location_id=p_location_id AND day=p_day),
  (SELECT config FROM capacity_private.weekdays
   WHERE location_id=p_location_id
    AND weekday=extract(dow FROM p_day)::integer)
 );
$$;

CREATE OR REPLACE FUNCTION capacity_private.settings_key(
 p_location_id uuid,p_day date
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT md5(jsonb_build_array(
  (SELECT config FROM capacity_private.days
   WHERE location_id=p_location_id AND day=p_day),
  (SELECT jsonb_build_array(config,version)
   FROM capacity_private.weekdays
   WHERE location_id=p_location_id
    AND weekday=extract(dow FROM p_day)::integer)
 )::text);
$$;

DO $patch$
DECLARE d text;old_text text;new_text text;cut integer;
BEGIN
 -- Reuse the installed permission and configuration validation,
 -- without writing a temporary date or generating a temporary audit entry.
 d:=pg_get_functiondef(
  'public.reservation_capacity_settings(uuid,date,jsonb)'::regprocedure
 );
 d:=replace(d,'jsonb_array_length(entry) NOT BETWEEN 2 AND 6',
               'jsonb_array_length(entry) NOT BETWEEN 2 AND 100');
 d:=replace(d,'Approved joined groups require 2–6 tables.',
               'Approved joined groups require 2–100 tables.');
 EXECUTE d;
 cut:=position('INSERT INTO capacity_private.days' IN d);
 IF cut=0 THEN
  RAISE EXCEPTION 'Capacity settings source changed. No changes applied.';
 END IF;
 d:=replace(
  left(d,cut-1)||'NULL; END $function$;',
  'public.reservation_capacity_settings(',
  'capacity_private.validate_config('
 );
 EXECUTE d;

 d:=pg_get_functiondef(
  'public.reservation_capacity_load(uuid,date)'::regprocedure
 );
 IF position('weekly-capacity-v1' IN d)=0 THEN
  old_text:='SELECT[[:space:]]+config[[:space:]]+INTO[[:space:]]+cfg[[:space:]]+FROM[[:space:]]+capacity_private[.]days[[:space:]]+WHERE[[:space:]]+location_id[[:space:]]*=[[:space:]]*p_location_id[[:space:]]+AND[[:space:]]+day[[:space:]]*=[[:space:]]*p_day[[:space:]]*;[[:space:]]*ready[[:space:]]*:=[[:space:]]*cfg[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]*;';
  new_text:='-- weekly-capacity-v1
 SELECT capacity_private.effective_config(p_location_id,p_day) INTO cfg;
 ready:=cfg IS NOT NULL;';
  IF d !~ old_text THEN
   RAISE EXCEPTION 'Capacity loader source changed. No changes applied.';
  END IF;
  d:=regexp_replace(d,old_text,new_text);
  old_text:='coalesce\([[:space:]]*l[.]minutes,[[:space:]]*\(d[.]config->>''duration''\)::integer,[[:space:]]*\(cfg->>''duration''\)::integer[[:space:]]*\)';
  IF d !~ old_text THEN
   RAISE EXCEPTION 'Booking duration source changed. No changes applied.';
  END IF;
  d:=regexp_replace(d,old_text,
   'coalesce(l.minutes,(capacity_private.effective_config(r.location_id,r.reservation_date)->>''duration'')::integer,(cfg->>''duration'')::integer)');
  old_text:='''configured'',ready,';
  IF position(old_text IN d)=0 THEN
   RAISE EXCEPTION 'Capacity payload source changed. No changes applied.';
  END IF;
  d:=replace(d,old_text,
   '''configured'',ready,
    ''settings_key'',capacity_private.settings_key(p_location_id,p_day),
    ''date_override'',EXISTS(SELECT 1 FROM capacity_private.days WHERE location_id=p_location_id AND day=p_day),
    ''weekly_config'',(SELECT config FROM capacity_private.weekdays WHERE location_id=p_location_id AND weekday=extract(dow FROM p_day)::integer),
    ');
  EXECUTE d;
 END IF;

 d:=pg_get_functiondef(
  'public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb)'::regprocedure
 );
 IF position('capacity_private.days,capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE' IN d)=0 THEN
  old_text:='capacity_private[.]days[[:space:]]+IN[[:space:]]+SHARE[[:space:]]+ROW[[:space:]]+EXCLUSIVE[[:space:]]+MODE';
  IF d !~ old_text THEN
   RAISE EXCEPTION 'Capacity booking lock changed. No changes applied.';
  END IF;
  EXECUTE regexp_replace(d,old_text,
   'capacity_private.days,capacity_private.weekdays IN SHARE ROW EXCLUSIVE MODE');
 END IF;
END;
$patch$;

CREATE OR REPLACE FUNCTION public.reservation_capacity_settings_save(
 p_location_id uuid,p_day date,p_config jsonb,p_scope text,p_expected text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE before_config jsonb;
BEGIN
 IF auth.uid() IS NULL
 OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.mod_is_manager(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN
  RAISE EXCEPTION 'Management reservation access required.'
   USING errcode='42501';
 END IF;
 IF p_day IS NULL OR p_scope IS NULL
 OR p_scope NOT IN('weekly','date','reset') THEN
  RAISE EXCEPTION 'Choose a date and weekly or date settings.';
 END IF;
 LOCK TABLE capacity_private.days,capacity_private.weekdays
  IN SHARE ROW EXCLUSIVE MODE;
 IF p_expected IS DISTINCT FROM
    capacity_private.settings_key(p_location_id,p_day) THEN
  RAISE EXCEPTION 'Service settings changed. Reload before saving.';
 END IF;

 IF p_scope='reset' THEN
  IF NOT EXISTS(
   SELECT 1 FROM capacity_private.weekdays
   WHERE location_id=p_location_id
    AND weekday=extract(dow FROM p_day)::integer
  ) THEN
   RAISE EXCEPTION 'Save recurring settings for this weekday first.';
  END IF;
  SELECT config INTO before_config FROM capacity_private.days
   WHERE location_id=p_location_id AND day=p_day;
  DELETE FROM capacity_private.days
   WHERE location_id=p_location_id AND day=p_day;
  INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
  VALUES(p_location_id,p_day,auth.uid(),'use weekly settings',
   jsonb_build_object('before',before_config));
 ELSIF p_scope='date' THEN
  PERFORM public.reservation_capacity_settings(
   p_location_id,p_day,p_config
  );
 ELSE
  PERFORM capacity_private.validate_config(
   p_location_id,p_day,p_config
  );
  SELECT config INTO before_config FROM capacity_private.weekdays
   WHERE location_id=p_location_id
    AND weekday=extract(dow FROM p_day)::integer;
  INSERT INTO capacity_private.weekdays(
   location_id,weekday,config,updated_by
  ) VALUES(
   p_location_id,extract(dow FROM p_day)::integer,p_config,auth.uid()
  )
  ON CONFLICT(location_id,weekday) DO UPDATE SET
   config=excluded.config,version=weekdays.version+1,
   updated_by=auth.uid(),updated_at=clock_timestamp();
  INSERT INTO capacity_private.audit(location_id,day,actor,action,details)
  VALUES(p_location_id,p_day,auth.uid(),'weekly settings',
   jsonb_build_object('weekday',extract(dow FROM p_day)::integer,
                     'before',before_config,'after',p_config));
 END IF;
END;
$$;

REVOKE ALL ON FUNCTION
 capacity_private.effective_config(uuid,date),
 capacity_private.settings_key(uuid,date),
 capacity_private.validate_config(uuid,date,jsonb),
 public.reservation_capacity_settings_save(uuid,date,jsonb,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
 public.reservation_capacity_settings_save(uuid,date,jsonb,text,text)
 TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
