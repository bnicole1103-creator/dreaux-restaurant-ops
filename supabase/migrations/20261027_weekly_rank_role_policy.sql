BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-weekly-rank-role-policy', 0));

DO $requirements$
BEGIN
  IF to_regclass('leaderboard_private.publications') IS NULL
    OR to_regprocedure('leaderboard_private.live_dashboard(uuid,date)') IS NULL
    OR to_regprocedure('public.mod_is_manager(uuid)') IS NULL
    OR to_regprocedure('public.closeout_is_gm(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Leaderboard or role prerequisites are missing. No update applied.';
  END IF;
END;
$requirements$;

ALTER TABLE leaderboard_private.publications
  ADD COLUMN IF NOT EXISTS week_start date,
  ADD COLUMN IF NOT EXISTS revision integer,
  ADD COLUMN IF NOT EXISTS replaces_id uuid;

WITH ranked AS (
  SELECT id,
    ((published_at AT TIME ZONE 'America/Chicago')::date
      - (extract(isodow FROM published_at AT TIME ZONE 'America/Chicago')::integer - 1)) AS calculated_week,
    row_number() OVER (
      PARTITION BY location_id,
        ((published_at AT TIME ZONE 'America/Chicago')::date
          - (extract(isodow FROM published_at AT TIME ZONE 'America/Chicago')::integer - 1))
      ORDER BY published_at, id
    ) AS calculated_revision,
    lag(id) OVER (
      PARTITION BY location_id,
        ((published_at AT TIME ZONE 'America/Chicago')::date
          - (extract(isodow FROM published_at AT TIME ZONE 'America/Chicago')::integer - 1))
      ORDER BY published_at, id
    ) AS calculated_replaces
  FROM leaderboard_private.publications
)
UPDATE leaderboard_private.publications p
SET week_start = coalesce(p.week_start, r.calculated_week),
    revision = coalesce(p.revision, r.calculated_revision),
    replaces_id = coalesce(p.replaces_id, r.calculated_replaces)
FROM ranked r
WHERE r.id = p.id
  AND (p.week_start IS NULL OR p.revision IS NULL OR p.replaces_id IS NULL);

ALTER TABLE leaderboard_private.publications
  ALTER COLUMN week_start SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN revision SET DEFAULT 1;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leaderboard_private.publications'::regclass
      AND conname = 'leaderboard_publications_revision_positive'
  ) THEN
    ALTER TABLE leaderboard_private.publications
      ADD CONSTRAINT leaderboard_publications_revision_positive CHECK (revision > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leaderboard_private.publications'::regclass
      AND conname = 'leaderboard_publications_replaces_fk'
  ) THEN
    ALTER TABLE leaderboard_private.publications
      ADD CONSTRAINT leaderboard_publications_replaces_fk
      FOREIGN KEY (replaces_id) REFERENCES leaderboard_private.publications(id);
  END IF;
END;
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_publications_week_revision
  ON leaderboard_private.publications(location_id, week_start, revision);
CREATE INDEX IF NOT EXISTS leaderboard_publications_active_week
  ON leaderboard_private.publications(location_id, week_start DESC, revision DESC, published_at DESC);

