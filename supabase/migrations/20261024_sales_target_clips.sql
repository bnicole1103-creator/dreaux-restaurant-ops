BEGIN;
CREATE TABLE IF NOT EXISTS public.sales_target_clips (
 id uuid PRIMARY KEY, location_id uuid NOT NULL REFERENCES public.locations(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 caption text NOT NULL DEFAULT '' CHECK(length(caption)<=1000),
 path text NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 CHECK(path ~ ('^'||location_id::text||'/'||id::text||'/clip\.(mp4|mov|webm)$'))
);
ALTER TABLE public.sales_target_clips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_target_clips FROM PUBLIC,anon,authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('sales-target-videos','sales-target-videos',false,52428800,
 ARRAY['video/mp4','video/quicktime','video/webm'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.sales_target_clip_access(p_path text,p_action text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid; manager boolean;
BEGIN
 IF auth.uid() IS NULL OR p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/clip\.(mp4|mov|webm)$' THEN RETURN false; END IF;
 loc:=split_part(p_path,'/',1)::uuid;
 IF public.closeout_is_member(loc) IS NOT TRUE THEN RETURN false; END IF;
 manager:=public.closeout_is_gm(loc) IS TRUE;
 IF p_action='read' THEN RETURN manager OR EXISTS(SELECT 1 FROM public.sales_target_clips WHERE location_id=loc AND path=p_path); END IF;
 IF p_action IN ('upload','delete') THEN RETURN manager AND NOT EXISTS(SELECT 1 FROM public.sales_target_clips WHERE path=p_path); END IF;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.sales_target_clips_load(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Location membership required.' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('can_manage',public.closeout_is_gm(p_location_id) IS TRUE,
  'clips',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC,c.id)
   FROM public.sales_target_clips c WHERE c.location_id=p_location_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.sales_target_clip_save(p_location_id uuid,p_id uuid,
 p_version integer,p_title text,p_caption text,p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.sales_target_clips; result public.sales_target_clips; meta jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
  OR public.closeout_is_gm(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'GM access required.' USING errcode='42501'; END IF;
 IF p_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 160
  OR length(coalesce(p_caption,''))>1000 OR p_path IS NULL
  OR p_path !~ ('^'||p_location_id::text||'/'||p_id::text||'/clip\.(mp4|mov|webm)$') THEN
  RAISE EXCEPTION 'Choose a video, title and valid caption.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('target-clip:'||p_id::text,0));
 SELECT * INTO prior FROM public.sales_target_clips WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF prior.location_id<>p_location_id OR prior.path<>p_path THEN RAISE EXCEPTION 'Clip does not match this location.'; END IF;
  -- A retry of an already-completed save is safe.
  IF prior.version=coalesce(p_version,0)+1 AND prior.title=btrim(p_title) AND prior.caption=coalesce(p_caption,'') THEN RETURN to_jsonb(prior); END IF;
  IF prior.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'This clip changed. Reload before editing.'; END IF;
  UPDATE public.sales_target_clips SET title=btrim(p_title),caption=coalesce(p_caption,''),version=version+1
   WHERE id=p_id RETURNING * INTO result;
 ELSE
  IF coalesce(p_version,0)<>0 THEN RAISE EXCEPTION 'This clip was removed. Reload the list.'; END IF;
  SELECT metadata INTO meta FROM storage.objects WHERE bucket_id='sales-target-videos' AND name=p_path;
  IF meta IS NULL OR coalesce(meta->>'mimetype','') NOT IN ('video/mp4','video/quicktime','video/webm')
   OR coalesce((meta->>'size')::bigint,0) NOT BETWEEN 1 AND 52428800 THEN
   RAISE EXCEPTION 'Upload a supported video up to 50 MB before publishing.'; END IF;
  INSERT INTO public.sales_target_clips(id,location_id,title,caption,path,created_by)
   VALUES(p_id,p_location_id,btrim(p_title),coalesce(p_caption,''),p_path,auth.uid()) RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;

CREATE OR REPLACE FUNCTION public.sales_target_clip_remove(p_location_id uuid,p_id uuid,p_version integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed text;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
  OR public.closeout_is_gm(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'GM access required.' USING errcode='42501'; END IF;
 DELETE FROM public.sales_target_clips WHERE id=p_id AND location_id=p_location_id AND version=p_version RETURNING path INTO removed;
 IF removed IS NULL THEN RAISE EXCEPTION 'This clip changed or was removed. Reload the list.'; END IF;
 RETURN removed;
END $$;

-- Restrictive policies protect this private bucket even if broader storage policies exist.
DO $policies$
DECLARE action text; operation text; predicate text;
BEGIN
 FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','DELETE','UPDATE'] LOOP
  action:=CASE operation WHEN 'SELECT' THEN 'read' WHEN 'INSERT' THEN 'upload' ELSE 'delete' END;
  predicate:=CASE WHEN operation='UPDATE' THEN 'false' ELSE format('public.sales_target_clip_access(name,%L)',action) END;
  EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects','target_clips_'||lower(operation));
  EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects','target_clips_'||lower(operation)||'_guard');
  IF operation IN ('SELECT','DELETE') THEN
   EXECUTE format('CREATE POLICY %I ON storage.objects FOR %s TO authenticated USING(bucket_id=''sales-target-videos'' AND %s)', 'target_clips_'||lower(operation),operation,predicate);
   EXECUTE format('CREATE POLICY %I ON storage.objects AS RESTRICTIVE FOR %s TO authenticated USING(bucket_id<>''sales-target-videos'' OR %s)', 'target_clips_'||lower(operation)||'_guard',operation,predicate);
  ELSIF operation='INSERT' THEN
   EXECUTE format('CREATE POLICY target_clips_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id=''sales-target-videos'' AND %s)',predicate);
   EXECUTE format('CREATE POLICY target_clips_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>''sales-target-videos'' OR %s)',predicate);
  ELSE
   CREATE POLICY target_clips_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
    USING(bucket_id<>'sales-target-videos') WITH CHECK(bucket_id<>'sales-target-videos');
  END IF;
 END LOOP;
END $policies$;
REVOKE ALL ON FUNCTION public.sales_target_clip_access(text,text), public.sales_target_clips_load(uuid),
 public.sales_target_clip_save(uuid,uuid,integer,text,text,text),public.sales_target_clip_remove(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_target_clip_access(text,text),public.sales_target_clips_load(uuid),
 public.sales_target_clip_save(uuid,uuid,integer,text,text,text),public.sales_target_clip_remove(uuid,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
