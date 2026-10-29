BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-screen-height-v1',0));
DO $patch$
DECLARE
  target regprocedure := to_regprocedure('public.page_design_save(uuid,text,integer,jsonb)');
  definition text;
  anchor text := 'property[.]key[[:space:]]+in[[:space:]]*\(''width'',[[:space:]]*''minHeight'',[[:space:]]*''iconSize''\)';
  matches integer;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'Screen editor save function is missing. No changes applied.';
  END IF;
  definition := pg_get_functiondef(target);
  IF position('justinis-screen-height-v1' in definition) > 0 THEN RETURN; END IF;
  SELECT count(*) INTO matches FROM regexp_matches(definition,anchor,'gi');
  IF matches <> 1 OR position('justinis-element-geometry-v1' in definition) = 0 THEN
    RAISE EXCEPTION 'Screen editor size validator changed. Export page_design_save(uuid,text,integer,jsonb) for a safe merge. No changes applied.';
  END IF;
  definition := regexp_replace(definition,anchor,
    'property.key in (''width'',''minHeight'',''iconSize'',''height'') /* justinis-screen-height-v1 */','i');
  EXECUTE definition;
END;
$patch$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT true AS screen_editor_height_installed, false AS production_behavior_verified;