CREATE OR REPLACE FUNCTION public.management_can_edit_user(
  p_location_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT public.mod_is_manager(p_location_id) IS TRUE
    AND EXISTS (
      SELECT 1
      FROM public.location_memberships m
      LEFT JOIN public.closeout_permissions p
        ON p.location_id = m.location_id AND p.user_id = m.user_id
      WHERE m.location_id = p_location_id
        AND m.user_id = p_user_id
        AND m.status = 'active'
        AND (
          public.closeout_is_gm(p_location_id) IS TRUE
          OR coalesce(
            p.access_level,
            CASE
              WHEN m.role = 'owner' THEN 'owner'
              WHEN m.role = 'general_manager' THEN 'general_manager'
              WHEN m.role IN ('manager', 'assistant_manager') THEN 'manager'
              ELSE 'staff'
            END
          ) = 'staff'
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.mod_points_dashboard(p_location_id uuid, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $dashboard$
DECLARE
  live jsonb;
  published jsonb;
  mine jsonb;
  published_rank jsonb;
  can_board boolean;
BEGIN
  IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Location access required.' USING errcode = '42501';
  END IF;
  live := leaderboard_private.live_dashboard(p_location_id, p_month);
  can_board := public.app_access_allowed(p_location_id, 'points', 'leaderboard') IS TRUE;
  IF can_board THEN
    SELECT to_jsonb(p) INTO published
    FROM leaderboard_private.publications p
    WHERE p.location_id = p_location_id
      AND p.month = date_trunc('month', p_month)::date
    ORDER BY p.week_start DESC, p.revision DESC, p.published_at DESC, p.id DESC
    LIMIT 1;
  END IF;
  SELECT s INTO mine FROM jsonb_array_elements(live->'standings') s
    WHERE s->>'user_id' = auth.uid()::text;
  SELECT s->'rank' INTO published_rank
  FROM jsonb_array_elements(coalesce(published->'standings', '[]'::jsonb)) s
  WHERE s->>'user_id' = auth.uid()::text;
  RETURN jsonb_build_object(
    'standings', CASE
      WHEN NOT can_board THEN '[]'::jsonb
      WHEN public.mod_is_manager(p_location_id) IS TRUE THEN live->'standings'
      ELSE coalesce(published->'standings', '[]'::jsonb)
    END,
    'mine', CASE WHEN mine IS NULL THEN NULL ELSE (mine - 'rank') ||
      jsonb_build_object('rank', published_rank) END,
    'history', coalesce(live->'history', '[]'::jsonb),
    'published', published
  );
END;
$dashboard$;

CREATE OR REPLACE FUNCTION public.publish_weekly_points_leaderboard(
  p_location_id uuid,
  p_month date,
  p_week_start date,
  p_expected_publication uuid,
  p_expected_standings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $publish$
DECLARE
  latest uuid;
  replaced uuid;
  next_revision integer;
  live jsonb;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
    OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Management access required.' USING errcode = '42501';
  END IF;
  PERFORM public.app_access_assert(p_location_id, 'points', 'leaderboard');
  IF p_month IS NULL THEN RAISE EXCEPTION 'Select a month.'; END IF;
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'Choose the Monday that starts the publication week.';
  END IF;
  IF p_week_start < date_trunc('month', p_month)::date - 6
    OR p_week_start >= date_trunc('month', p_month)::date + interval '1 month' THEN
    RAISE EXCEPTION 'The publication week must overlap the selected points month.';
  END IF;
  IF jsonb_typeof(p_expected_standings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Refresh the standings before publishing.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'leaderboard:' || p_location_id::text || ':' || p_week_start::text, 0
  ));

  SELECT id INTO latest
  FROM leaderboard_private.publications
  WHERE location_id = p_location_id
    AND month = date_trunc('month', p_month)::date
  ORDER BY week_start DESC, revision DESC, published_at DESC, id DESC
  LIMIT 1;
  IF latest IS DISTINCT FROM p_expected_publication THEN
    RAISE EXCEPTION 'A newer leaderboard was published. Refresh before publishing.';
  END IF;

  SELECT id, revision + 1 INTO replaced, next_revision
  FROM leaderboard_private.publications
  WHERE location_id = p_location_id AND week_start = p_week_start
  ORDER BY revision DESC, published_at DESC, id DESC
  LIMIT 1;
  next_revision := coalesce(next_revision, 1);

  live := leaderboard_private.live_dashboard(p_location_id, p_month);
  IF live->'standings' IS DISTINCT FROM p_expected_standings THEN
    RAISE EXCEPTION 'Points changed since this preview. Refresh and review before publishing.';
  END IF;

  INSERT INTO leaderboard_private.publications(
    location_id, month, week_start, revision, replaces_id, standings, published_by
  ) VALUES (
    p_location_id, date_trunc('month', p_month)::date, p_week_start,
    next_revision, replaced, live->'standings', auth.uid()
  ) RETURNING to_jsonb(publications) INTO result;
  RETURN result;
END;
$publish$;

CREATE OR REPLACE FUNCTION public.publish_points_leaderboard(
  p_location_id uuid, p_month date, p_expected_publication uuid, p_expected_standings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $compatibility$
DECLARE
  central_day date := (now() AT TIME ZONE 'America/Chicago')::date;
  week_start date;
BEGIN
  week_start := central_day - (extract(isodow FROM central_day)::integer - 1);
  RETURN public.publish_weekly_points_leaderboard(
    p_location_id, p_month, week_start, p_expected_publication, p_expected_standings
  );
END;
$compatibility$;

CREATE OR REPLACE FUNCTION public.points_gm_entries(p_location_id uuid, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE month_start date := date_trunc('month', p_month)::date;
BEGIN
  IF public.mod_is_manager(p_location_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Management access required.' USING errcode = '42501';
  END IF;
  IF month_start IS NULL THEN RAISE EXCEPTION 'Select a month.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(e) ORDER BY business_date DESC, name, entry_key)
    FROM (
      SELECT s.user_id, s.business_date, s.entry_key,
        s.points AS original_points, coalesce(o.points, s.points) AS points,
        s.description,
        coalesce(nullif(p.preferred_name, ''), nullif(p.full_name, ''), 'Team member') AS name,
        o.reason, o.updated_at, o.updated_by
      FROM public.points_source_entries(p_location_id) s
      LEFT JOIN public.profiles p ON p.id = s.user_id
      LEFT JOIN public.point_entry_overrides o
        ON o.location_id = p_location_id AND o.user_id = s.user_id AND o.entry_key = s.entry_key
      WHERE s.business_date >= month_start
        AND s.business_date < month_start + interval '1 month'
        AND public.management_can_edit_user(p_location_id, s.user_id)
    ) e
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.points_gm_edit(
  p_location_id uuid, p_user_id uuid, p_entry_key text,
  p_points integer, p_expected integer, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE original integer; current_points integer; next_points integer;
BEGIN
  IF public.management_can_edit_user(p_location_id, p_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Management may edit staff entries. Owner or General Manager access is required for management entries.'
      USING errcode = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Enter a reason for the edit.';
  END IF;
  IF p_points IS NOT NULL AND p_points NOT BETWEEN -10000 AND 10000 THEN
    RAISE EXCEPTION 'Points must be between -10000 and 10000.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_location_id::text || p_user_id::text || p_entry_key, 0
  ));
  SELECT s.points INTO original
  FROM public.points_source_entries(p_location_id) s
  WHERE s.user_id = p_user_id AND s.entry_key = p_entry_key;
  IF original IS NULL THEN RAISE EXCEPTION 'Point entry not found. Refresh the list.'; END IF;
  SELECT coalesce((
    SELECT points FROM public.point_entry_overrides
    WHERE location_id = p_location_id AND user_id = p_user_id AND entry_key = p_entry_key
  ), original) INTO current_points;
  IF current_points IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'Points changed. Refresh before editing.';
  END IF;
  next_points := coalesce(p_points, original);
  IF p_points IS NULL THEN
    DELETE FROM public.point_entry_overrides
    WHERE location_id = p_location_id AND user_id = p_user_id AND entry_key = p_entry_key;
  ELSE
    INSERT INTO public.point_entry_overrides(
      location_id, user_id, entry_key, points, reason, updated_by
    ) VALUES (
      p_location_id, p_user_id, p_entry_key, p_points, btrim(p_reason), auth.uid()
    ) ON CONFLICT(location_id, user_id, entry_key) DO UPDATE SET
      points = excluded.points, reason = excluded.reason,
      updated_by = excluded.updated_by, updated_at = now();
  END IF;
  INSERT INTO public.point_entry_edit_audit(
    location_id, user_id, entry_key, previous_points, new_points, reason, changed_by
  ) VALUES (
    p_location_id, p_user_id, p_entry_key, current_points, next_points,
    btrim(p_reason), auth.uid()
  );
END;
$function$;

UPDATE public.screen_wording
SET wording = regexp_replace(wording, '\mGM\M', 'General Manager', 'g'),
    updated_at = clock_timestamp()
WHERE wording ~ '\mGM\M';

UPDATE public.screen_wording
SET wording = replace(
      wording,
      '−5 points per missed quiz',
      '−10 points per missed quiz'
    ),
    updated_at = clock_timestamp()
WHERE wording_key = 'sectioncopy.30eca7c7d8ff71e3f79e'
  AND wording LIKE '%−5 points per missed quiz%';

DO $wording$
DECLARE f record; definition text;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname IN ('public', 'leaderboard_private')
      AND l.lanname IN ('plpgsql', 'sql')
      AND pg_get_functiondef(p.oid) LIKE '%GM access required.%'
  LOOP
    definition := replace(
      pg_get_functiondef(f.oid),
      'GM access required.',
      'Owner or General Manager access required.'
    );
    EXECUTE definition;
  END LOOP;
END;
$wording$;

REVOKE ALL ON FUNCTION public.management_can_edit_user(uuid,uuid),
  public.publish_weekly_points_leaderboard(uuid,date,date,uuid,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.management_can_edit_user(uuid,uuid),
  public.publish_weekly_points_leaderboard(uuid,date,date,uuid,jsonb)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT
  true AS weekly_rank_sql_installed,
  true AS management_publication_access_installed,
  false AS production_behavior_verified;
