BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('home-responsive-repair-20261028',0));
CREATE TABLE IF NOT EXISTS public.app_ui_layout_backups (
 migration text NOT NULL, record_key text NOT NULL,
 before_value jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(migration,record_key)
);
ALTER TABLE public.app_ui_layout_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_ui_layout_backups FROM PUBLIC,anon,authenticated;
-- Remove only old Home size/offset overrides. Keep order, fonts, colors,
-- visibility, panel/popups, wording, custom sections, and personal themes.
CREATE OR REPLACE FUNCTION pg_temp.fit_home(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_object_agg(key,CASE
 WHEN key LIKE 'home.%' OR key='crew.chat.preview'
 THEN value-ARRAY['width','height','minHeight','offsetX','offsetY','x','y']::text[]
 ELSE value END),'{}'::jsonb)
 FROM jsonb_each(coalesce(p,'{}'::jsonb));
$$;
LOCK TABLE public.page_designs IN SHARE ROW EXCLUSIVE MODE;
WITH candidates AS (
 SELECT d.*,pg_temp.fit_home(changes) cleaned
 FROM public.page_designs d WHERE page='/'
 AND NOT EXISTS(SELECT 1 FROM public.app_ui_layout_backups b
 WHERE b.migration='home_responsive_20261028_v1'
 AND b.record_key='page:'||d.location_id::text)
),backed AS (
 INSERT INTO public.app_ui_layout_backups(migration,record_key,before_value)
 SELECT 'home_responsive_20261028_v1','page:'||location_id::text,
 to_jsonb(c)-'cleaned' FROM candidates c RETURNING record_key
)
UPDATE public.page_designs d SET changes=c.cleaned,version=d.version+1,updated_at=now()
FROM candidates c JOIN backed b ON b.record_key='page:'||c.location_id::text
WHERE d.location_id=c.location_id AND d.page='/' AND c.cleaned IS DISTINCT FROM d.changes;
DO $roles$
BEGIN
 IF to_regclass('staff_preview_private.layouts') IS NOT NULL THEN
 LOCK TABLE staff_preview_private.layouts IN SHARE ROW EXCLUSIVE MODE;
 WITH candidates AS (
 SELECT d.*,pg_temp.fit_home(draft) clean_draft,pg_temp.fit_home(published) clean_published
 FROM staff_preview_private.layouts d WHERE page='/'
 AND NOT EXISTS(SELECT 1 FROM public.app_ui_layout_backups b
 WHERE b.migration='home_responsive_20261028_v1'
 AND b.record_key='role:'||d.location_id::text||':'||d.scope)
 ),backed AS (
 INSERT INTO public.app_ui_layout_backups(migration,record_key,before_value)
 SELECT 'home_responsive_20261028_v1','role:'||location_id::text||':'||scope,
 to_jsonb(c)-'clean_draft'-'clean_published' FROM candidates c RETURNING record_key
 )
 UPDATE staff_preview_private.layouts d SET draft=c.clean_draft,published=c.clean_published,
 version=d.version+1,changed_at=now()
 FROM candidates c JOIN backed b ON b.record_key='role:'||c.location_id::text||':'||c.scope
 WHERE d.location_id=c.location_id AND d.page='/' AND d.scope=c.scope
 AND (c.clean_draft IS DISTINCT FROM d.draft OR c.clean_published IS DISTINCT FROM d.published);
 END IF;
END;
$roles$;
COMMIT;
SELECT true AS home_layout_repair_applied,false AS production_behavior_verified;
