BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE target regprocedure;definition text;pattern text;
BEGIN
 target:=coalesce(
  to_regprocedure('public.reservation_guest_link_load_before_house_policy(text)'),
  to_regprocedure('public.reservation_guest_link_load(text)')
 );
 IF target IS NULL THEN RAISE EXCEPTION 'Guest confirmation loader is missing. No changes applied.';END IF;
 definition:=pg_get_functiondef(target);
 IF definition ~ $rx$'guest_name'[[:space:]]*,[[:space:]]*r[.]guest_name$rx$ THEN RETURN;END IF;
 pattern:=$rx$(RETURN[[:space:]]+jsonb_build_object[[:space:]]*\([[:space:]]*)('date'[[:space:]]*,[[:space:]]*r[.]reservation_date)$rx$;
 IF definition !~* pattern THEN
  RAISE EXCEPTION 'Guest confirmation loader differs. No changes applied.';
 END IF;
 EXECUTE regexp_replace(definition,pattern,
  $replacement$\1'guest_name',r.guest_name,\2$replacement$,'i');
END;
$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
