BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-leaderboard-install', 0));
CREATE SCHEMA IF NOT EXISTS leaderboard_private;
REVOKE ALL ON SCHEMA leaderboard_private FROM public, anon, authenticated;

-- Keep the audited scoring engine and its existing access checks intact.
DO $install$
BEGIN
  IF to_regprocedure('public.app_access_allowed(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Page access controls are missing. Stop and re-audit.';
  END IF;
  IF to_regprocedure('leaderboard_private.live_dashboard(uuid,date)') IS NULL THEN
    IF to_regprocedure('public.mod_points_dashboard(uuid,date)') IS NULL
      OR md5(pg_get_functiondef('public.mod_points_dashboard(uuid,date)'::regprocedure))
        <> '80d0eeb95a75e4425c0462a4c5ca5f27' THEN
      RAISE EXCEPTION 'Points dashboard changed since the audit. Stop and re-audit.';
    END IF;
    IF to_regprocedure('public.publish_points_leaderboard(uuid,date,uuid,jsonb)') IS NOT NULL THEN
      RAISE EXCEPTION 'Another leaderboard update is installed. Stop and re-audit.';
    END IF;
    ALTER FUNCTION public.mod_points_dashboard(uuid,date) SET SCHEMA leaderboard_private;
    ALTER FUNCTION leaderboard_private.mod_points_dashboard(uuid,date) RENAME TO live_dashboard;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_proc
      WHERE oid = to_regprocedure('public.mod_points_dashboard(uuid,date)')
        AND md5(prosrc) = '77ef16c9a1f47d9f3b31052d9763faa4')
      OR NOT EXISTS (SELECT 1 FROM pg_proc
      WHERE oid = to_regprocedure('public.publish_points_leaderboard(uuid,date,uuid,jsonb)')
        AND md5(prosrc) = '0c2f66e9ccff263ac1f331b719f6bbc6') THEN
      RAISE EXCEPTION 'Existing leaderboard differs from this update. Stop and re-audit.';
    END IF;
  END IF;
END;
$install$;
REVOKE ALL ON FUNCTION leaderboard_private.live_dashboard(uuid,date)
  FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS leaderboard_private.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  month date NOT NULL,
  standings jsonb NOT NULL CHECK (jsonb_typeof(standings) = 'array'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_publications_latest
  ON leaderboard_private.publications(location_id, published_at DESC, id DESC);
ALTER TABLE leaderboard_private.publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON leaderboard_private.publications FROM public, anon, authenticated;

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
    SELECT to_jsonb(p) INTO published FROM leaderboard_private.publications p
      WHERE location_id = p_location_id ORDER BY published_at DESC, id DESC LIMIT 1;
  END IF;
  SELECT s INTO mine FROM jsonb_array_elements(live->'standings') s
    WHERE s->>'user_id' = auth.uid()::text;
  SELECT s->'rank' INTO published_rank
    FROM jsonb_array_elements(coalesce(published->'standings', '[]'::jsonb)) s
    WHERE s->>'user_id' = auth.uid()::text;
  RETURN jsonb_build_object(
    'standings', CASE WHEN NOT can_board THEN '[]'::jsonb
      WHEN public.closeout_is_gm(p_location_id) IS TRUE THEN live->'standings'
      ELSE coalesce(published->'standings', '[]'::jsonb) END,
    'mine', CASE WHEN mine IS NULL THEN NULL ELSE (mine - 'rank') ||
      jsonb_build_object('rank', published_rank) END,
    'history', coalesce(live->'history', '[]'::jsonb),
    'published', published);
END;
$dashboard$;

CREATE OR REPLACE FUNCTION public.publish_points_leaderboard(
  p_location_id uuid, p_month date, p_expected_publication uuid, p_expected_standings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $publish$
DECLARE latest uuid; live jsonb; result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE
    OR public.closeout_is_gm(p_location_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'GM access required.' USING errcode = '42501';
  END IF;
  PERFORM public.app_access_assert(p_location_id, 'points', 'leaderboard');
  IF p_month IS NULL THEN RAISE EXCEPTION 'Select a month.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('leaderboard:' || p_location_id::text, 0));
  SELECT id INTO latest FROM leaderboard_private.publications
    WHERE location_id = p_location_id ORDER BY published_at DESC, id DESC LIMIT 1;
  IF latest IS DISTINCT FROM p_expected_publication THEN
    RAISE EXCEPTION 'A newer leaderboard was published. Refresh before publishing.';
  END IF;
  live := leaderboard_private.live_dashboard(p_location_id, p_month);
  IF live->'standings' IS DISTINCT FROM p_expected_standings THEN
    RAISE EXCEPTION 'Points changed since this preview. Refresh and review before publishing.';
  END IF;
  INSERT INTO leaderboard_private.publications(location_id, month, standings, published_by)
    VALUES(p_location_id, date_trunc('month', p_month)::date, live->'standings', auth.uid())
    RETURNING to_jsonb(publications) INTO result;
  RETURN result;
END;
$publish$;
REVOKE ALL ON FUNCTION public.mod_points_dashboard(uuid,date),
  public.publish_points_leaderboard(uuid,date,uuid,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mod_points_dashboard(uuid,date),
  public.publish_points_leaderboard(uuid,date,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT to_regprocedure('public.publish_points_leaderboard(uuid,date,uuid,jsonb)') IS NOT NULL
  AS leaderboard_publication_installed;
