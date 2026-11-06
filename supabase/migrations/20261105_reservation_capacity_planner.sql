BEGIN;
SET LOCAL lock_timeout='5s';
DO $prerequisites$
BEGIN
 IF to_regprocedure('public.reservation_submit(uuid,jsonb)') IS NULL OR to_regprocedure('public.app_access_allowed(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'Install the existing reservation submit and access workflows first. No changes applied.';END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='table_ids') THEN RAISE EXCEPTION 'Reservation table selection is missing. No changes applied.';END IF;
END $prerequisites$;
CREATE SCHEMA IF NOT EXISTS capacity_private;
REVOKE ALL ON SCHEMA capacity_private FROM public,anon,authenticated;
CREATE TABLE IF NOT EXISTS capacity_private.days(location_id uuid NOT NULL REFERENCES public.locations(id),day date NOT NULL,config jsonb NOT NULL,updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(location_id,day));
CREATE TABLE IF NOT EXISTS capacity_private.lengths(reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id),minutes integer NOT NULL CHECK(minutes BETWEEN 15 AND 480));
CREATE TABLE IF NOT EXISTS capacity_private.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,location_id uuid NOT NULL,day date NOT NULL,actor uuid NOT NULL,action text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE capacity_private.days ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_private.lengths ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_private.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA capacity_private FROM public,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA capacity_private FROM public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.reservation_capacity_load(p_location_id uuid,p_day date) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb;payload jsonb;tables_json jsonb;bookings_json jsonb;opens timestamptz;closes timestamptz;ready boolean;org uuid;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE THEN RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';END IF;
 IF p_day IS NULL THEN RAISE EXCEPTION 'Choose a day.';END IF;
 SELECT organization_id INTO org FROM public.locations WHERE id=p_location_id;
 SELECT config INTO cfg FROM capacity_private.days WHERE location_id=p_location_id AND day=p_day;ready:=cfg IS NOT NULL;
 cfg:=coalesce(cfg,'{"duration":90,"buffer":15,"step":15,"open":"12:00","close":"22:00","closed":false,"joinGroups":[],"blockedTables":[]}'::jsonb);
 opens:=(p_day+(cfg->>'open')::time) AT TIME ZONE 'America/Chicago';
 closes:=((p_day+CASE WHEN (cfg->>'close')::time<=(cfg->>'open')::time THEN 1 ELSE 0 END)+(cfg->>'close')::time) AT TIME ZONE 'America/Chicago';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.table_name,'seats',t.seat_count,'room',t.room_id,'roomName',r.name) ORDER BY t.id),'[]') INTO tables_json FROM public.floor_tables t JOIN public.rooms r ON r.id=t.room_id AND r.location_id=p_location_id WHERE t.location_id=p_location_id AND r.is_active AND coalesce((to_jsonb(t)->>'is_active')::boolean,true);
 WITH live AS (
  SELECT s.*,to_jsonb(s) j FROM public.table_sessions s JOIN public.shifts sh ON sh.id=s.shift_id WHERE sh.location_id=p_location_id AND s.closed_at IS NULL AND p_day=(now() AT TIME ZONE 'America/Chicago')::date
 ),booked AS (
  SELECT r.id::text id,r.guest_name name,r.party_size party,
   extract(epoch FROM ((r.reservation_date+r.reservation_time::time) AT TIME ZONE 'America/Chicago'))/60 start,
   extract(epoch FROM ((r.reservation_date+r.reservation_time::time) AT TIME ZONE 'America/Chicago'))/60+coalesce(l.minutes,(d.config->>'duration')::integer,(cfg->>'duration')::integer) ending,
   CASE WHEN coalesce(jsonb_array_length(to_jsonb(r)->'table_ids'),0)>0 THEN to_jsonb(r)->'table_ids' WHEN r.table_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.table_id) END ids,
   coalesce(to_jsonb(r)->>'dining_area','') room,r.edit_version version,false is_live
  FROM public.reservations r LEFT JOIN capacity_private.lengths l ON l.reservation_id=r.id LEFT JOIN capacity_private.days d ON d.location_id=r.location_id AND d.day=r.reservation_date
  WHERE r.location_id=p_location_id AND r.reservation_date BETWEEN p_day-1 AND p_day+1
  AND lower(coalesce(r.status,'')) NOT IN ('cancelled','canceled','removed','completed','departed','no_show','no show') AND to_jsonb(r)->>'deleted_at' IS NULL
  AND NOT EXISTS(SELECT 1 FROM live s WHERE s.j->>'reservation_id'=r.id::text)
 ),occupied AS (
  SELECT 'live:'||s.id::text id,coalesce(s.guest_name,'Seated party') name,s.party_size party,extract(epoch FROM s.seated_at)/60 start,
   greatest(extract(epoch FROM closes)/60,extract(epoch FROM s.seated_at)/60+(cfg->>'duration')::integer) ending,
   coalesce((SELECT jsonb_agg(DISTINCT table_id ORDER BY table_id) FROM public.table_session_tables WHERE table_session_id=s.id),jsonb_build_array(s.table_id)) ids,'' room,0 version,true is_live FROM live s
 ),all_rows AS (SELECT * FROM booked UNION ALL SELECT * FROM occupied)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'party',party,'start',start,'end',ending,'tableIds',ids,'room',room,'version',version,'live',is_live) ORDER BY id),'[]') INTO bookings_json FROM all_rows WHERE start IS NULL OR (start<extract(epoch FROM closes)/60 AND ending+(cfg->>'buffer')::integer>extract(epoch FROM opens)/60);
 payload:=jsonb_build_object('day',p_day,'configured',ready,'config',cfg,'tables',tables_json,'bookings',bookings_json,'organization',org,'open',extract(epoch FROM opens)/60,'close',extract(epoch FROM closes)/60);
 RETURN payload||jsonb_build_object('fingerprint',md5(payload::text),'now',extract(epoch FROM now())/60,'canManage',public.mod_is_manager(p_location_id) IS TRUE,'slots',coalesce((SELECT jsonb_agg(jsonb_build_object('value',extract(epoch FROM t)/60,'label',to_char(t AT TIME ZONE 'America/Chicago','FMHH12:MI AM')) ORDER BY t) FROM generate_series(opens,closes,make_interval(mins=>(cfg->>'step')::integer)) t),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.reservation_capacity_settings(p_location_id uuid,p_day date,p_config jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry jsonb;tid text;opened integer;closed integer;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.mod_is_manager(p_location_id) IS NOT TRUE OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE THEN RAISE EXCEPTION 'Management reservation access required.' USING errcode='42501';END IF;
 IF p_day IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR octet_length(p_config::text)>20000 OR (p_config-ARRAY['duration','buffer','step','open','close','closed','joinGroups','blockedTables'])<>'{}'::jsonb OR NOT(p_config ?& ARRAY['duration','buffer','step','open','close','closed','joinGroups','blockedTables']) THEN RAISE EXCEPTION 'Invalid capacity settings.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_config) kv WHERE kv.value='null'::jsonb) THEN RAISE EXCEPTION 'Service settings cannot be blank.';END IF;
 IF (p_config->>'duration')::integer NOT BETWEEN 15 AND 480 OR (p_config->>'buffer')::integer NOT BETWEEN 0 AND 120 OR (p_config->>'step')::integer NOT IN (15,30,60) OR p_config->>'open'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p_config->>'close'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR jsonb_typeof(p_config->'closed')<>'boolean' OR jsonb_typeof(p_config->'joinGroups')<>'array' OR jsonb_typeof(p_config->'blockedTables')<>'array' THEN RAISE EXCEPTION 'Check service times, dining duration, reset time and table groups.';END IF;
 opened:=extract(epoch FROM (p_config->>'open')::time)/60;closed:=extract(epoch FROM (p_config->>'close')::time)/60;IF closed<=opened THEN closed:=closed+1440;END IF;IF closed-opened>1080 THEN RAISE EXCEPTION 'Keep one service window to 18 hours or less.';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_config->'joinGroups') LOOP
  IF jsonb_typeof(entry)<>'array' OR jsonb_array_length(entry) NOT BETWEEN 2 AND 6 THEN RAISE EXCEPTION 'Approved joined groups require 2–6 tables.';END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(entry))<>jsonb_array_length(entry) THEN RAISE EXCEPTION 'Duplicate table in joined group.';END IF;
  IF (SELECT count(DISTINCT t.room_id) FROM jsonb_array_elements_text(entry) id JOIN public.floor_tables t ON t.id::text=id.value WHERE t.location_id=p_location_id)<>1 THEN RAISE EXCEPTION 'Joined tables must be in the same room.';END IF;
 END LOOP;
 FOR tid IN SELECT value FROM jsonb_array_elements_text(p_config->'blockedTables') UNION SELECT ids.value FROM jsonb_array_elements(p_config->'joinGroups') groups CROSS JOIN LATERAL jsonb_array_elements_text(groups.value) ids LOOP
  IF NOT EXISTS(SELECT 1 FROM public.floor_tables WHERE id::text=tid AND location_id=p_location_id) THEN RAISE EXCEPTION 'Unknown table in capacity settings.';END IF;
 END LOOP;
 INSERT INTO capacity_private.days(location_id,day,config,updated_by) VALUES(p_location_id,p_day,p_config,auth.uid()) ON CONFLICT(location_id,day) DO UPDATE SET config=excluded.config,updated_by=auth.uid(),updated_at=clock_timestamp();
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details) VALUES(p_location_id,p_day,auth.uid(),'settings',p_config);
END $$;
CREATE OR REPLACE FUNCTION public.reservation_capacity_apply(p_location_id uuid,p_day date,p_fingerprint text,p_assignments jsonb,p_booking jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE data jsonb;rows jsonb;entry jsonb;other jsonb;ids jsonb;fixed jsonb;seats integer;rid uuid;first_id uuid;new_key text;start_min numeric;duration integer;booking_result jsonb;org uuid;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE THEN RAISE EXCEPTION 'Active reservation access required.' USING errcode='42501';END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.reservations,public.table_sessions,public.table_session_tables,public.floor_tables,public.rooms,capacity_private.days IN SHARE ROW EXCLUSIVE MODE;
 data:=public.reservation_capacity_load(p_location_id,p_day);
 IF data->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Bookings, seating or settings changed. Refresh the planner.' USING errcode='40001';END IF;
 IF (data->>'configured')::boolean IS NOT TRUE OR (data->'config'->>'closed')::boolean THEN RAISE EXCEPTION 'Management must confirm an open service window for this date.';END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'object' OR octet_length(p_assignments::text)>100000 THEN RAISE EXCEPTION 'Invalid table plan.';END IF;
 rows:=data->'bookings';
 IF p_booking IS NOT NULL THEN
  IF jsonb_typeof(p_booking) IS DISTINCT FROM 'object' OR length(coalesce(p_booking->>'phone','')) NOT BETWEEN 1 AND 100 OR length(coalesce(p_booking->>'name','')) NOT BETWEEN 1 AND 200 OR (p_booking->>'party')::integer NOT BETWEEN 1 AND 500 OR length(coalesce(p_booking->>'email',''))>250 THEN RAISE EXCEPTION 'Enter guest name, phone and a valid party size.';END IF;
  start_min:=(p_booking->>'start')::numeric;duration:=(p_booking->>'duration')::integer;new_key:=(p_booking->>'request')::uuid::text;
  IF duration NOT BETWEEN 15 AND 480 OR start_min<(data->>'open')::numeric OR start_min+duration+(data->'config'->>'buffer')::integer>(data->>'close')::numeric OR start_min<(data->>'now')::numeric OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'slots') s WHERE (s->>'value')::numeric=start_min) THEN RAISE EXCEPTION 'Choose a future time inside the service window.';END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('id','candidate','party',(p_booking->>'party')::integer,'name',p_booking->>'name','start',start_min,'end',start_min+duration,'tableIds','[]'::jsonb,'room',coalesce(p_booking->>'room','')));
 END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_assignments))<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Plan must account for every loaded party.';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(rows) LOOP
  ids:=p_assignments->(entry->>'id');
  IF jsonb_typeof(ids) IS DISTINCT FROM 'array' OR jsonb_array_length(ids)=0 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(ids))<>jsonb_array_length(ids) OR entry->>'start' IS NULL OR entry->>'end' IS NULL OR coalesce((entry->>'party')::integer,0)<1 THEN RAISE EXCEPTION 'Every party needs a valid time, size and tables.';END IF;
  fixed:=entry->'tableIds';
  IF jsonb_array_length(fixed)>0 AND (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(fixed)) IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(ids)) THEN RAISE EXCEPTION 'An existing table assignment changed. Edit that reservation first.';END IF;
  IF jsonb_array_length(fixed)=0 AND jsonb_array_length(ids)>1 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'config'->'joinGroups') g WHERE (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(g.value))=(SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(ids))) THEN RAISE EXCEPTION 'Use an approved joined-table group.';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(ids) tid WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'tables') t WHERE t->>'id'=tid.value AND NOT(data->'config'->'blockedTables' ? tid.value) AND (coalesce(entry->>'room','')='' OR t->>'room'=entry->>'room' OR lower(t->>'roomName')=lower(entry->>'room')))) THEN RAISE EXCEPTION 'Table blocked, unavailable or outside the requested room.';END IF;
  SELECT sum((t->>'seats')::integer) INTO seats FROM jsonb_array_elements(data->'tables') t WHERE ids ? (t->>'id');IF coalesce(seats,0)<(entry->>'party')::integer THEN RAISE EXCEPTION 'Party exceeds table capacity.';END IF;
  FOR other IN SELECT value FROM jsonb_array_elements(rows) WHERE value->>'id'<entry->>'id' LOOP
   IF (entry->>'start')::numeric<(other->>'end')::numeric+(data->'config'->>'buffer')::integer AND (other->>'start')::numeric<(entry->>'end')::numeric+(data->'config'->>'buffer')::integer AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(ids) tid WHERE (p_assignments->(other->>'id')) ? tid.value) THEN RAISE EXCEPTION 'Overlapping parties cannot share a table.';END IF;
  END LOOP;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(data->'bookings') WHERE coalesce((value->>'live')::boolean,false)=false AND jsonb_array_length(value->'tableIds')=0 LOOP
  ids:=p_assignments->(entry->>'id');SELECT value::uuid INTO first_id FROM jsonb_array_elements_text(ids) LIMIT 1;
  UPDATE public.reservations SET table_id=first_id,table_ids=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(ids)) WHERE id=(entry->>'id')::uuid AND location_id=p_location_id;
 END LOOP;
 IF p_booking IS NOT NULL THEN
  ids:=p_assignments->'candidate';SELECT value::uuid INTO first_id FROM jsonb_array_elements_text(ids) LIMIT 1;
  org:=(data->>'organization')::uuid;
  booking_result:=public.reservation_submit(p_location_id,jsonb_build_array(jsonb_build_object('organization_id',org,'location_id',p_location_id,'reservation_date',(to_timestamp(start_min*60) AT TIME ZONE 'America/Chicago')::date,'reservation_time',to_char(to_timestamp(start_min*60) AT TIME ZONE 'America/Chicago','HH24:MI'),'guest_name',btrim(p_booking->>'name'),'party_size',(p_booking->>'party')::integer,'phone',p_booking->>'phone','email',nullif(p_booking->>'email',''),'table_ids','[]'::jsonb,'table_id',NULL,'status','booked','dining_area',nullif(p_booking->>'room',''),'notes','Booked with capacity planner','imported_source','manual','external_reservation_id',new_key)));
  SELECT id INTO rid FROM public.reservations WHERE location_id=p_location_id AND external_reservation_id=new_key LIMIT 1;
  IF rid IS NULL THEN RAISE EXCEPTION 'New booking could not be verified. No table plan saved.';END IF;
  UPDATE public.reservations SET table_id=first_id,table_ids=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(ids)) WHERE id=rid AND location_id=p_location_id;
  INSERT INTO capacity_private.lengths VALUES(rid,duration) ON CONFLICT(reservation_id) DO UPDATE SET minutes=excluded.minutes;
 END IF;
 INSERT INTO capacity_private.audit(location_id,day,actor,action,details) VALUES(p_location_id,p_day,auth.uid(),CASE WHEN p_booking IS NULL THEN 'table_plan' ELSE 'booking' END,jsonb_build_object('assignments',p_assignments,'reservation_id',rid));
 RETURN jsonb_build_object('reservation_id',rid,'saved',true);
END $$;
REVOKE ALL ON FUNCTION public.reservation_capacity_load(uuid,date),public.reservation_capacity_settings(uuid,date,jsonb),public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_capacity_load(uuid,date),public.reservation_capacity_settings(uuid,date,jsonb),public.reservation_capacity_apply(uuid,date,text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
