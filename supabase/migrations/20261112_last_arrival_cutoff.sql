BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE spec record; definition text; pattern text; changed text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
 ('capacity_private.apply_before_blocks(uuid,date,text,jsonb,jsonb)',
 'start_min[[:space:]]*\+[[:space:]]*duration[[:space:]]*\+[[:space:]]*\(data->''config''->>''buffer''\)::integer[[:space:]]*>[[:space:]]*\(data->>''close''\)::numeric',
 'start_min > (data->>''close'')::numeric - 15'),
 ('public.reservation_save_verified(uuid,uuid,jsonb,text,jsonb,integer,text,text)',
 'starts[[:space:]]*\+[[:space:]]*p_duration[[:space:]]*\+[[:space:]]*\(data->''config''->>''buffer''\)::integer[[:space:]]*>[[:space:]]*\(data->>''close''\)::numeric',
 'starts > (data->>''close'')::numeric - 15')
 ) AS patches(signature,search,replacement)
 LOOP
  definition:=pg_get_functiondef(spec.signature::regprocedure);
  IF position(spec.replacement IN definition)>0 THEN CONTINUE;END IF;
  IF definition !~ spec.search THEN
   RAISE EXCEPTION 'Arrival rule source differs for %. No changes applied.',spec.signature;
  END IF;
  changed:=regexp_replace(definition,spec.search,spec.replacement);
  EXECUTE changed;
 END LOOP;
END;
$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
