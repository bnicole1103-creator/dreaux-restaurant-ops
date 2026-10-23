begin;
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
      WHERE location_id = p_location_id AND month=date_trunc('month',p_month)::date ORDER BY published_at DESC, id DESC LIMIT 1;
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
    WHERE location_id = p_location_id AND month=date_trunc('month',p_month)::date ORDER BY published_at DESC, id DESC LIMIT 1;
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

notify pgrst,'reload schema';commit;
