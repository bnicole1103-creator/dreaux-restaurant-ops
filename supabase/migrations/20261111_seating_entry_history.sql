BEGIN;
CREATE TABLE IF NOT EXISTS capacity_private.entry_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_id uuid NOT NULL,
 entry_kind text NOT NULL CHECK(entry_kind IN('reservation','seating')),
 entry_id uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 changed_by uuid,
 actor_name text NOT NULL,
 action text NOT NULL,
 before_record jsonb,
 after_record jsonb
);
CREATE INDEX IF NOT EXISTS entry_history_lookup
 ON capacity_private.entry_history(location_id,entry_kind,entry_id,id DESC);
ALTER TABLE capacity_private.entry_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON capacity_private.entry_history FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE capacity_private.entry_history_id_seq
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION capacity_private.record_entry_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE a jsonb;b jsonb;loc uuid;eid uuid;kind text;actor text;sid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN a:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN b:=to_jsonb(NEW);END IF;
 IF TG_OP='UPDATE' AND
  (a-ARRAY['updated_at','edit_version','version'])
   IS NOT DISTINCT FROM
  (b-ARRAY['updated_at','edit_version','version'])
 THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='reservations' THEN
  kind:='reservation';eid:=(coalesce(b,a)->>'id')::uuid;
  loc:=(coalesce(b,a)->>'location_id')::uuid;
 ELSE
  kind:='seating';
  IF TG_TABLE_NAME='table_session_tables' THEN
   eid:=(coalesce(b,a)->>'table_session_id')::uuid;
   SELECT shift_id INTO sid FROM public.table_sessions WHERE id=eid;
  ELSE
   eid:=(coalesce(b,a)->>'id')::uuid;
   sid:=(coalesce(b,a)->>'shift_id')::uuid;
  END IF;
  SELECT location_id INTO loc FROM public.shifts WHERE id=sid;
 END IF;
 IF TG_TABLE_NAME='table_sessions' THEN
  IF a IS NOT NULL THEN a:=a||jsonb_build_object('table_ids',coalesce((
   SELECT jsonb_agg(table_id ORDER BY table_id) FROM public.table_session_tables WHERE table_session_id=eid
  ),'[]'::jsonb));END IF;
  IF b IS NOT NULL THEN b:=b||jsonb_build_object('table_ids',coalesce((
   SELECT jsonb_agg(table_id ORDER BY table_id) FROM public.table_session_tables WHERE table_session_id=eid
  ),'[]'::jsonb));END IF;
 END IF;
 IF loc IS NOT NULL AND eid IS NOT NULL THEN
  SELECT coalesce(nullif(preferred_name,''),nullif(full_name,''),'Staff member')
  INTO actor FROM public.profiles WHERE id=auth.uid();
  INSERT INTO capacity_private.entry_history(
   location_id,entry_kind,entry_id,changed_by,actor_name,action,
   before_record,after_record
  ) VALUES(
   loc,kind,eid,auth.uid(),
   coalesce(actor,CASE WHEN auth.uid() IS NULL THEN 'System / integration'
                      ELSE 'Staff member' END),
   CASE WHEN TG_TABLE_NAME='table_session_tables'
     THEN CASE WHEN TG_OP='INSERT' THEN 'Table added'
               WHEN TG_OP='DELETE' THEN 'Table removed' ELSE 'Table changed' END
     ELSE CASE WHEN TG_OP='INSERT' THEN 'Created'
               WHEN TG_OP='DELETE' THEN 'Removed' ELSE 'Updated' END END,
   a,b
  );
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END;
$$;

DROP TRIGGER IF EXISTS reservation_entry_history ON public.reservations;
CREATE TRIGGER reservation_entry_history
 AFTER INSERT OR UPDATE OR DELETE ON public.reservations
 FOR EACH ROW EXECUTE FUNCTION capacity_private.record_entry_history();

DROP TRIGGER IF EXISTS seating_entry_history ON public.table_sessions;
CREATE TRIGGER seating_entry_history
 AFTER INSERT OR UPDATE ON public.table_sessions
 FOR EACH ROW EXECUTE FUNCTION capacity_private.record_entry_history();

DROP TRIGGER IF EXISTS seating_delete_history ON public.table_sessions;
CREATE TRIGGER seating_delete_history
 BEFORE DELETE ON public.table_sessions
 FOR EACH ROW EXECUTE FUNCTION capacity_private.record_entry_history();

DROP TRIGGER IF EXISTS seating_table_entry_history ON public.table_session_tables;
CREATE TRIGGER seating_table_entry_history
 AFTER INSERT OR UPDATE OR DELETE ON public.table_session_tables
 FOR EACH ROW EXECUTE FUNCTION capacity_private.record_entry_history();

CREATE OR REPLACE FUNCTION public.reservation_entry_history(
 p_location_id uuid,p_kind text,p_id uuid,p_before bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE current_record jsonb;events jsonb;labels jsonb;
BEGIN
 IF auth.uid() IS NULL
 OR public.closeout_is_member(p_location_id) IS NOT TRUE
 OR public.app_access_allowed(p_location_id,'floor','reservations') IS NOT TRUE
 THEN RAISE EXCEPTION 'Reservation access required.' USING errcode='42501';END IF;
 IF p_kind NOT IN('reservation','seating') OR p_kind IS NULL THEN
  RAISE EXCEPTION 'Choose a reservation or seated party.';
 END IF;
 IF p_kind='reservation' THEN
  SELECT to_jsonb(r) INTO current_record FROM public.reservations r
  WHERE r.id=p_id AND r.location_id=p_location_id;
 ELSE
  SELECT to_jsonb(s)||jsonb_build_object('table_ids',coalesce((
   SELECT jsonb_agg(table_id) FROM public.table_session_tables
   WHERE table_session_id=s.id
  ),'[]'::jsonb)) INTO current_record
  FROM public.table_sessions s JOIN public.shifts sh ON sh.id=s.shift_id
  WHERE s.id=p_id AND sh.location_id=p_location_id;
 END IF;
 IF current_record IS NULL AND NOT EXISTS(
  SELECT 1 FROM capacity_private.entry_history
  WHERE location_id=p_location_id AND entry_kind=p_kind AND entry_id=p_id
 ) THEN RAISE EXCEPTION 'Entry unavailable.';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]'::jsonb)
 INTO events FROM (
  SELECT id,changed_at,changed_by,actor_name,action,before_record,after_record
  FROM capacity_private.entry_history
  WHERE location_id=p_location_id AND entry_kind=p_kind AND entry_id=p_id
   AND (p_before IS NULL OR id<p_before)
  ORDER BY id DESC LIMIT 51
 ) x;
 SELECT coalesce(jsonb_object_agg(id,name),'{}'::jsonb) INTO labels FROM (
  SELECT t.id::text id,t.table_name name FROM public.floor_tables t
  WHERE t.location_id=p_location_id
  UNION
  SELECT p.id::text,coalesce(nullif(p.preferred_name,''),nullif(p.full_name,''),'Staff member')
  FROM public.profiles p JOIN public.location_memberships m ON m.user_id=p.id
  WHERE m.location_id=p_location_id
 ) names;
 RETURN jsonb_build_object('current',current_record,'events',events,'labels',labels);
END;
$$;
REVOKE ALL ON FUNCTION capacity_private.record_entry_history(),
 public.reservation_entry_history(uuid,text,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_entry_history(uuid,text,uuid,bigint)
 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
