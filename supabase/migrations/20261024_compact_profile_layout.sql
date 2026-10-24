BEGIN;

CREATE TABLE IF NOT EXISTS public.app_ui_layout_backups (
  migration text NOT NULL,
  record_key text NOT NULL,
  before_value jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration, record_key)
);
ALTER TABLE public.app_ui_layout_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_ui_layout_backups FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.compact_profile_layout(p jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_object_agg(key,
    CASE WHEN key IN (
      'home.profile', 'home.profile.top', 'home.profile.identity',
      'home.targets', 'home.targets.coaching', 'home.targets.calculator',
      'home.targets.scripts', 'crew.chat.preview'
    ) OR key LIKE 'target.clip.%'
    THEN value - ARRAY[
      'width','minHeight','offsetX','offsetY','x','y','parent','order',
      'presentation','defaultOpen','panelTitle'
    ]::text[] ELSE value END
  ), '{}'::jsonb)
  FROM jsonb_each(coalesce(p, '{}'::jsonb));
$$;

LOCK TABLE public.page_designs IN SHARE ROW EXCLUSIVE MODE;
WITH candidates AS (
  SELECT d.*, 'page:' || location_id::text AS backup_key,
    pg_temp.compact_profile_layout(changes) AS cleaned
  FROM public.page_designs d
  WHERE page = '/'
    AND NOT EXISTS (
      SELECT 1 FROM public.app_ui_layout_backups b
      WHERE b.migration = 'compact_profile_20261024_v1'
        AND b.record_key = 'page:' || d.location_id::text
    )
), backed AS (
  INSERT INTO public.app_ui_layout_backups(migration, record_key, before_value)
  SELECT 'compact_profile_20261024_v1', backup_key, to_jsonb(c) - 'cleaned' - 'backup_key'
  FROM candidates c
  RETURNING record_key
)
UPDATE public.page_designs d
SET changes = c.cleaned, version = d.version + 1, updated_at = now()
FROM candidates c JOIN backed b ON b.record_key = c.backup_key
WHERE d.location_id = c.location_id AND d.page = c.page
  AND c.cleaned IS DISTINCT FROM d.changes;

DO $$
BEGIN
  IF to_regclass('staff_preview_private.layouts') IS NOT NULL THEN
    LOCK TABLE staff_preview_private.layouts IN SHARE ROW EXCLUSIVE MODE;
    WITH candidates AS (
      SELECT d.*, 'role:' || location_id::text || ':' || scope AS backup_key,
        pg_temp.compact_profile_layout(draft) AS clean_draft,
        pg_temp.compact_profile_layout(published) AS clean_published
      FROM staff_preview_private.layouts d
      WHERE page = '/'
        AND NOT EXISTS (
          SELECT 1 FROM public.app_ui_layout_backups b
          WHERE b.migration = 'compact_profile_20261024_v1'
            AND b.record_key = 'role:' || d.location_id::text || ':' || d.scope
        )
    ), backed AS (
      INSERT INTO public.app_ui_layout_backups(migration, record_key, before_value)
      SELECT 'compact_profile_20261024_v1', backup_key,
        to_jsonb(c) - 'clean_draft' - 'clean_published' - 'backup_key'
      FROM candidates c
      RETURNING record_key
    )
    UPDATE staff_preview_private.layouts d
    SET draft = c.clean_draft, published = c.clean_published,
      version = d.version + 1, changed_at = now()
    FROM candidates c JOIN backed b ON b.record_key = c.backup_key
    WHERE d.location_id = c.location_id AND d.page = c.page AND d.scope = c.scope
      AND (c.clean_draft IS DISTINCT FROM d.draft OR c.clean_published IS DISTINCT FROM d.published);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT true AS compact_profile_layout_ready;
