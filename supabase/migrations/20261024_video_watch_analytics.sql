BEGIN;
CREATE TABLE IF NOT EXISTS public.video_watch_sessions(
 id uuid PRIMARY KEY,location_id uuid NOT NULL REFERENCES public.locations(id),
 user_id uuid NOT NULL,source text NOT NULL CHECK(source IN('sales','crew')),path text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 watched_seconds numeric NOT NULL DEFAULT 0,reported_total numeric NOT NULL DEFAULT 0,
 position_seconds numeric NOT NULL DEFAULT 0,duration_seconds numeric,
 sequence integer NOT NULL,playing boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS video_watch_by_clip ON public.video_watch_sessions(location_id,source,path,started_at DESC);
ALTER TABLE public.video_watch_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_watch_sessions FROM PUBLIC,anon,authenticated;

-- Resolve the location from the posted attachment, never from a client-supplied employee/location.
CREATE OR REPLACE FUNCTION public.video_watch_location(p_source text,p_path text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NULL;END IF;
 IF p_source='sales' THEN
  SELECT location_id INTO loc FROM public.sales_target_clips WHERE path=p_path;
 ELSIF p_source='crew' THEN
  SELECT m.location_id INTO loc FROM public.crew_message_media a JOIN public.crew_messages m ON m.id=a.message_id
   WHERE a.path=p_path AND a.kind='video' AND m.deleted_at IS NULL;
  IF loc IS NOT NULL AND public.app_access_allowed(loc,'schedule','chat') IS NOT TRUE THEN RETURN NULL;END IF;
 END IF;
 IF loc IS NULL OR public.closeout_is_member(loc) IS NOT TRUE THEN RETURN NULL;END IF;
 RETURN loc;
END $$;
CREATE OR REPLACE FUNCTION public.video_watch_info(p_source text,p_path text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid:=public.video_watch_location(p_source,p_path);
BEGIN
 IF loc IS NULL THEN RAISE EXCEPTION 'Video access required.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('can_report',public.mod_is_manager(loc) IS TRUE);
END $$;

CREATE OR REPLACE FUNCTION public.video_watch_record(p_session uuid,p_source text,p_path text,p_sequence integer,
 p_total numeric,p_playing boolean,p_position numeric,p_duration numeric DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid:=public.video_watch_location(p_source,p_path);prior public.video_watch_sessions;
 stamp timestamptz:=clock_timestamp();increment numeric;
BEGIN
 IF loc IS NULL THEN RAISE EXCEPTION 'Video access required.' USING errcode='42501';END IF;
 IF p_session IS NULL OR (p_sequence BETWEEN 1 AND 1000000) IS NOT TRUE OR p_playing IS NULL
  OR (p_total BETWEEN 0 AND 864000) IS NOT TRUE OR (p_position BETWEEN 0 AND 86400) IS NOT TRUE
  OR (p_duration IS NOT NULL AND (p_duration BETWEEN 0 AND 86400) IS NOT TRUE) THEN
  RAISE EXCEPTION 'Invalid playback measurement.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('video-watch:'||p_session::text,0));
 stamp:=clock_timestamp();
 SELECT * INTO prior FROM public.video_watch_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.video_watch_sessions(id,location_id,user_id,source,path,started_at,last_seen_at,
   sequence,reported_total,position_seconds,duration_seconds,playing)
  VALUES(p_session,loc,auth.uid(),p_source,p_path,stamp,stamp,p_sequence,p_total,p_position,p_duration,p_playing);
  RETURN true;
 END IF;
 IF prior.user_id<>auth.uid() OR prior.location_id<>loc OR prior.source<>p_source OR prior.path<>p_path THEN
  RAISE EXCEPTION 'Playback session belongs to another viewer or video.' USING errcode='42501';END IF;
 IF p_sequence<=prior.sequence THEN RETURN true;END IF;
 -- Client-reported playback is bounded by server elapsed time and a 30-second heartbeat window.
 increment:=least(greatest(0,p_total-prior.reported_total),greatest(0,extract(epoch FROM stamp-prior.last_seen_at)),30);
 UPDATE public.video_watch_sessions SET watched_seconds=watched_seconds+increment,
  reported_total=greatest(reported_total,p_total),sequence=p_sequence,last_seen_at=stamp,
  position_seconds=p_position,duration_seconds=coalesce(p_duration,duration_seconds),playing=p_playing
 WHERE id=p_session;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.video_watch_report(p_source text,p_path text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE loc uuid:=public.video_watch_location(p_source,p_path);result jsonb;
BEGIN
 IF loc IS NULL OR public.mod_is_manager(loc) IS NOT TRUE THEN
  RAISE EXCEPTION 'Manager access required.' USING errcode='42501';END IF;
 SELECT jsonb_build_object('viewers',count(DISTINCT user_id),'sessions',count(*),
  'watched_seconds',coalesce(sum(watched_seconds),0)) INTO result
 FROM public.video_watch_sessions WHERE location_id=loc AND source=p_source AND path=p_path;
 RETURN result||jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC,r.id) FROM (
  SELECT s.id,coalesce(nullif(to_jsonb(p)->>'preferred_name',''),nullif(to_jsonb(p)->>'full_name',''),'Employee') AS name,
   s.started_at,s.last_seen_at,round(s.watched_seconds,1) AS watched_seconds,s.position_seconds,s.duration_seconds
  FROM public.video_watch_sessions s LEFT JOIN public.profiles p ON p.id=s.user_id
  WHERE s.location_id=loc AND s.source=p_source AND s.path=p_path ORDER BY s.started_at DESC,s.id LIMIT 200
 ) r),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.video_watch_location(text,text),public.video_watch_info(text,text),
 public.video_watch_record(uuid,text,text,integer,numeric,boolean,numeric,numeric),public.video_watch_report(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.video_watch_info(text,text),
 public.video_watch_record(uuid,text,text,integer,numeric,boolean,numeric,numeric),public.video_watch_report(text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
